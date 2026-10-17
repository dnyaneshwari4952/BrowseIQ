import { Action, ActionType, ActionStatus } from "../types/actions";
import { PageObservation } from "../types/browser";
import { DownloadedArtifact } from "../types/results";

/**
 * Centralized High-Level Semantic Operation to Concrete Action Mapping
 * (Requirements 1, 2, 3, 4, 5)
 */
export const SEMANTIC_OPERATION_ACTIONS: Record<string, ActionType[]> = {
  submit: [ActionType.CLICK, ActionType.PRESS],
  search: [ActionType.FILL, ActionType.TYPE, ActionType.CLICK, ActionType.PRESS, ActionType.EVALUATE_SAFE],
  extract: [ActionType.EXTRACT_TEXT, ActionType.EXTRACT_ATTRIBUTE, ActionType.EXTRACT_TABLE, ActionType.EVALUATE_SAFE],
  navigate: [ActionType.NAVIGATE, ActionType.BACK, ActionType.FORWARD, ActionType.RELOAD],
  fill: [ActionType.FILL, ActionType.TYPE, ActionType.SELECT, ActionType.CHECK, ActionType.UNCHECK],
  type: [ActionType.TYPE, ActionType.FILL],
  click: [ActionType.CLICK, ActionType.DOUBLE_CLICK],
  wait: [ActionType.WAIT],
  download: [ActionType.DOWNLOAD, ActionType.CLICK],
  upload: [ActionType.UPLOAD],
  open_tab: [ActionType.OPEN_NEW_TAB],
  open_new_tab: [ActionType.OPEN_NEW_TAB],
  switch_tab: [ActionType.SWITCH_TAB],
  close_tab: [ActionType.CLOSE_TAB],
  screenshot: [ActionType.SCREENSHOT],
  assert: [ActionType.ASSERT],
};

export interface SemanticOperationCheckParams {
  operation: string;
  completedSteps: Array<{
    actionId?: string;
    type: ActionType | string;
    status: ActionStatus | string;
    extractedData?: unknown;
    downloadPath?: string;
    target?: any;
    value?: unknown;
    reason?: string;
    verified?: boolean;
  }>;
  planActions?: Action[];
  observation?: PageObservation | null;
  extractedData?: unknown;
  downloads?: DownloadedArtifact[];
}

export class SemanticOperationVerifier {
  /**
   * Normalizes arbitrary user/LLM operation string to canonical operation key
   */
  static normalizeOperation(op: string): string {
    const clean = op.toLowerCase().replace(/[\s\-_]+/g, "");
    if (clean.includes("submit")) return "submit";
    if (clean.includes("search") || clean.includes("query")) return "search";
    if (clean.includes("extract")) return "extract";
    if (clean.includes("navigate") || clean.includes("goto") || clean.includes("openpage")) return "navigate";
    if (clean.includes("download")) return "download";
    if (clean.includes("upload")) return "upload";
    if (clean.includes("opennewtab") || clean.includes("opentab") || clean.includes("newtab")) return "open_new_tab";
    if (clean.includes("switchtab")) return "switch_tab";
    if (clean.includes("closetab")) return "close_tab";
    if (clean.includes("fill")) return "fill";
    if (clean.includes("type")) return "type";
    if (clean.includes("click")) return "click";
    if (clean.includes("wait")) return "wait";
    return op.toLowerCase();
  }

  /**
   * Evaluates whether a high-level semantic operation was legitimately accomplished
   * by completed concrete browser actions, target metadata, and post-action state.
   */
  static isOperationAccomplished(params: SemanticOperationCheckParams): boolean {
    const { operation, completedSteps, planActions, observation, extractedData, downloads } = params;
    const normOp = this.normalizeOperation(operation);
    const validActionTypes = SEMANTIC_OPERATION_ACTIONS[normOp] || [];

    // Filter successfully completed steps
    const successfulSteps = completedSteps.filter((s) => s.status === ActionStatus.COMPLETED || s.verified === true);
    if (successfulSteps.length === 0) {
      return false;
    }

    switch (normOp) {
      case "submit":
        return this.verifySubmitOperation({
          steps: successfulSteps,
          planActions,
          observation,
        });

      case "search":
        return this.verifySearchOperation({
          steps: successfulSteps,
          planActions,
          observation,
          extractedData,
        });

      case "extract":
        return this.verifyExtractOperation({
          steps: successfulSteps,
          extractedData,
        });

      case "download":
        return this.verifyDownloadOperation({
          steps: successfulSteps,
          planActions,
          downloads,
        });

      case "navigate":
        return successfulSteps.some((s) => {
          const sType = String(s.type).toLowerCase();
          return sType === ActionType.NAVIGATE || sType === ActionType.BACK || sType === ActionType.FORWARD || sType === ActionType.RELOAD;
        });

      case "fill":
      case "type":
        return successfulSteps.some((s) => {
          const sType = String(s.type).toLowerCase();
          return sType === ActionType.FILL || sType === ActionType.TYPE || sType === ActionType.SELECT || sType === ActionType.CHECK;
        });

      case "open_new_tab":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.OPEN_NEW_TAB.toLowerCase());

      case "switch_tab":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.SWITCH_TAB.toLowerCase());

