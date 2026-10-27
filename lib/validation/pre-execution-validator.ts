import { Page, Locator } from "playwright";
import { Action, ActionSchema, ActionType, RiskLevel } from "../types/actions";
import { PageObservation } from "../types/browser";
import { ErrorCode, AgentError } from "../types/errors";
import { LocatorEngine } from "../browser/locator-engine";
import { validateUrlString } from "./url-policy";

import { PromptDefense } from "../ai/prompt-defense";

export interface PreExecutionValidationResult {
  valid: boolean;
  resolvedLocator?: Locator;
  reason: string;
  skipAction?: boolean; // If action is already satisfied (Part 8 & Part 11)
  requiresUserConfirmation?: boolean;
  strategyUsed?: string;
  isSafeToRetry?: boolean;
}

/**
 * Pre-Execution Guardrail Validator (Part 8)
 * Ensures every planned action is valid, visible, enabled, unique, and safe BEFORE execution.
 */
export class PreExecutionValidator {
  /**
   * Performs static schema and structure validation on a planned action.
   */
  static validateAction(action: Action): { valid: boolean; error?: string } {
    const schemaCheck = ActionSchema.safeParse(action);
    if (!schemaCheck.success) {
      return { valid: false, error: JSON.stringify(schemaCheck.error.format()) };
    }
    return { valid: true };
  }

