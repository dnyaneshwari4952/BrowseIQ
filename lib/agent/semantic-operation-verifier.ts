import fs from "fs";
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
  media: [ActionType.MEDIA_PLAY, ActionType.MEDIA_PAUSE, ActionType.MEDIA_MUTE, ActionType.CLICK],
  media_play: [ActionType.MEDIA_PLAY, ActionType.CLICK],
  play: [ActionType.MEDIA_PLAY, ActionType.CLICK],
  media_pause: [ActionType.MEDIA_PAUSE, ActionType.CLICK],
  pause: [ActionType.MEDIA_PAUSE, ActionType.CLICK],
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
    if (clean.includes("pause")) return "media_pause";
    if (clean.includes("play")) return "media_play";
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
        return (
          successfulSteps.some((s) => s.actionId?.startsWith("api-")) ||
          successfulSteps.some((s) => {
            const sType = String(s.type).toLowerCase();
            return (
              sType === ActionType.NAVIGATE ||
              sType === ActionType.BACK ||
              sType === ActionType.FORWARD ||
              sType === ActionType.RELOAD
            );
          })
        );

      case "fill":
      case "type":
        return successfulSteps.some((s) => {
          const sType = String(s.type).toLowerCase();
          return sType === ActionType.FILL || sType === ActionType.TYPE || sType === ActionType.SELECT || sType === ActionType.CHECK;
        });

      case "click":
        return successfulSteps.some((s) => {
          const sType = String(s.type).toLowerCase();
          return sType === ActionType.CLICK || sType === ActionType.DOUBLE_CLICK;
        });

      case "upload":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.UPLOAD.toLowerCase());

      case "open_new_tab":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.OPEN_NEW_TAB.toLowerCase());

      case "switch_tab":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.SWITCH_TAB.toLowerCase());

      case "close_tab":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.CLOSE_TAB.toLowerCase());

      case "wait":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.WAIT.toLowerCase());

      case "media":
      case "media_play":
      case "play":
        return this.verifyMediaPlayOperation({
          steps: successfulSteps,
          observation,
          extractedData,
        });

      case "media_pause":
      case "pause":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.MEDIA_PAUSE.toLowerCase());

      case "assert":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.ASSERT.toLowerCase() && s.verified !== false);

      case "screenshot":
        return successfulSteps.some((s) => String(s.type).toLowerCase() === ActionType.SCREENSHOT.toLowerCase());

      default:
        // Fail closed: Unknown or unsupported high-level operations cannot be presumed accomplished
        return false;
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
    const CONFIRMATION_TEXT_PATTERN = /(form\s+submitted|submission\s+successful|thank\s+you|successfully\s+submitted|message\s+sent|inquiry\s+received|confirmed|correct\s+button\s+clicked)/i;

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
          el.id === "dom-success-message" ||
          (el.id && /success|confirm/i.test(el.id)) ||
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

    let queryEntered = false;
    let submissionTriggered = false;

    for (const step of steps) {
      const sType = String(step.type).toLowerCase();
      const plannedAction = planActions?.find((a) => a.id === step.actionId);
      const target = step.target || plannedAction?.target;
      const targetVal = String(target?.value || "");
      const reason = String(step.reason || plannedAction?.reason || "");

      if (sType === ActionType.FILL || sType === ActionType.TYPE) {
        if (
          target?.strategy === "placeholder" ||
          SEARCH_INDICATOR.test(targetVal) ||
          SEARCH_INDICATOR.test(reason) ||
          Boolean(step.value || (step as any).value)
        ) {
          queryEntered = true;
        }
      }

      if (sType === ActionType.CLICK) {
        if (SEARCH_INDICATOR.test(targetVal) || SEARCH_INDICATOR.test(reason)) {
          submissionTriggered = true;
        }
      }

      if (sType === ActionType.PRESS) {
        const pressKey = String(step.value || plannedAction?.value || "").toLowerCase();
        if ((pressKey === "enter" || pressKey === "return") && (SEARCH_INDICATOR.test(reason) || SEARCH_INDICATOR.test(targetVal) || queryEntered)) {
          submissionTriggered = true;
        }
      }
    }

    if (
      observation?.url &&
      (/(\?|&)q=|\/search/i.test(observation.url) || SEARCH_INDICATOR.test(observation.url))
    ) {
      submissionTriggered = true;
    }
    if (observation?.headings?.some((h) => SEARCH_INDICATOR.test(h))) {
      submissionTriggered = true;
    }

    if (queryEntered && submissionTriggered) {
      return true;
    }

    // Observed search results state
    if (observation?.summary && SEARCH_INDICATOR.test(observation.summary) && (queryEntered || submissionTriggered)) {
      return true;
    }

    if (
      extractedData &&
      typeof extractedData === "object" &&
      (Boolean((extractedData as any).products && Array.isArray((extractedData as any).products) && (extractedData as any).products.length > 0) ||
        Boolean((extractedData as any).results && Array.isArray((extractedData as any).results) && (extractedData as any).results.length > 0) ||
        Boolean(((extractedData as any).title || (extractedData as any).name) && (extractedData as any).price))
    ) {
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
   * Requires verified downloaded artifact on disk with non-zero size.
   */
  private static verifyDownloadOperation(params: {
    steps: Array<{ type: ActionType | string; downloadPath?: string; target?: any; reason?: string }>;
    planActions?: Action[];
    downloads?: DownloadedArtifact[];
  }): boolean {
    const { steps, planActions, downloads } = params;

    // Has verified downloads in context that exist on disk with > 0 bytes
    if (downloads && downloads.length > 0) {
      const validDl = downloads.some((d) => {
        if (!d.verified || d.fileSizeBytes <= 0) return false;
        try {
          return fs.existsSync(d.savedPath) && fs.statSync(d.savedPath).size > 0;
        } catch {
          return false;
        }
      });
      if (validDl) return true;
    }

    // Has step with valid downloadPath on disk
    if (
      steps.some((s) => {
        if (!s.downloadPath) return false;
        try {
          return fs.existsSync(s.downloadPath) && fs.statSync(s.downloadPath).size > 0;
        } catch {
          return false;
        }
      })
    ) {
      return true;
    }

    return false;
  }

  /**
   * Semantic verification for "media_play" / "play"
   */
  private static verifyMediaPlayOperation(params: {
    steps: Array<{ actionId?: string; type: ActionType | string; extractedData?: unknown; verified?: boolean }>;
    observation?: PageObservation | null;
    extractedData?: unknown;
  }): boolean {
    const { steps, observation, extractedData } = params;
    const hasAuthRestrictionNotice = Boolean(
      observation?.headings?.some((h) => /(?:sign\s*in|log\s*in)\b.*(?:listen|play|full\s*track|lyrics)/i.test(h)) ||
      (observation?.summary && /(?:sign\s*in|log\s*in)\b.*(?:listen|play|full\s*track|lyrics)/i.test(observation.summary))
    );
    if (hasAuthRestrictionNotice) return false;

    const playStep = steps.find((s) => String(s.type).toLowerCase() === ActionType.MEDIA_PLAY.toLowerCase());
    if (playStep) {
      if (playStep.extractedData && typeof playStep.extractedData === "object") {
        const d = playStep.extractedData as any;
        if (d.isBlocked === true || d.playbackVerified === false || d.isPlaying === false || d.isPaused === true) {
          return false;
        }
        if (d.isPlaying === true && !d.isPaused && (d.playbackVerified === true || d.currentTime > 0)) {
          return true;
        }
      }
      return playStep.verified === true && (playStep.extractedData as any)?.playbackVerified !== false && (playStep.extractedData as any)?.isBlocked !== true;
    }

    // Check for standby status extracted from playback-progressing indicator
    const hasStandbyStep = steps.some(
      (s) =>
        s.extractedData === "STANDBY" ||
        (typeof s.extractedData === "string" && s.extractedData.includes("STANDBY"))
    );
    if (hasStandbyStep) {
      return false;
    }

    const hasActiveProgression =
      steps.some(
        (s) =>
          s.extractedData === "ACTIVE" ||
          (typeof s.extractedData === "string" && s.extractedData.includes("ACTIVE"))
      ) || extractedData === "ACTIVE";

    if (observation?.mediaElements && observation.mediaElements.length > 0) {
      const playing = observation.mediaElements.some(
        (m) =>
          (m.isPlaying || hasActiveProgression) &&
          !m.isPaused &&
          !m.error &&
          !m.isMuted &&
          (m.currentTime > 0 || hasActiveProgression)
      );
      if (playing) return true;
    }

    if (hasActiveProgression) {
      return true;
    }

    if (extractedData && typeof extractedData === "object") {
      const d = extractedData as any;
      if (d.isPlaying === true && !d.isPaused && d.isBlocked !== true && d.playbackVerified !== false) return true;
    }

    return false;
  }
}