      case "close_tab":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.CLOSE_TAB.toLowerCase());

      case "wait":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.WAIT.toLowerCase());

      default:
        // Generic fallback: check if action type matches canonical valid types or literal name
        return successfulSteps.some((s) => {
          const sType = String(s.type).toLowerCase();
          if (sType === normOp || sType === operation.toLowerCase()) return true;
          return validActionTypes.some((vat) => vat.toLowerCase() === sType);
        });
    }
  }

  /**
   * Semantic verification for "submit"
   * Requires target association with submission, or post-action confirmation state.
   * Explicitly rejects Cancel, Next, Save Draft, etc. (Requirement 3 & 4)
   */
  private static verifySubmitOperation(params: {
    steps: Array<{ actionId?: string; type: ActionType | string; target?: any; value?: unknown; reason?: string }>;
    planActions?: Action[];
    observation?: PageObservation | null;
  }): boolean {
    const { steps, planActions, observation } = params;

    // Check if post-action page observation confirms submission (Requirement 4)
    const hasConfirmationState = this.checkSubmissionConfirmationInObservation(observation);

    // Explicit disqualifiers: words that indicate NON-submission navigation or abandonment
    const DISQUALIFIER_PATTERN = /\b(cancel|next|back|previous|save\s+draft|draft|close|dismiss|reset|clear)\b/i;
    // Explicit positive submit indicators
    const SUBMIT_INDICATOR_PATTERN = /\b(submit|send|confirm|complete|finish|place\s+order|checkout|pay\b)/i;

    for (const step of steps) {
      const sType = String(step.type).toLowerCase();
      if (sType !== ActionType.CLICK && sType !== ActionType.DOUBLE_CLICK && sType !== ActionType.PRESS) {
        continue;
      }

      // Resolve planned action metadata if available
      const plannedAction = planActions?.find((a) => a.id === step.actionId);
      const target = step.target || plannedAction?.target;
      const targetVal = String(target?.value || "");
      const targetDesc = String(target?.description || "");
      const reason = String(step.reason || plannedAction?.reason || "");
      const targetTextCombined = `${targetVal} ${targetDesc} ${reason}`.trim();

      // If action is PRESS, check if Enter was pressed
      if (sType === ActionType.PRESS) {
        const pressKey = String(step.value || plannedAction?.value || "").toLowerCase();
        if (pressKey === "enter" || pressKey === "return") {
          // Valid if reason indicates submission OR confirmation state exists
          if (SUBMIT_INDICATOR_PATTERN.test(reason) || hasConfirmationState) {
            return true;
          }
        }
        continue;
      }

      // If action is CLICK, evaluate target association (Requirement 3)
      // 1. Check explicit disqualifiers (e.g. Cancel, Next, Save Draft)
      if (DISQUALIFIER_PATTERN.test(targetTextCombined) && !SUBMIT_INDICATOR_PATTERN.test(targetVal)) {
        continue; // Disqualified!
      }

      // 2. Check explicit submit indicators on target or reason
      const isTargetSubmit =
        target?.role === "button" && SUBMIT_INDICATOR_PATTERN.test(targetVal) ||
        targetVal.toLowerCase().includes("type=\"submit\"") ||
        targetVal.toLowerCase().includes("type='submit'") ||
        SUBMIT_INDICATOR_PATTERN.test(targetVal) ||
        SUBMIT_INDICATOR_PATTERN.test(targetDesc);

      if (isTargetSubmit) {
        return true;
      }

      // 3. Reason explicitly indicates form submission
      if (SUBMIT_INDICATOR_PATTERN.test(reason) && !DISQUALIFIER_PATTERN.test(targetVal)) {
        return true;
      }

      // 4. Post-action state proves submission even if target label was slightly generic
      if (hasConfirmationState && !DISQUALIFIER_PATTERN.test(targetVal)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Inspects PageObservation for evidence of successful form submission
   */
  private static checkSubmissionConfirmationInObservation(obs?: PageObservation | null): boolean {
    if (!obs) return false;
    const CONFIRMATION_TEXT_PATTERN = /(form\s+submitted|submission\s+successful|thank\s+you|successfully\s+submitted|message\s+sent|inquiry\s+received|confirmed)/i;

    // Check headings
    if (obs.headings?.some((h) => CONFIRMATION_TEXT_PATTERN.test(h))) {
      return true;
    }

    // Check summary
    if (obs.summary && CONFIRMATION_TEXT_PATTERN.test(obs.summary)) {
      return true;
    }

    // Check interactive elements or confirmation containers
    if (
      obs.interactiveElements?.some(
        (el) =>
          el.id === "submission-confirmation" ||
          CONFIRMATION_TEXT_PATTERN.test(String(el.text || "")) ||
          CONFIRMATION_TEXT_PATTERN.test(String(el.name || ""))
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Semantic verification for "search"
   */
  private static verifySearchOperation(params: {
    steps: Array<{ actionId?: string; type: ActionType | string; target?: any; value?: unknown; reason?: string }>;
    planActions?: Action[];
    observation?: PageObservation | null;
    extractedData?: unknown;
  }): boolean {
    const { steps, planActions, observation, extractedData } = params;

    // Fast check: did an API route search succeed?
    if (steps.some((s) => s.actionId?.startsWith("api-"))) {
      return true;
    }

    const SEARCH_INDICATOR = /(search|query|find|lookup)/i;

    for (const step of steps) {
      const sType = String(step.type).toLowerCase();
      const plannedAction = planActions?.find((a) => a.id === step.actionId);
      const target = step.target || plannedAction?.target;
      const targetVal = String(target?.value || "");
      const reason = String(step.reason || plannedAction?.reason || "");

      if (sType === ActionType.FILL || sType === ActionType.TYPE) {
        if (target?.strategy === "placeholder" || SEARCH_INDICATOR.test(targetVal) || SEARCH_INDICATOR.test(reason)) {
          return true;
        }
      }

      if (sType === ActionType.CLICK) {
        if (SEARCH_INDICATOR.test(targetVal) || SEARCH_INDICATOR.test(reason)) {
          return true;
        }
      }

      if (sType === ActionType.PRESS) {
        const pressKey = String(step.value || plannedAction?.value || "").toLowerCase();
        if ((pressKey === "enter" || pressKey === "return") && (SEARCH_INDICATOR.test(reason) || SEARCH_INDICATOR.test(targetVal))) {
          return true;
        }
      }
    }

    // Observed search results state
    if (observation?.summary && SEARCH_INDICATOR.test(observation.summary)) {
      return true;
    }

    if (extractedData && typeof extractedData === "object" && (Boolean((extractedData as any).title) || Boolean((extractedData as any).products))) {
      return true;
    }

    return false;
  }

  /**
   * Semantic verification for "extract"
   */
  private static verifyExtractOperation(params: {
    steps: Array<{ type: ActionType | string; extractedData?: unknown }>;
    extractedData?: unknown;
  }): boolean {
    const { steps, extractedData } = params;

    const hasExtractedStep = steps.some((s) => {
      const sType = String(s.type).toLowerCase();
      const isExtractType = sType.includes("extract");
      return isExtractType && s.extractedData !== undefined && s.extractedData !== null && s.extractedData !== "";
    });

    if (hasExtractedStep) return true;

    if (extractedData !== undefined && extractedData !== null) {
      if (typeof extractedData === "object" && Object.keys(extractedData as object).length > 0) {
        return true;
      }
      if (typeof extractedData === "string" && extractedData.trim().length > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Semantic verification for "download"
   */
  private static verifyDownloadOperation(params: {
    steps: Array<{ type: ActionType | string; downloadPath?: string; target?: any; reason?: string }>;
    planActions?: Action[];
    downloads?: DownloadedArtifact[];
  }): boolean {
    const { steps, planActions, downloads } = params;

    // Has verified downloads in context
    if (downloads && downloads.length > 0 && downloads.some((d) => d.verified)) {
      return true;
    }

    // Has step with downloadPath
    if (steps.some((s) => Boolean(s.downloadPath))) {
      return true;
    }

    // Completed download action
    return steps.some((s) => String(s.type).toLowerCase() === ActionType.DOWNLOAD);
  }
}
