import { Action, ActionType, ElementTarget } from "../types/actions";
import { PageObservation, ObservedElement } from "../types/browser";
import { ErrorCode, AgentError } from "../types/errors";
import { Plan } from "../types/plans";
import { LocatorEngine } from "../browser/locator-engine";

export type RecoveryStrategy =
  | "RETRY_WITH_BACKOFF"
  | "RETRY_WITH_ALTERNATIVE_LOCATOR"
  | "REPLAN"
  | "WAITING_FOR_USER"
  | "FAIL";

export interface RecoveryDecision {
  strategy: RecoveryStrategy;
  reason: string;
  suggestedTarget?: ElementTarget;
  alternativeActions?: Action[];
  backoffMs?: number;
  terminal: boolean;
}

export interface RecoveryContext {
  action: Action;
  error: AgentError | Error;
  attempt: number;
  maxAttempts: number;
  replansUsed: number;
  maxReplans: number;
  observation?: PageObservation | null;
  plan?: Plan | null;
  failedTargets?: Set<string>;
}

export class RecoveryEngine {
  /**
   * Classify any raw error into an AgentError with a standard ErrorCode (Section 10)
   */
  static classifyError(error: unknown, context?: { action?: Action; url?: string }): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    // 1. CAPTCHA
    if (lower.includes("captcha") || lower.includes("cf-challenge") || lower.includes("recaptcha") || lower.includes("turnstile")) {
      return new AgentError(message, ErrorCode.CAPTCHA_DETECTED, false, context);
    }

    // 2. Auth Required
    if (
      lower.includes("auth") ||
      lower.includes("login required") ||
      lower.includes("unauthorized") ||
      lower.includes("401") ||
      lower.includes("sign in")
    ) {
      return new AgentError(message, ErrorCode.AUTH_REQUIRED, false, context);
    }

    // 3. Ambiguous Target
    if (lower.includes("ambiguous") || lower.includes("multiple candidates") || lower.includes("strict mode violation")) {
      return new AgentError(message, ErrorCode.ELEMENT_AMBIGUOUS, true, context);
    }

    // 4. Element Disabled
    if (lower.includes("disabled") || lower.includes("not enabled")) {
      return new AgentError(message, ErrorCode.ELEMENT_DISABLED, true, context);
    }

    // 5. Element Not Visible
    if (lower.includes("not visible") || lower.includes("hidden") || lower.includes("zero bounding box")) {
      return new AgentError(message, ErrorCode.ELEMENT_NOT_VISIBLE, true, context);
    }

    // 6. Element Not Found / Stale
    if (lower.includes("target closed") || lower.includes("stale") || lower.includes("node is detached")) {
      return new AgentError(message, ErrorCode.STALE_TARGET, true, context);
    }
    if (
      lower.includes("not found") ||
      lower.includes("failed to locate") ||
      lower.includes("no node found") ||
      lower.includes("waiting for locator")
    ) {
      return new AgentError(message, ErrorCode.ELEMENT_NOT_FOUND, true, context);
    }

    // 7. Navigation & Network
    if (lower.includes("net::") || lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("network")) {
      return new AgentError(message, ErrorCode.NETWORK_ERROR, true, context);
    }
    if (lower.includes("navigation") || lower.includes("failed to navigate") || lower.includes("url mismatch")) {
      return new AgentError(message, ErrorCode.NAVIGATION_FAILED, true, context);
    }

    // 8. Timeout
    if (lower.includes("timeout") || lower.includes("timed out")) {
      return new AgentError(message, ErrorCode.TIMEOUT, true, context);
    }

    // 9. Rate Limited
    if (lower.includes("429") || lower.includes("too many requests") || lower.includes("rate limit")) {
      return new AgentError(message, ErrorCode.RATE_LIMITED, true, context);
    }

    // 10. Downloads
    if (lower.includes("download")) {
      return new AgentError(message, ErrorCode.DOWNLOAD_FAILED, true, context);
    }

    // 11. Verification / Validation
    if (lower.includes("verification failed")) {
      return new AgentError(message, ErrorCode.VERIFICATION_FAILED, true, context);
    }
    if (lower.includes("validation failed") || lower.includes("guardrail")) {
      return new AgentError(message, ErrorCode.VALIDATION_FAILED, true, context);
    }

