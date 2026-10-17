import { Page, Locator } from "playwright";
import { Action, ActionSchema, ActionType, RiskLevel } from "../types/actions";
import { PageObservation } from "../types/browser";
import { ErrorCode, AgentError } from "../types/errors";
import { LocatorEngine } from "../browser/locator-engine";

export interface PreExecutionValidationResult {
  valid: boolean;
  resolvedLocator?: Locator;
  reason: string;
  skipAction?: boolean; // If action is already satisfied (Part 8 & Part 11)
  requiresUserConfirmation?: boolean;
}

/**
 * Pre-Execution Guardrail Validator (Part 8)
 * Ensures every planned action is valid, visible, enabled, unique, and safe BEFORE execution.
 */
export class PreExecutionValidator {
  /**
   * Validates an action against the live browser state.
   */
  static async validate(params: {
    action: Action;
    page: Page;
    currentObservation: PageObservation;
    requireConfirmationForHighRisk?: boolean;
    lastResolvedLocator?: Locator;
  }): Promise<PreExecutionValidationResult> {
    const { action, page, currentObservation, requireConfirmationForHighRisk = true, lastResolvedLocator } = params;

    // 1. Validate action schema runtime
    const schemaCheck = ActionSchema.safeParse(action);
    if (!schemaCheck.success) {
      throw new AgentError(
        `Action schema invalid: ${JSON.stringify(schemaCheck.error.format())}`,
        ErrorCode.VALIDATION_FAILED,
        false
      );
    }

    // 2. High-risk guardrail check
    if (action.risk === RiskLevel.HIGH && requireConfirmationForHighRisk) {
      return {
        valid: false,
        requiresUserConfirmation: true,
        reason: `Action '${action.type}' is classified as HIGH RISK and requires explicit confirmation.`,
      };
    }

    // 3. Actions that don't target specific DOM elements
    if (
      action.type === ActionType.NAVIGATE ||
      action.type === ActionType.WAIT ||
      action.type === ActionType.BACK ||
      action.type === ActionType.FORWARD ||
      action.type === ActionType.RELOAD ||
      action.type === ActionType.FINISH ||
      action.type === ActionType.SCREENSHOT ||
      action.type === ActionType.EVALUATE_SAFE ||
      ((action.type === ActionType.OPEN_NEW_TAB ||
        action.type === ActionType.SWITCH_TAB ||
        action.type === ActionType.CLOSE_TAB) &&
        !action.target)
    ) {
      // For navigate, check if we are ALREADY at the requested URL
      if (action.type === ActionType.NAVIGATE && typeof action.value === "string") {
        if (currentObservation.url === action.value) {
          return {
            valid: true,
            skipAction: true,
            reason: `Browser already at target URL: ${action.value}`,
          };
        }
      }
      return { valid: true, reason: `Pre-validation passed for ${action.type}` };
    }

    // 4. Keyboard press actions without target (submits via currently focused element or globally)
    if (action.type === ActionType.PRESS && !action.target) {
      let resolvedLoc = lastResolvedLocator;
      if (resolvedLoc) {
        const isVis = await resolvedLoc.isVisible().catch(() => false);
        const isEn = await resolvedLoc.isEnabled().catch(() => false);
        if (!isVis || !isEn) {
          resolvedLoc = undefined;
        }
      }
      return {
        valid: true,
        resolvedLocator: resolvedLoc,
        reason: resolvedLoc
          ? "Pre-validation passed for keyboard press on active element"
          : "Pre-validation passed for global keyboard press",
      };
    }

    // 5. Element-targeting actions (Click, Fill, Select, Check, etc.)
    if (!action.target) {
      throw new AgentError(
        `Action type '${action.type}' requires an element target, but none was provided.`,
        ErrorCode.VALIDATION_FAILED,
        false
      );
    }

    // 6. Target discovery and candidate resolution via LocatorEngine
    let locator: Locator;
    let strategyUsed = "unknown";
    let confidence = 1.0;

    try {
      const resolved = await LocatorEngine.resolve(page, action.target, action.timeout || 5000);
      locator = resolved.locator;
      strategyUsed = resolved.strategyUsed;
      confidence = resolved.confidence;
    } catch (err: unknown) {
      // If press action target resolution fails but we have a valid visible active element from prior step, fall back safely
      if (action.type === ActionType.PRESS && lastResolvedLocator) {
        const isVis = await lastResolvedLocator.isVisible().catch(() => false);
        const isEn = await lastResolvedLocator.isEnabled().catch(() => false);
        if (isVis && isEn) {
          locator = lastResolvedLocator;
          strategyUsed = "activeElement";
          confidence = 0.95;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // 7. Target existence and visibility validation
    const count = await locator.count();
    if (count === 0) {
      if (action.type === ActionType.PRESS && lastResolvedLocator) {
        const isVis = await lastResolvedLocator.isVisible().catch(() => false);
        if (isVis) {
          locator = lastResolvedLocator;
        } else {
          throw new AgentError(
            `Target element does not exist on page: "${action.target.value}"`,
            ErrorCode.ELEMENT_NOT_FOUND,
            true,
            { target: action.target }
          );
        }
      } else {
        throw new AgentError(
          `Target element does not exist on page: "${action.target.value}"`,
          ErrorCode.ELEMENT_NOT_FOUND,
          true,
          { target: action.target }
        );
      }
    }

    const isVisible = await locator.isVisible().catch(() => false);
    if (!isVisible) {
      if (action.type === ActionType.PRESS && lastResolvedLocator) {
        const activeVis = await lastResolvedLocator.isVisible().catch(() => false);
        if (activeVis) {
          locator = lastResolvedLocator;
        } else {
          throw new AgentError(
            `Target element exists but is currently hidden or not visible: "${action.target.value}"`,
            ErrorCode.ELEMENT_NOT_VISIBLE,
            true,
            { target: action.target }
          );
        }
      } else {
        throw new AgentError(
          `Target element exists but is currently hidden or not visible: "${action.target.value}"`,
          ErrorCode.ELEMENT_NOT_VISIBLE,
          true,
          { target: action.target }
        );
      }
    }

    // 8. Enabled state check for interactive actions
    if (
      action.type === ActionType.CLICK ||
      action.type === ActionType.FILL ||
      action.type === ActionType.TYPE ||
      action.type === ActionType.SELECT ||
      action.type === ActionType.CHECK ||
      action.type === ActionType.PRESS
    ) {
      const isEnabled = await locator.isEnabled().catch(() => false);
      if (!isEnabled) {
        throw new AgentError(
          `Target element is disabled and cannot be interacted with: "${action.target.value}"`,
          ErrorCode.ELEMENT_DISABLED,
          true,
          { target: action.target }
        );
      }
    }

    // 8. Check whether action has already occurred (Part 8 & Part 11)
    if (action.type === ActionType.FILL || action.type === ActionType.TYPE) {
      const currentVal = await locator.inputValue().catch(() => null);
      if (currentVal !== null && currentVal === String(action.value ?? "")) {
        return {
          valid: true,
          resolvedLocator: locator,
          skipAction: true,
          reason: `Input already contains the desired value '${action.value}'. Skipping redundant fill.`,
        };
      }
    }

    if (action.type === ActionType.CHECK) {
      const isChecked = await locator.isChecked().catch(() => false);
      if (isChecked) {
        return {
          valid: true,
          resolvedLocator: locator,
          skipAction: true,
          reason: "Checkbox is already checked. Skipping redundant check.",
        };
      }
    }

    return {
      valid: true,
      resolvedLocator: locator,
      reason: `Pre-execution validation passed with confidence ${confidence} using strategy '${strategyUsed}'`,
    };
  }
}
