import { TaskSpecification, VerificationCriterion } from "./task-specification";
import { TaskSuccessCriteria } from "../types/plans";

export interface VerificationSpecResult {
  taskSuccessCriteria: TaskSuccessCriteria;
  verificationCriteria: VerificationCriterion[];
  requiredOperations: string[];
  forbiddenOperations: string[];
}

/**
 * Verification Specification Builder (Phase 2 Component G)
 * Defines what evidence must exist before the final outcome can be reported (Section 4G).
 */
export class VerificationSpecBuilder {
  static build(spec: TaskSpecification): VerificationSpecResult {
    const requiredOperations: string[] = [];
    const forbiddenOperations: string[] = [];
    const verificationChecks: string[] = [];
    const requiredOutputs: string[] = [];
    const criteria: VerificationCriterion[] = [];

    // 1. Navigation is always required if a target URL is specified
    if (spec.targetUrl) {
      requiredOperations.push("navigate");
      verificationChecks.push("pageLoaded");
      criteria.push({
        id: "crit-nav",
        description: `Browser successfully navigated to ${spec.targetUrl}`,
        type: "URL_MATCHED",
        expectedKey: "url",
        expectedValue: spec.targetUrl,
      });
    }

    // 2. Forbidden Operations (Negations)
    for (const negation of spec.negations) {
      if (negation.forbidden) {
        forbiddenOperations.push(negation.operation);
        criteria.push({
          id: `crit-forbidden-${negation.operation}`,
          description: `Action '${negation.operation}' was forbidden by user instruction and strictly avoided`,
          type: "FORBIDDEN_ACTION_AVOIDED",
          expectedKey: negation.operation,
          forbidden: true,
        });
      }
    }

    // 3. Operation-specific criteria
    switch (spec.operation) {
      case "COMPARE":
      case "FILTER":
      case "SEARCH": {
        requiredOperations.push("search");
        verificationChecks.push("resultsExist");

        const shouldOpen = /\bopen\b/i.test(spec.originalInstruction) && !spec.negations.some((n) => n.operation === "open" && n.forbidden);
        if (shouldOpen) {
          requiredOperations.push("click");
          verificationChecks.push("navigationOccurred");
          criteria.push({
            id: "crit-open-result",
            description: "Matching search result opened and destination page reached",
            type: "STATE_OBSERVED",
          });
        } else if (spec.operation === "COMPARE" || spec.operation === "FILTER" || spec.ordering || spec.filters.length > 0 || /\b(?:price|cost|extract)\b/i.test(spec.originalInstruction)) {
          requiredOperations.push("extract");
          requiredOutputs.push("title");
          verificationChecks.push("titleExtracted");
        } else {
          criteria.push({
            id: "crit-search-results",
            description: "Search query submitted and matching results are visible",
            type: "STATE_OBSERVED",
          });
        }

        if (spec.ordering || spec.filters.length > 0 || spec.originalInstruction.toLowerCase().includes("price")) {
          requiredOutputs.push("price");
          verificationChecks.push("priceExtracted");
          verificationChecks.push("constraintSatisfied");
          criteria.push({
            id: "crit-compare-output",
            description: "Extracted product satisfies ordering and filter constraints with price provenance",
            type: "OUTPUT_EXTRACTED",
            expectedKey: "price",
          });
        }
        break;
      }

      case "COUNT":
        requiredOperations.push("search");
        requiredOperations.push("extract");
        requiredOutputs.push("count");
        verificationChecks.push("countCalculated");
        criteria.push({
          id: "crit-count-output",
          description: "Count of matching items calculated accurately",
          type: "OUTPUT_EXTRACTED",
          expectedKey: "count",
        });
        break;

      case "DOWNLOAD":
        requiredOperations.push("download");
        requiredOutputs.push("file");
        verificationChecks.push("downloadCompleted");
        criteria.push({
          id: "crit-download-file",
          description: "Downloaded file exists on disk and is non-empty",
          type: "FILE_DOWNLOADED",
          expectedKey: "file",
        });
        break;

      case "FORM_FILL":
        requiredOperations.push("fill");
        verificationChecks.push("fieldsPopulated");
        criteria.push({
          id: "crit-form-filled",
          description: "Form fields populated with validated inputs",
          type: "STATE_OBSERVED",
          expectedKey: "formFields",
        });
        break;

      case "FORM_SUBMIT":
        requiredOperations.push("fill");
        requiredOperations.push("submit");
        verificationChecks.push("formSubmitted");
        criteria.push({
          id: "crit-form-submitted",
          description: "Form submission dispatched and confirmed by page state or confirmation message",
          type: "STATE_OBSERVED",
          expectedKey: "submissionConfirmed",
        });
        break;

      case "OPEN_TAB":
        requiredOperations.push("openNewTab");
        verificationChecks.push("newTabOpened");
        criteria.push({
          id: "crit-tab-opened",
          description: "Target link opened in distinct browser tab",
          type: "STATE_OBSERVED",
          expectedKey: "tabCount",
        });
        break;

      case "MEDIA_PLAY":
        requiredOperations.push("media");
        requiredOperations.push("click");
        verificationChecks.push("mediaPlaybackActive");
        criteria.push({
          id: "crit-media-control",
          description: "Media playback actively playing and verified on player",
          type: "STATE_OBSERVED",
          expectedKey: "mediaPlaying",
        });
        break;

      case "MEDIA_PAUSE":
      case "MEDIA_MUTE":
        requiredOperations.push("media");
        requiredOperations.push("click");
        verificationChecks.push("mediaPlaybackUpdated");
        criteria.push({
          id: "crit-media-control",
          description: "Media playback control action executed and verified on player",
          type: "STATE_OBSERVED",
          expectedKey: "mediaState",
        });
        break;

      case "PAGINATE":
        requiredOperations.push("click");
        verificationChecks.push("pageChanged");
        criteria.push({
          id: "crit-pagination",
          description: "Pagination control triggered and new results rendered",
          type: "STATE_OBSERVED",
          expectedKey: "pageIndex",
        });
        break;

      case "WAIT_DYNAMIC":
        requiredOperations.push("wait");
        requiredOperations.push("extract");
        verificationChecks.push("dynamicContentExtracted");
        criteria.push({
          id: "crit-dynamic-loaded",
          description: "Asynchronous content loaded and verified",
          type: "ELEMENT_VISIBLE",
          expectedKey: "dynamicContent",
        });
        break;

      case "INSPECT":
        requiredOperations.push("inspect");
        verificationChecks.push("elementInspected");
        criteria.push({
          id: "crit-inspection",
          description: "Target element presence or policy verified",
          type: "STATE_OBSERVED",
          expectedKey: "inspectedElement",
        });
        break;

      case "AMBIGUOUS":
      case "UNSUPPORTED":
        // No success criteria can be satisfied for ambiguous or unsupported requests
        break;

      default:
        requiredOperations.push("click");
        verificationChecks.push("actionCompleted");
        break;
    }

    const taskSuccessCriteria: TaskSuccessCriteria = {
      requiredOperations,
      requiredOutputs,
      verificationChecks,
      completionConditions: criteria.map((c) => c.description),
    };

    return {
      taskSuccessCriteria,
      verificationCriteria: criteria,
      requiredOperations,
      forbiddenOperations,
    };
  }
}
