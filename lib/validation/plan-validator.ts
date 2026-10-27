import { Plan, TaskIntent } from "../types/plans";
import { Action, ActionSchema, ActionType, RiskLevel } from "../types/actions";
import { PageObservation } from "../types/browser";
import { validateUrlString } from "./url-policy";
import { TaskSpecification } from "../planning/task-specification";

export interface PlanValidationContext {
  task: string;
  taskIntent?: TaskIntent;
  taskSpec?: TaskSpecification;
  targetUrl?: string;
  observation?: PageObservation | null;
  allowConsequentialActions?: boolean;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  securityViolations: string[];
  warnings: string[];
}

/**
 * Plan Validation Boundary (Phase 2 Component E & Step 6)
 * Enforces schema validity, task restriction alignment, evidence grounding,
 * loop bounds, and security constraints across the entire plan BEFORE execution starts.
 */
export class PlanValidator {
  static validatePlan(plan: Plan, context: PlanValidationContext): PlanValidationResult {
    const errors: string[] = [];
    const securityViolations: string[] = [];
    const warnings: string[] = [];

    const { task, taskIntent, targetUrl, observation, allowConsequentialActions = false } = context;

    // 1. Basic Plan Structure & Bounds
    if (!plan || !Array.isArray(plan.actions)) {
      errors.push("Plan is null or missing actions array.");
      return { valid: false, errors, securityViolations, warnings };
    }

    if (plan.actions.length === 0) {
      errors.push("Plan contains 0 actions.");
      return { valid: false, errors, securityViolations, warnings };
    }

    if (plan.actions.length > 25) {
      errors.push(`Plan exceeds maximum allowable actions (length: ${plan.actions.length}, limit: 25).`);
      return { valid: false, errors, securityViolations, warnings };
    }

    // 2. Validate Every Action Against Typed ActionSchema, Safety, and Loops
    const supportedActionTypes = new Set<string>(Object.values(ActionType));
    const actionIndexMap = new Map<string, number>();

    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i];

      // 2A. Supported Action Type Check
      if (!supportedActionTypes.has(action.type)) {
        securityViolations.push(
          `Unsupported action type: Action at index ${i} ('${action.id}') specifies unsupported action type '${action.type}'.`
        );
        errors.push(`Unsupported action type '${action.type}' at index ${i}.`);
      }

      // Record ID index for dependency validation
      if (action.id) {
        if (actionIndexMap.has(action.id)) {
          errors.push(`Duplicate action ID '${action.id}' detected at index ${i}.`);
        } else {
          actionIndexMap.set(action.id, i);
        }
      }

      const check = ActionSchema.safeParse(action);
      if (!check.success) {
        errors.push(`Action at index ${i} (${action.type || "unknown"}) failed schema validation: ${check.error.message}`);
      }

