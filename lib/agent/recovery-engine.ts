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

export type VectorFailureCategory =
  | "timeout_or_element_not_ready"
  | "missing_or_ambiguous_locator"
  | "stale_page_context"
  | "failed_navigation"
  | "transient_network_failure"
  | "permission_denial"
  | "site_restriction_or_challenge"
  | "unsupported_action"
  | "failed_postcondition"
  | "fatal_error";

export function mapToVectorCategory(code: string): VectorFailureCategory {
  switch (code) {
    case ErrorCode.TIMEOUT:
      return "timeout_or_element_not_ready";
    case ErrorCode.ELEMENT_NOT_FOUND:
    case ErrorCode.ELEMENT_AMBIGUOUS:
    case ErrorCode.ELEMENT_NOT_VISIBLE:
    case ErrorCode.ELEMENT_DISABLED:
      return "missing_or_ambiguous_locator";
    case ErrorCode.STALE_TARGET:
    case ErrorCode.PAGE_CHANGED:
      return "stale_page_context";
    case ErrorCode.NAVIGATION_FAILED:
      return "failed_navigation";
    case ErrorCode.NETWORK_ERROR:
    case ErrorCode.RATE_LIMITED:
      return "transient_network_failure";
    case ErrorCode.PERMISSION_ERROR:
    case ErrorCode.SECURITY_POLICY_VIOLATION:
    case ErrorCode.SSRF_BLOCKED:
      return "permission_denial";
    case ErrorCode.CAPTCHA_DETECTED:
    case ErrorCode.AUTH_REQUIRED:
    case ErrorCode.AUTHENTICATION_ERROR:
      return "site_restriction_or_challenge";
    case ErrorCode.UNSUPPORTED_ACTION:
    case ErrorCode.VALIDATION_FAILED:
      return "unsupported_action";
    case ErrorCode.POSTCONDITION_FAILED:
    case ErrorCode.VERIFICATION_FAILED:
      return "failed_postcondition";
    case ErrorCode.FATAL_ERROR:
    case ErrorCode.BROWSER_CRASH:
    case ErrorCode.BROWSER_LAUNCH_FAILED:
    default:
      return "fatal_error";
  }
}

export interface RecoveryDecisionRecord {
  timestamp: string;
  originalErrorCategory: string;
  vectorCategory?: VectorFailureCategory;
  currentUrl?: string;
  evidence: {
    pageTitle?: string;
    hasCaptcha?: boolean;
    is404?: boolean;
    attempt: number;
    maxAttempts: number;
  };
  chosenStrategy: RecoveryStrategy;
  anotherAttemptPermitted: boolean;
  finalOutcome?: string;
  reason: string;
}

export interface RecoveryDecision {
  strategy: RecoveryStrategy;
  reason: string;
  suggestedTarget?: ElementTarget;
  alternativeActions?: Action[];
  backoffMs?: number;
  terminal: boolean;
  requiresConfirmation?: boolean;
  record?: RecoveryDecisionRecord;
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
   * Identifies whether an action could produce persistent external side effects
   * (e.g. form submission, order, payment, deletion, upload, messaging)
   */
  static isSideEffectingAction(action: Action): boolean {
    if (action.type === ActionType.UPLOAD) return true;
    const targetQuery = (action.target?.value || action.target?.name || action.reason || "").toLowerCase();
    const SIDE_EFFECT_VERBS = /\b(submit|send|buy|purchase|pay|order|checkout|delete|remove|destroy|book|subscribe|transfer|upload)\b/i;

    if (action.type === ActionType.CLICK && SIDE_EFFECT_VERBS.test(targetQuery)) {
      return true;
    }
    if (
      action.type === ActionType.PRESS &&
      String(action.value || "").toLowerCase() === "enter" &&
      SIDE_EFFECT_VERBS.test(targetQuery)
    ) {
      return true;
    }
    return false;
  }