    // 12. Cancelled
    if (lower.includes("abort") || lower.includes("cancelled")) {
      return new AgentError(message, ErrorCode.CANCELLED, false, context);
    }

    return new AgentError(message, ErrorCode.UNKNOWN_ERROR, true, context);
  }

  /**
   * Evaluates the error context and determines the optimal recovery strategy
   */
  static determineRecovery(ctx: RecoveryContext): RecoveryDecision {
    const agentErr = this.classifyError(ctx.error, {
      action: ctx.action,
      url: ctx.observation?.url,
    });

    // 1. Unrecoverable without user
    if (agentErr.code === ErrorCode.CAPTCHA_DETECTED) {
      return {
        strategy: "WAITING_FOR_USER",
        reason: "CAPTCHA detected on page. Manual user intervention required to proceed safely.",
        terminal: false,
      };
    }

    if (agentErr.code === ErrorCode.AUTH_REQUIRED) {
      return {
        strategy: "WAITING_FOR_USER",
        reason: "Authentication or credentials required to continue. Awaiting user action.",
        terminal: false,
      };
    }

    if (agentErr.code === ErrorCode.CANCELLED) {
      return {
        strategy: "FAIL",
        reason: "Task cancelled by user request.",
        terminal: true,
      };
    }

    // 2. Check if attempts exceeded
    if (ctx.attempt >= ctx.maxAttempts) {
      // If replans are still available, attempt replanning rather than immediate failure
      if (ctx.replansUsed < ctx.maxReplans) {
        return {
          strategy: "REPLAN",
          reason: `Action '${ctx.action.type}' exceeded max retries (${ctx.maxAttempts}). Triggering dynamic replan from current state.`,
          terminal: false,
        };
      }

      return {
        strategy: "FAIL",
        reason: `Action failed after ${ctx.attempt} attempts and ${ctx.replansUsed} replan revisions: ${agentErr.message}`,
        terminal: true,
      };
    }

    // 3. Alternative locator strategy on locator failures
    if (
      (agentErr.code === ErrorCode.ELEMENT_NOT_FOUND ||
        agentErr.code === ErrorCode.STALE_TARGET ||
        agentErr.code === ErrorCode.ELEMENT_NOT_VISIBLE) &&
      ctx.observation &&
      ctx.action.target
    ) {
      const alternative = this.findAlternativeLocator(
        ctx.action.target,
        ctx.observation,
        ctx.action.risk,
        ctx.failedTargets
      );
      if (alternative) {
        return {
          strategy: "RETRY_WITH_ALTERNATIVE_LOCATOR",
          suggestedTarget: alternative,
          reason: `Discovered alternative semantic locator: ${alternative.strategy}="${alternative.value}"`,
          terminal: false,
        };
      }

      // If no alternative locator exists and attempt >= 2, avoid spinning with identical failing locator
      if (ctx.attempt >= 2 && ctx.replansUsed < ctx.maxReplans) {
        return {
          strategy: "REPLAN",
          reason: `Target '${ctx.action.target.value}' cannot be resolved to a visible interactive element and no alternative locator exists. Triggering dynamic replan from current state.`,
          terminal: false,
        };
      }
    }

    // 4. Rate limiting requires longer backoff
    if (agentErr.code === ErrorCode.RATE_LIMITED) {
      return {
        strategy: "RETRY_WITH_BACKOFF",
        backoffMs: 5000 * Math.pow(2, ctx.attempt - 1),
        reason: "Rate limited. Applying exponential backoff before retry.",
        terminal: false,
      };
    }

    // 5. Transient error retry with exponential backoff
    const baseBackoff = ctx.action.retries?.backoffMs ?? 500;
    const computedBackoff = baseBackoff * Math.pow(1.5, ctx.attempt - 1);

    return {
      strategy: "RETRY_WITH_BACKOFF",
      backoffMs: Math.min(computedBackoff, 5000),
      reason: `Transient error (${agentErr.code}): retrying attempt ${ctx.attempt + 1}/${ctx.maxAttempts}`,
      terminal: false,
    };
  }

  /**
   * Search observation for alternative candidate locators matching the target's semantic intent
   * Enforces risk-aware guardrails preventing unauthorized escalation (Part 12)
   */
  static findAlternativeLocator(
    target: ElementTarget,
    observation: PageObservation,
    actionRisk?: (typeof import("../types/actions").RiskLevel)[keyof typeof import("../types/actions").RiskLevel],
    failedTargets?: Set<string>
  ): ElementTarget | null {
    const targetQuery = (target.value || target.name || "").toLowerCase().trim();
    if (!targetQuery) return null;

    // HIGH-RISK ACTIONS: strictly prohibit loose synonym escalation
    const isHighRisk =
      actionRisk === "high" ||
      /\b(buy|purchase|pay|checkout|delete|remove|destroy|submit application)\b/i.test(targetQuery);

    const candidates = observation.interactiveElements;

    // Reject candidates that match the currently failed target or previously recorded failed targets
    const isAlreadyFailed = (strategy: string, val: string) => {
      const valLower = val.toLowerCase().trim();
      if (target.strategy === strategy && targetQuery === valLower) {
        return true;
      }
      if (failedTargets && (failedTargets.has(`${strategy}:${valLower}`) || failedTargets.has(`any:${valLower}`))) {
        return true;
      }
      return false;
    };

    // 1. Direct or substring text / attribute match
    // Prioritize visible, unique descriptors (placeholder, testId, text) over generic names
    for (const el of candidates) {
      if (!el.isVisible || !el.isEnabled) continue;
      const elText = (el.text || "").toLowerCase();
      const elName = (el.name || "").toLowerCase();
      const elPlaceholder = (el.placeholder || "").toLowerCase();
      const elTestId = (el.testId || "").toLowerCase();

      if (elPlaceholder && elPlaceholder.includes(targetQuery) && el.placeholder) {
        if (!isAlreadyFailed("placeholder", el.placeholder)) {
          return { strategy: "placeholder", value: el.placeholder };
        }
      }

      if (elTestId && elTestId.includes(targetQuery) && el.testId) {
        if (!isAlreadyFailed("testId", el.testId)) {
          return { strategy: "testId", value: el.testId };
        }
      }

      if (elText && (elText.includes(targetQuery) || targetQuery.includes(elText)) && el.text) {
        if (!isAlreadyFailed("text", el.text)) {
          return { strategy: "text", value: el.text, role: el.role };
        }
      }

      if (elName && elName.includes(targetQuery) && el.name) {
        if (!isAlreadyFailed("name", el.name)) {
          return { strategy: "name", value: el.name };
        }
      }
    }

    // For high-risk actions, NEVER allow loose synonym matching!
    if (isHighRisk) {
      return null;
    }

    // 2. Safe semantic synonym matching (low/medium risk only)
    const SAFE_SYNONYM_GROUPS = [
      ["search", "find", "query", "lookup", "explore", "q"],
      ["login", "sign in", "signin", "authenticate", "log in"],
      ["download", "export", "pdf"],
      ["cart", "basket"], // Strictly decoupled from checkout/buy!
      ["close", "cancel", "dismiss", "exit"],
    ];

    const targetWords = targetQuery.split(/\s+/);
    for (const group of SAFE_SYNONYM_GROUPS) {
      const hasTargetSynonym = targetWords.some((w) => group.includes(w)) || group.some((g) => targetQuery.includes(g));
      if (!hasTargetSynonym) continue;

      for (const el of candidates) {
        if (!el.isVisible || !el.isEnabled) continue;
        const elText = (el.text || "").toLowerCase();
        const elTestId = (el.testId || "").toLowerCase();
        const elPlaceholder = (el.placeholder || "").toLowerCase();

        const matchesSynonym = group.some(
          (syn) => elText.includes(syn) || elTestId.includes(syn) || elPlaceholder.includes(syn)
        );
        if (matchesSynonym) {
          if (el.placeholder && !isAlreadyFailed("placeholder", el.placeholder)) {
            return { strategy: "placeholder", value: el.placeholder };
          }
          if (el.testId && !isAlreadyFailed("testId", el.testId)) {
            return { strategy: "testId", value: el.testId };
          }
          if (el.text && !isAlreadyFailed("text", el.text)) {
            return {
              strategy: "text",
              value: el.text,
              role: el.role,
            };
          }
        }
      }
    }

    return null;
  }
}