      // Disallow arbitrary code execution or credential theft patterns
      if (action.type === ActionType.EVALUATE_SAFE && typeof action.value === "string") {
        if (/eval\(|Function\(|window\.location|document\.cookie|localStorage|sessionStorage/i.test(action.value)) {
          securityViolations.push(
            `Action at index ${i} attempts unconstrained JavaScript evaluation with dangerous primitives: '${action.value}'`
          );
        }
      }

      // Disallow privilege escalation / domain allowlist tampering
      const actionStr = JSON.stringify(action);
      if (
        /allowlist|permission|bypass|grant_permission|disable_web_security|ignore_cert/i.test(actionStr) &&
        (action.type === ActionType.EVALUATE_SAFE || String(action.value || "").includes("allow") || String(action.value || "").includes("permission"))
      ) {
        securityViolations.push(
          `Permission escalation: Action at index ${i} ('${action.id}') attempts permission escalation or security policy modification.`
        );
      }

      // Check for unbounded or repetitive loops (e.g. 3 identical clicks with identical targets in sequence)
      if (i >= 2) {
        const prev1 = plan.actions[i - 1];
        const prev2 = plan.actions[i - 2];
        if (
          action.type === prev1.type &&
          action.type === prev2.type &&
          action.target?.value === prev1.target?.value &&
          action.target?.value === prev2.target?.value &&
          action.type !== ActionType.WAIT
        ) {
          errors.push(
            `Plan contains repetitive loop of 3 identical consecutive actions (${action.type} on '${action.target?.value}') without recovery condition.`
          );
        }
      }
    }

    // 2B. Validate Dependency Ordering and Cycle Rejection (Vector-Inspired Contract)
    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i];
      if (action.dependencies && Array.isArray(action.dependencies)) {
        for (const depId of action.dependencies) {
          if (!actionIndexMap.has(depId)) {
            errors.push(
              `Action '${action.id}' at index ${i} declares dependency on non-existent action ID '${depId}'.`
            );
          } else {
            const depIndex = actionIndexMap.get(depId)!;
            if (depIndex === i) {
              errors.push(
                `Self-referential dependency cycle detected: Action '${action.id}' depends on itself.`
              );
            } else if (depIndex > i) {
              errors.push(
                `Forward dependency detected: Action '${action.id}' at index ${i} depends on future action '${depId}' at index ${depIndex}. Actions may only depend on preceding actions.`
              );
            }
          }
        }
      }
    }

    // 2C. Missing Prerequisites Validation (Vector-Inspired Contract)
    const isBrowserUnnavigated = Boolean(observation && (observation.url === "about:blank" || observation.url === ""));
    const firstNavIndex = plan.actions.findIndex((a) => a.type === ActionType.NAVIGATE);

    if (isBrowserUnnavigated) {
      // If browser is not yet navigated, any DOM interaction before the first NAVIGATE is an illegal missing prerequisite
      for (let i = 0; i < plan.actions.length; i++) {
        const action = plan.actions[i];
        const isDomInteraction =
          action.type === ActionType.CLICK ||
          action.type === ActionType.DOUBLE_CLICK ||
          action.type === ActionType.FILL ||
          action.type === ActionType.TYPE ||
          action.type === ActionType.PRESS ||
          action.type === ActionType.SELECT ||
          action.type === ActionType.CHECK ||
          action.type === ActionType.UNCHECK ||
          action.type === ActionType.HOVER ||
          action.type === ActionType.EXTRACT_TEXT ||
          action.type === ActionType.EXTRACT_ATTRIBUTE ||
          action.type === ActionType.EXTRACT_TABLE ||
          action.type === ActionType.MEDIA_PLAY;

        if (isDomInteraction && (firstNavIndex === -1 || i < firstNavIndex)) {
          errors.push(
            `Missing prerequisite navigation: Action '${action.id}' (${action.type}) targets DOM elements before any navigation action while browser is unnavigated.`
          );
        }
      }
    }

    // 2D. Contradictory Actions Detection
    // 1) Actions occurring after FINISH
    const finishIndex = plan.actions.findIndex((a) => a.type === ActionType.FINISH);
    if (finishIndex !== -1 && finishIndex < plan.actions.length - 1) {
      const trailingActions = plan.actions.slice(finishIndex + 1).map((a) => a.id).join(", ");
      errors.push(
        `Contradictory plan: Actions [${trailingActions}] are scheduled after FINISH action '${plan.actions[finishIndex].id}'.`
      );
    }

    // 2) Mutually contradictory check/uncheck on identical target without intermediate steps
    for (let i = 0; i < plan.actions.length - 1; i++) {
      const a1 = plan.actions[i];
      const a2 = plan.actions[i + 1];
      if (
        ((a1.type === ActionType.CHECK && a2.type === ActionType.UNCHECK) ||
         (a1.type === ActionType.UNCHECK && a2.type === ActionType.CHECK)) &&
        a1.target?.value === a2.target?.value &&
        a1.target?.value !== undefined
      ) {
        errors.push(
          `Plan contains contradictory consecutive toggle actions (${a1.type} then ${a2.type}) on identical target '${a1.target?.value}'.`
        );
      }
    }

    // 3. Navigation Scope & Target URL Validation
    if (targetUrl) {
      const navActions = plan.actions.filter((a) => a.type === ActionType.NAVIGATE);
      if (navActions.length > 0) {
        const firstNav = navActions[0];
        const plannedUrl = String(firstNav.value || "");
        try {
          validateUrlString(plannedUrl, "plan validation first navigation");
          const plannedBase = plannedUrl.replace(/\/$/, "");
          const targetBase = targetUrl.replace(/\/$/, "");
          if (plannedBase !== targetBase) {
            warnings.push(`Planned navigation URL '${plannedUrl}' differs from authoritative target '${targetUrl}'.`);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          securityViolations.push(`Navigation action references invalid or dangerous URL '${plannedUrl}': ${msg}`);
        }
      }

      // Check all other navigation actions
      for (const nav of navActions.slice(1)) {
        if (nav.value) {
          try {
            validateUrlString(String(nav.value), "plan validation secondary navigation");
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            securityViolations.push(`Secondary navigation references dangerous URL '${nav.value}': ${msg}`);
          }
        }
      }
    }

    // 4. Task Restrictions and Negations Enforcement
    const negationsList: Array<{ operation: string; forbidden: boolean }> = [];
    if (taskIntent?.negation) {
      negationsList.push(taskIntent.negation);
    }
    if (context.taskSpec?.negations) {
      for (const n of context.taskSpec.negations) {
        if (!negationsList.some((existing) => existing.operation === n.operation)) {
          negationsList.push(n);
        }
      }
    }

    for (const negation of negationsList) {
      const { operation, forbidden } = negation;

      if (forbidden) {
        if (operation === "submit") {
          for (const action of plan.actions) {
            const reasonLower = (action.reason || "").toLowerCase();
            const targetVal = (action.target?.value || "").toLowerCase();
            const isSubmitClick =
              action.type === ActionType.CLICK &&
              (/\b(submit|send\s+message|submit\s+form|send\s+inquiry)\b/i.test(targetVal) ||
                /\b(submit|send)\b/i.test(reasonLower));

            const isSubmitPress =
              action.type === ActionType.PRESS &&
              String(action.value || "").toLowerCase() === "enter" &&
              /\b(submit|send)\b/i.test(reasonLower);

            if (isSubmitClick || isSubmitPress) {
              securityViolations.push(
                `Plan violates explicit negative constraint: Task strictly forbade form submission, but action '${action.id}' (${action.type}) attempts submission.`
              );
            }
          }
        }

        if (operation === "purchase") {
          for (const action of plan.actions) {
            const reasonLower = (action.reason || "").toLowerCase();
            const targetVal = (action.target?.value || "").toLowerCase();
            const isPurchaseAction =
              action.type === ActionType.CLICK &&
              (/\b(buy|purchase|checkout|place\s+order|pay\s+now)\b/i.test(targetVal) ||
                /\b(buy|purchase|checkout|order)\b/i.test(reasonLower));

            if (isPurchaseAction) {
              securityViolations.push(
                `Plan violates explicit negative constraint: Task strictly forbade purchase, but action '${action.id}' attempts purchase/checkout.`
              );
            }
          }
        }

        if (operation === "add_to_cart") {
          for (const action of plan.actions) {
            const targetVal = (action.target?.value || "").toLowerCase();
            const reasonLower = (action.reason || "").toLowerCase();
            if (
              action.type === ActionType.CLICK &&
              (/\b(add\s+to\s+cart|add\s+to\s+basket)\b/i.test(targetVal) || /\b(add\s+to\s+cart)\b/i.test(reasonLower))
            ) {
              securityViolations.push(
                `Plan violates explicit negative constraint: Task strictly forbade adding item to cart, but action '${action.id}' attempts add to cart.`
              );
            }
          }
        }

        if (operation === "navigate" || operation === "change_page") {
          for (const action of plan.actions) {
            if (action.type === ActionType.OPEN_NEW_TAB) {
              securityViolations.push(
                `Plan violates explicit negative constraint: Task requested action without changing page or opening new view, but action '${action.id}' opens a new tab.`
              );
            }
            if (action.type === ActionType.CLICK) {
              const targetVal = (action.target?.value || "").toLowerCase();
              if (/\b(open|view\s+details|select\s+product)\b/i.test(targetVal)) {
                securityViolations.push(
                  `Plan violates explicit negative constraint: Task requested extraction without opening item details, but action '${action.id}' clicks '${action.target?.value}'.`
                );
              }
            }
          }
        }
      }
    }

    // 5. Evidence Grounding Compatibility Check
    if (observation && observation.interactiveElements) {
      const hasInputs = observation.interactiveElements.some(
        (el) => el.tagName === "INPUT" || el.role === "textbox" || el.role === "searchbox"
      );

      const fillActions = plan.actions.filter((a) => a.type === ActionType.FILL || a.type === ActionType.TYPE);
      if (fillActions.length > 0 && !hasInputs && observation.interactiveElements.length > 0) {
        warnings.push("Plan contains input fill actions, but no input fields or textboxes were observed in the current DOM.");
      }
    }

    // 6. Consequential / Destructive Action Safeguard
    for (const action of plan.actions) {
      if (action.risk === RiskLevel.HIGH && !allowConsequentialActions) {
        securityViolations.push(
          `Action '${action.id}' is classified as HIGH RISK and cannot be executed without explicit authorization.`
        );
      }
    }

    // 7. Action Ordering
    const lastAction = plan.actions[plan.actions.length - 1];
    if (lastAction && lastAction.type !== ActionType.FINISH) {
      warnings.push("Final action is not FINISH; plan may terminate without outcome verification.");
    }

    const isValid = errors.length === 0 && securityViolations.length === 0;

    return {
      valid: isValid,
      errors,
      securityViolations,
      warnings,
    };
  }
}