  /**
   * Classify any raw error into an AgentError with a standard ErrorCode (Section 10)
   */
  static classifyError(error: unknown, context?: { action?: Action; url?: string }): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    // 1. CAPTCHA & Access Challenges (Google /sorry/, Cloudflare, Turnstile)
    if (
      lower.includes("captcha") ||
      lower.includes("cf-challenge") ||
      lower.includes("recaptcha") ||
      lower.includes("turnstile") ||
      lower.includes("/sorry/") ||
      lower.includes("unusual traffic") ||
      context?.url?.toLowerCase().includes("/sorry/")
    ) {
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
    if (lower.includes("navigation") || lower.includes("failed to navigate") || lower.includes("url mismatch") || lower.includes("404")) {
      return new AgentError(message, ErrorCode.NAVIGATION_FAILED, false, context);
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

    // 11. Verification / Postcondition / Validation
    if (lower.includes("postcondition")) {
      return new AgentError(message, ErrorCode.POSTCONDITION_FAILED, true, context);
    }
    if (lower.includes("verification failed")) {
      return new AgentError(message, ErrorCode.VERIFICATION_FAILED, true, context);
    }
    if (lower.includes("unsupported") || lower.includes("not supported")) {
      return new AgentError(message, ErrorCode.UNSUPPORTED_ACTION, false, context);
    }
    if (lower.includes("validation failed") || lower.includes("guardrail")) {
      return new AgentError(message, ErrorCode.VALIDATION_FAILED, true, context);
    }

    // 12. Fatal & Crash
    if (lower.includes("crash") || lower.includes("fatal") || lower.includes("disconnected") || lower.includes("context closed")) {
      return new AgentError(message, ErrorCode.FATAL_ERROR, false, context);
    }

    // 13. Cancelled
    if (lower.includes("abort") || lower.includes("cancelled")) {
      return new AgentError(message, ErrorCode.CANCELLED, false, context);
    }

    return new AgentError(message, ErrorCode.UNKNOWN_ERROR, true, context);
  }

  /**
   * Helper to construct a structured RecoveryDecisionRecord adhering to Step 8.
   */
  private static buildDecision(
    raw: Omit<RecoveryDecision, "record">,
    agentErr: AgentError,
    ctx: RecoveryContext
  ): RecoveryDecision {
    const record: RecoveryDecisionRecord = {
      timestamp: new Date().toISOString(),
      originalErrorCategory: agentErr.code,
      vectorCategory: mapToVectorCategory(agentErr.code),
      currentUrl: ctx.observation?.url,
      evidence: {
        pageTitle: ctx.observation?.title,
        hasCaptcha: agentErr.code === ErrorCode.CAPTCHA_DETECTED,
        is404: Boolean(
          ctx.observation?.title?.toLowerCase().includes("404") ||
          ctx.observation?.url?.includes("/404")
        ),
        attempt: ctx.attempt,
        maxAttempts: ctx.maxAttempts,
      },
      chosenStrategy: raw.strategy,
      anotherAttemptPermitted: !raw.terminal && raw.strategy !== "FAIL" && raw.strategy !== "WAITING_FOR_USER",
      reason: raw.reason,
    };
    return { ...raw, record };
  }

  /**
   * Evaluates the error context and determines the optimal recovery strategy with structured decision record (Step 8)
   */
  static determineRecovery(ctx: RecoveryContext): RecoveryDecision {
    const agentErr = this.classifyError(ctx.error, {
      action: ctx.action,
      url: ctx.observation?.url,
    });
    const raw = this.determineRawRecovery(ctx, agentErr);
    return this.buildDecision(raw, agentErr, ctx);
  }

  private static determineRawRecovery(ctx: RecoveryContext, agentErr: AgentError): Omit<RecoveryDecision, "record"> {
    // 1. Unrecoverable without user / terminal
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

    // 404 / Missing page detection in observation (halt immediately without pointless retries)
    if (ctx.observation) {
      const pageTitle = (ctx.observation.title || "").toLowerCase();
      const pageHeading = (ctx.observation.headings || []).join(" ").toLowerCase();
      if (
        pageTitle.includes("404") ||
        pageTitle.includes("page not found") ||
        pageHeading.includes("404") ||
        pageHeading.includes("page not found") ||
        ctx.observation.url.includes("/404")
      ) {
        return {
          strategy: "FAIL",
          reason: `Target page returned HTTP 404 / Not Found (${ctx.observation.url}). Halting execution immediately.`,
          terminal: true,
        };
      }
    }

    // Non-recoverable failures must not be retried blindly (Section 2 & Section 3)
    if (!agentErr.recoverable) {
      return {
        strategy: "FAIL",
        reason: `Non-recoverable failure (${agentErr.code}): ${agentErr.message}`,
        terminal: true,
      };
    }

    // Ambiguous target error requires clarification rather than random selection
    if (agentErr.code === ErrorCode.ELEMENT_AMBIGUOUS) {
      return {
        strategy: "WAITING_FOR_USER",
        reason: agentErr.message || `Target '${ctx.action.target?.value || ctx.action.type}' is ambiguous with multiple visible candidates. User clarification required.`,
        requiresConfirmation: true,
        terminal: false,
      };
    }

    // Structural Precondition / about:blank guard (Requirement 3 & 7)
    // A locator or precondition error on about:blank must NOT produce repeated retries on the same nonexistent control
    const isBlank = (ctx.observation && ctx.observation.url === "about:blank") || agentErr.message.toLowerCase().includes("about:blank");
    const isPreconditionOrLocatorError =
      agentErr.code === ErrorCode.VALIDATION_FAILED ||
      agentErr.code === ErrorCode.ELEMENT_NOT_FOUND ||
      agentErr.message.toLowerCase().includes("about:blank") ||
      agentErr.message.toLowerCase().includes("precondition");

    if (isBlank && isPreconditionOrLocatorError) {
      if (ctx.replansUsed >= ctx.maxReplans) {
        return {
          strategy: "FAIL",
          reason: `Precondition failed: Browser remained at 'about:blank' and cannot execute action '${ctx.action.type}'. Max replans exhausted.`,
          terminal: true,
        };
      }

      const navAction = ctx.plan?.actions.find((a) => a.type === ActionType.NAVIGATE && typeof a.value === "string");
      const hasResolvedUrl = Boolean(navAction?.value);

      // Explicit no-progress detection: if already replanned and still stuck at about:blank without navigation
      if (ctx.replansUsed > 0 && !hasResolvedUrl) {
        return {
          strategy: "WAITING_FOR_USER",
          reason: "No-progress detected: Browser remained at 'about:blank' after replan attempt. Target website must be provided to proceed.",
          requiresConfirmation: true,
          terminal: false,
        };
      }

      return {
        strategy: "REPLAN",
        reason: `Missing navigation prerequisite: Browser is at 'about:blank' for action '${ctx.action.type}'. Triggering plan repair to open target website first.`,
        terminal: false,
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

    // 3. Side-effecting operations guard before retry (Section 3)
    if (this.isSideEffectingAction(ctx.action)) {
      return {
        strategy: "WAITING_FOR_USER",
        reason: `Action '${ctx.action.type}' is a potentially side-effecting operation (e.g. submit/purchase/delete/send) and its outcome is uncertain after failure. Automatic retry aborted to prevent duplicate side effects. User confirmation required.`,
        requiresConfirmation: true,
        terminal: false,
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
      const alternatives = this.findAlternativeLocators(
        ctx.action.target,
        ctx.observation,
        ctx.action.risk,
        ctx.failedTargets,
        ctx.action.value ? String(ctx.action.value) : undefined
      );

      if (alternatives.length > 1) {
        return {
          strategy: "WAITING_FOR_USER",
          reason: `Multiple ambiguous replacement controls (${alternatives.length} candidates) match target '${ctx.action.target.value}'. User clarification required.`,
          requiresConfirmation: true,
          terminal: false,
        };
      }

      if (alternatives.length === 1) {
        const alternative = alternatives[0];
        return {
          strategy: "RETRY_WITH_ALTERNATIVE_LOCATOR",
          suggestedTarget: alternative,
          reason: `Discovered uniquely identifiable alternative semantic locator: ${alternative.strategy}="${alternative.value}"`,
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
   * Search observation for alternative candidate locators matching the target's semantic intent.
   * Returns matching replacement ElementTargets, ranking and deduplicating them semantically.
   */
  static findAlternativeLocators(
    target: ElementTarget,
    observation: PageObservation,
    actionRisk?: (typeof import("../types/actions").RiskLevel)[keyof typeof import("../types/actions").RiskLevel],
    failedTargets?: Set<string>,
    semanticValue?: string
  ): ElementTarget[] {
    // 1. Extract clean semantic query, avoiding CSS selector strings like 'a[href*="watch"]'
    let cleanQuery = (semanticValue || "").trim().toLowerCase();
    if (!cleanQuery && target.value) {
      const hasTextMatch = target.value.match(/:has-text\(\s*["']([^"']+)["']\s*\)/i);
      if (hasTextMatch) {
        cleanQuery = hasTextMatch[1].trim().toLowerCase();
      } else if (/^[a-z0-9\-_: ]+$/i.test(target.value)) {
        cleanQuery = target.value.trim().toLowerCase();
      } else {
        // Strip out CSS attribute brackets, classes, tags
        const stripped = target.value
          .replace(/\[[^\]]+\]/g, " ")
          .replace(/[#.][a-zA-Z0-9_-]+/g, " ")
          .replace(/\b(?:a|button|input|div|span|h[1-6]|main|section)\b/gi, " ")
          .replace(/['".,!?:;()\-–—]/g, " ")
          .trim()
          .toLowerCase();
        if (stripped.length >= 3) {
          cleanQuery = stripped;
        }
      }
    }
    if (!cleanQuery) {
      cleanQuery = (target.name || "").trim().toLowerCase();
    }
    if (!cleanQuery) return [];

    // HIGH-RISK ACTIONS: strictly prohibit loose synonym escalation
    const isHighRisk =
      actionRisk === "high" ||
      /\b(buy|purchase|pay|checkout|delete|remove|destroy|submit application)\b/i.test(cleanQuery);

    const candidates = observation.interactiveElements;

    // Reject candidates that match the currently failed target or previously recorded failed targets
    const isAlreadyFailed = (strategy: string, val: string) => {
      const valLower = val.toLowerCase().trim();
      if (target.strategy === strategy && (target.value || "").toLowerCase().trim() === valLower) {
        return true;
      }
      if (failedTargets && (failedTargets.has(`${strategy}:${valLower}`) || failedTargets.has(`any:${valLower}`))) {
        return true;
      }
      return false;
    };

    interface ScoredAlternative {
      target: ElementTarget;
      score: number;
      text: string;
    }

    const scoredMatches: ScoredAlternative[] = [];
    const seenSignatures = new Set<string>();

    const addMatch = (tgt: ElementTarget, score: number, text: string) => {
      const sig = `${tgt.strategy}:${tgt.value}`.toLowerCase();
      if (!seenSignatures.has(sig)) {
        seenSignatures.add(sig);
        scoredMatches.push({ target: tgt, score, text });
      }
    };

    const queryTokens = cleanQuery
      .split(/\s+/)
      .filter((w) => w.length > 1 && !["the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by"].includes(w));

    // 1. Direct or substring text / attribute match
    for (const el of candidates) {
      if (!el.isVisible || !el.isEnabled) continue;
      const elText = (el.text || "").toLowerCase().trim();
      const elName = (el.name || "").toLowerCase().trim();
      const elPlaceholder = (el.placeholder || "").toLowerCase().trim();
      const elTestId = (el.testId || "").toLowerCase().trim();

      // Check testId / placeholder exact or substring
      if (elPlaceholder && elPlaceholder.includes(cleanQuery) && el.placeholder) {
        if (!isAlreadyFailed("placeholder", el.placeholder)) {
          addMatch({ strategy: "placeholder", value: el.placeholder }, 0.9, elPlaceholder);
        }
      }

      if (elTestId && elTestId.includes(cleanQuery) && el.testId) {
        if (!isAlreadyFailed("testId", el.testId)) {
          addMatch({ strategy: "testId", value: el.testId }, 0.95, elTestId);
        }
      }

      if (elText) {
        let textScore = 0;
        if (elText === cleanQuery) {
          textScore = 1.0;
        } else if (elText.startsWith(cleanQuery)) {
          textScore = 0.9;
        } else if (elText.includes(cleanQuery)) {
          textScore = 0.8;
        } else if (queryTokens.length > 0) {
          let tokenMatches = 0;
          for (const tok of queryTokens) {
            if (elText.includes(tok)) tokenMatches++;
          }
          if (tokenMatches > 0) {
            textScore = 0.5 * (tokenMatches / queryTokens.length);
          }
        }

        if (textScore >= 0.5 && el.text) {
          if (!isAlreadyFailed("text", el.text)) {
            addMatch({ strategy: "text", value: el.text, role: el.role }, textScore, el.text);
          }
        }
      }

      if (elName && elName.includes(cleanQuery) && el.name) {
        if (!isAlreadyFailed("name", el.name)) {
          addMatch({ strategy: "name", value: el.name }, 0.7, elName);
        }
      }
    }

    if (scoredMatches.length > 0) {
      // Sort matches descending by score
      scoredMatches.sort((a, b) => b.score - a.score);

      const top = scoredMatches[0];
      const second = scoredMatches.length > 1 ? scoredMatches[1] : null;

      // If top candidate is a clear winner (score >= 0.8 and margin >= 0.15 over second)
      if (top.score >= 0.8 && (!second || top.score - second.score >= 0.15)) {
        return [top.target];
      }

      return scoredMatches.map((m) => m.target);
    }

    // For high-risk actions, NEVER allow loose synonym matching!
    if (isHighRisk) {
      return [];
    }

    // 2. Safe semantic synonym matching (low/medium risk only)
    const SAFE_SYNONYM_GROUPS = [
      ["search", "find", "query", "lookup", "explore", "q"],
      ["login", "sign in", "signin", "authenticate", "log in"],
      ["download", "export", "pdf"],
      ["cart", "basket"],
      ["close", "cancel", "dismiss", "exit"],
    ];

    const targetWords = cleanQuery.split(/\s+/);
    for (const group of SAFE_SYNONYM_GROUPS) {
      const hasTargetSynonym = targetWords.some((w) => group.includes(w)) || group.some((g) => cleanQuery.includes(g));
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
            addMatch({ strategy: "placeholder", value: el.placeholder }, 0.6, el.placeholder);
          } else if (el.testId && !isAlreadyFailed("testId", el.testId)) {
            addMatch({ strategy: "testId", value: el.testId }, 0.6, el.testId);
          } else if (el.text && !isAlreadyFailed("text", el.text)) {
            addMatch({ strategy: "text", value: el.text, role: el.role }, 0.6, el.text);
          }
        }
      }
    }

    return scoredMatches.map((m) => m.target);
  }

  /**
   * Search observation for a uniquely identifiable replacement locator matching target intent.
   * Returns null if no match or if multiple ambiguous candidates exist.
   */
  static findAlternativeLocator(
    target: ElementTarget,
    observation: PageObservation,
    actionRisk?: (typeof import("../types/actions").RiskLevel)[keyof typeof import("../types/actions").RiskLevel],
    failedTargets?: Set<string>,
    semanticValue?: string
  ): ElementTarget | null {
    const alternatives = this.findAlternativeLocators(target, observation, actionRisk, failedTargets, semanticValue);
    return alternatives.length === 1 ? alternatives[0] : null;
  }
}