  /**
   * Validates an action against the live browser state.
   */
  static async validate(params: {
    action: Action;
    page: Page;
    currentObservation: PageObservation;
    requireConfirmationForHighRisk?: boolean;
    lastResolvedLocator?: Locator;
    authorizedTask?: string;
    initialTargetUrl?: string;
  }): Promise<PreExecutionValidationResult> {
    const {
      action,
      page,
      currentObservation,
      requireConfirmationForHighRisk = true,
      lastResolvedLocator,
      authorizedTask,
      initialTargetUrl,
    } = params;

    // Browser state guardrail
    if (!page || (typeof page.isClosed === "function" && page.isClosed())) {
      throw new AgentError(
        "Browser page is closed or disconnected. Cannot execute action on detached browser context.",
        ErrorCode.BROWSER_CRASH,
        false
      );
    }

    // Determine if action is safe to retry based on side effects
    const isSideEffecting =
      action.type === ActionType.UPLOAD ||
      (action.type === ActionType.CLICK &&
        /\b(submit|send|buy|purchase|pay|order|checkout|delete|remove|destroy|book|subscribe|transfer)\b/i.test(
          action.target?.value || action.target?.name || action.reason || ""
        )) ||
      (action.type === ActionType.PRESS &&
        String(action.value || "").toLowerCase() === "enter" &&
        /\b(submit|send|buy|purchase|pay|order|checkout)\b/i.test(
          action.target?.value || action.target?.name || action.reason || ""
        ));
    const isSafeToRetry = !isSideEffecting && action.type !== ActionType.UPLOAD;

    // Check declared action preconditions
    if (action.preconditions && action.preconditions.length > 0) {
      for (const pre of action.preconditions) {
        if (pre === "page_loaded" && currentObservation.url === "about:blank") {
          throw new AgentError(
            `Action precondition '${pre}' not met: page has not been loaded (URL is about:blank)`,
            ErrorCode.VALIDATION_FAILED,
            true
          );
        }
      }
    }

    // 0. Prompt injection defense & action safety check
    if (authorizedTask) {
      const safetyCheck = PromptDefense.validateActionSafety(action, authorizedTask, initialTargetUrl);
      if (!safetyCheck.safe) {
        throw new AgentError(
          safetyCheck.reason || "Action blocked by security policy.",
          ErrorCode.SECURITY_POLICY_VIOLATION,
          false
        );
      }

      // 0B. Just-In-Time Negative Constraint Re-Check (Step 5)
      const taskLower = authorizedTask.toLowerCase();
      const targetQuery = (action.target?.value || action.target?.name || action.reason || "").toLowerCase();

      // Check forbidden purchase
      const forbidsPurchase = /\b(?:do not|don't|never|without)\s+(?:buy(?:ing)?|purchas(?:e|ing)|checkout|order(?:ing)?)\b/i.test(taskLower);
      if (forbidsPurchase) {
        const isPurchaseAction =
          action.type === ActionType.CLICK &&
          /\b(buy|purchase|checkout|place\s+order|pay\s+now)\b/i.test(targetQuery);
        if (isPurchaseAction) {
          throw new AgentError(
            `Action '${action.type}' targeting '${targetQuery}' violates task negative constraint forbidding purchases/checkout.`,
            ErrorCode.SECURITY_POLICY_VIOLATION,
            false
          );
        }
      }

      // Check forbidden submit
      const forbidsSubmit = /\b(?:do not|don't|never|without)\s+[^.,;!?:()]*?\b(?:submit(?:ting)?|send(?:ing)?|send\s+message)\b/i.test(taskLower);
      if (forbidsSubmit) {
        const isSubmitAction =
          (action.type === ActionType.CLICK && /\b(submit|send\s+message|send\s+inquiry)\b/i.test(targetQuery)) ||
          (action.type === ActionType.PRESS && String(action.value || "").toLowerCase() === "enter" && /\b(submit|send)\b/i.test(targetQuery));
        if (isSubmitAction) {
          throw new AgentError(
            `Action '${action.type}' targeting '${targetQuery}' violates task negative constraint forbidding form submission.`,
            ErrorCode.SECURITY_POLICY_VIOLATION,
            false
          );
        }
      }

      // Check forbidden cart addition
      const forbidsCart = /\b(?:do not|don't|never|without)\s+(?:add(?:ing)?\s+to\s+cart|add(?:ing)?\s+to\s+basket)\b/i.test(taskLower);
      if (forbidsCart) {
        const isCartAction =
          action.type === ActionType.CLICK && /\b(add\s+to\s+cart|add\s+to\s+basket)\b/i.test(targetQuery);
        if (isCartAction) {
          throw new AgentError(
            `Action '${action.type}' targeting '${targetQuery}' violates task negative constraint forbidding cart addition.`,
            ErrorCode.SECURITY_POLICY_VIOLATION,
            false
          );
        }
      }
    }

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
      action.type === ActionType.INSPECT ||
      action.type === ActionType.REQUEST_CLARIFICATION ||
      action.type === ActionType.EVALUATE_SAFE ||
      ((action.type === ActionType.OPEN_NEW_TAB ||
        action.type === ActionType.SWITCH_TAB ||
        action.type === ActionType.CLOSE_TAB) &&
        !action.target)
    ) {
      // For navigate, check if we are ALREADY at the requested URL
      if (action.type === ActionType.NAVIGATE && typeof action.value === "string") {
        validateUrlString(action.value, "pre-execution navigation validation");
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

    // 5. Contextual actions without target (Upload, Media Controls)
    if (!action.target) {
      if (
        action.type === ActionType.MEDIA_PLAY ||
        action.type === ActionType.MEDIA_PAUSE ||
        action.type === ActionType.MEDIA_MUTE ||
        action.type === ActionType.MEDIA_SEEK ||
        action.type === ActionType.MEDIA_VOLUME
      ) {
        const isBlank =
          currentObservation.url === "about:blank" &&
          (!currentObservation.headings || currentObservation.headings.length === 0) &&
          (!currentObservation.interactiveElements || currentObservation.interactiveElements.length === 0);
        const hasMedia = (currentObservation.mediaElements && currentObservation.mediaElements.length > 0) ||
          (await page.locator("video, audio, button[aria-label*='play' i]").count().catch(() => 0)) > 0;
        if (isBlank && !hasMedia) {
          throw new AgentError(
            `Precondition failed: Cannot execute media action '${action.type}' on 'about:blank'. No media controls or media resources found. Target website must be opened first.`,
            ErrorCode.VALIDATION_FAILED,
            true,
            { action, url: currentObservation.url }
          );
        }
        return { valid: true, reason: `Pre-validation passed for contextual ${action.type}` };
      }
      if (action.type === ActionType.UPLOAD) {
        return { valid: true, reason: `Pre-validation passed for contextual ${action.type}` };
      }
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

    const isSearchResultClick =
      action.id?.includes("click-result") ||
      action.id?.includes("open-result") ||
      (action.reason && /matching\s+(?:media|product|content|search|article)?\s*result/i.test(action.reason)) ||
      (action.target as any)?.isSearchResult === true;

    try {
      const resolved = await LocatorEngine.resolve(page, action.target, action.timeout || 5000);
      locator = resolved.locator;
      strategyUsed = resolved.strategyUsed;
      confidence = resolved.confidence;
    } catch (err: unknown) {
      if (err instanceof AgentError && (err.code === ErrorCode.ELEMENT_NOT_FOUND || err.code === ErrorCode.VALIDATION_FAILED)) {
        const authRestriction = await PreExecutionValidator.checkAuthOrBotBarrier(page);
        if (authRestriction) {
          throw new AgentError(
            `Access restricted: Target page requires manual sign-in ("${authRestriction}"). Execution halted safely without attempting automated bypass. Please sign in manually in the visible browser window to continue.`,
            ErrorCode.AUTH_REQUIRED,
            false
          );
        }
      }

      if (isSearchResultClick && err instanceof AgentError && err.code === ErrorCode.ELEMENT_AMBIGUOUS) {
        // For search result selection, multiple matching result candidates are expected;
        // ActionExecutor's SearchResultResolver candidate scoring and ranking pipeline will select the best grounded match.
        locator = page.locator(action.target.value).first();
        strategyUsed = "search_candidate_ranking";
        confidence = 0.9;
      } else if (currentObservation.url === "about:blank" && err instanceof AgentError && err.code === ErrorCode.ELEMENT_NOT_FOUND) {
        throw new AgentError(
          `Precondition failed: Cannot execute '${action.type}' because target "${action.target.value}" does not exist on 'about:blank'. Target website must be opened first.`,
          ErrorCode.VALIDATION_FAILED,
          true,
          { target: action.target }
        );
      }
      // If press action target resolution fails but we have a valid visible active element from prior step, fall back safely
      else if (action.type === ActionType.PRESS && lastResolvedLocator) {
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
      const authRestriction = await PreExecutionValidator.checkAuthOrBotBarrier(page);
      if (authRestriction) {
        throw new AgentError(
          `Access restricted: Target page requires manual sign-in ("${authRestriction}"). Execution halted safely without attempting automated bypass. Please sign in manually in the visible browser window to continue.`,
          ErrorCode.AUTH_REQUIRED,
          false
        );
      }

      if (currentObservation.url === "about:blank") {
        throw new AgentError(
          `Precondition failed: Cannot execute '${action.type}' because target "${action.target.value}" does not exist on 'about:blank'. Target website must be opened first.`,
          ErrorCode.VALIDATION_FAILED,
          true,
          { target: action.target }
        );
      }
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

    // 8B. Element Appropriateness Check (Step 5 & Step 6)
    // Confirm the element is appropriate for the action type
    if (action.type === ActionType.FILL || action.type === ActionType.TYPE) {
      const tagName = await Promise.resolve(locator.evaluate((el) => el.tagName.toLowerCase())).catch(() => "unknown");
      const isContentEditable = await Promise.resolve(locator.evaluate((el) => (el as HTMLElement).isContentEditable)).catch(() => false);
      if (tagName !== "unknown" && !["input", "textarea", "select"].includes(tagName) && !isContentEditable) {
        throw new AgentError(
          `Action '${action.type}' cannot be performed on non-editable <${tagName}> element: "${action.target.value}"`,
          ErrorCode.VALIDATION_FAILED,
          false,
          { target: action.target, tagName }
        );
      }
    }

    if (action.type === ActionType.CHECK || action.type === ActionType.UNCHECK) {
      const inputType = await Promise.resolve(locator.getAttribute("type")).catch(() => null);
      const tagName = await Promise.resolve(locator.evaluate((el) => el.tagName.toLowerCase())).catch(() => "unknown");
      if (tagName === "input" && inputType !== "checkbox" && inputType !== "radio") {
        throw new AgentError(
          `Action '${action.type}' cannot be performed on input of type '${inputType}': "${action.target.value}"`,
          ErrorCode.VALIDATION_FAILED,
          false,
          { target: action.target, inputType }
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
          strategyUsed,
          isSafeToRetry: true,
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
          strategyUsed,
          isSafeToRetry: true,
          reason: "Checkbox is already checked. Skipping redundant check.",
        };
      }
    }

    return {
      valid: true,
      resolvedLocator: locator,
      strategyUsed,
      isSafeToRetry,
      reason: `Pre-execution validation passed with confidence ${confidence} using strategy '${strategyUsed}'`,
    };
  }

  /**
   * Evaluates whether the live DOM is currently gated behind an authentication wall or bot verification challenge.
   */
  static async checkAuthOrBotBarrier(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText : "";
      const containers = Array.from(document.querySelectorAll(
        "[role='alert'], [role='dialog'], [role='banner'], [data-testid*='banner'], [data-testid*='modal'], [class*='banner'], [class*='modal'], [class*='auth'], [class*='login'], [class*='prompt'], [class*='upsell'], [class*='gate'], [id*='banner'], [id*='modal'], [id*='auth'], aside, header"
      ));
      const candidateTexts = [
        bodyText,
        ...containers.map((c) => c.textContent || ""),
      ];
      const AUTH_PATTERNS = [
        /\b(?:sign(?:ing)?\s*in|log(?:ging)?\s*in|login)\s+(?:is\s+)?(?:required|needed)\b/i,
        /\b(?:sign(?:ing)?\s*in|log(?:ging)?\s*in|login)\s+(?:is\s+)?(?:required|needed)?\s*to\s+(?:listen|play|watch|stream|hear|continue|enjoy|unlock|access)\b/i,
        /\bto\s+(?:listen|play|watch|stream|hear|enjoy)\b[^\n.!?]*\b(?:sign\s*in|log\s*in|login)\b/i,
        /\bsign\s*in\s+to\s+confirm\s+you(?:'re|\s+are)\s+not\s+a\s+bot\b/i,
        /\bsign\s*in\s+to\s+confirm\s+your\s+age\b/i,
        /\bconfirm\s+you(?:'re|\s+are)\s+not\s+a\s+bot\b/i,
      ];
      for (const text of candidateTexts) {
        for (const p of AUTH_PATTERNS) {
          const match = text.match(p);
          if (match) return match[0].trim();
        }
      }
      return null;
    }).catch(() => null);
  }
}
