import { TaskSpecification } from "./task-specification";
import { PageObservation } from "../types/browser";

export interface ObservationRequirement {
  id: string;
  type: "PAGE_LOADED" | "INPUT_DISCOVERED" | "BUTTON_DISCOVERED" | "CONTAINER_SETTLED" | "DIALOG_CHECK" | "MEDIA_DISCOVERED";
  description: string;
  condition: "urlChange" | "elementAppears" | "domSettled" | "textContains";
  timeoutMs: number;
}

export interface ObservationPlan {
  taskId: string;
  requiresInitialObservation: boolean;
  requiredObservations: ObservationRequirement[];
  targetLocatorsNeeded: Array<{
    role: "search_input" | "submit_button" | "result_card" | "form_field" | "tab_link" | "download_trigger" | "media_element";
    preferredStrategies: string[];
  }>;
}

/**
 * Observation Planner (Phase 2 Component C)
 * Determines which browser observations are required before acting (Section 4C & 7).
 * Avoids assuming fixed selectors, layouts, or button IDs.
 */
export class ObservationPlanner {
  /**
   * Plans the necessary observations given the task specification and optional current observation
   */
  static planObservations(
    spec: TaskSpecification,
    currentObservation?: PageObservation | null
  ): ObservationPlan {
    const requirements: ObservationRequirement[] = [];
    const targetLocatorsNeeded: ObservationPlan["targetLocatorsNeeded"] = [];

    // 1. Initial Page Load Observation
    if (!currentObservation || currentObservation.url === "about:blank") {
      requirements.push({
        id: "obs-nav-load",
        type: "PAGE_LOADED",
        description: "Wait for initial target page to load and reach DOM content loaded state",
        condition: "domSettled",
        timeoutMs: 15000,
      });
    }

    // 2. Dialog / Challenge / Barrier Check
    requirements.push({
      id: "obs-dialog-check",
      type: "DIALOG_CHECK",
      description: "Inspect live page for bot challenges, consent walls, or blocking overlays",
      condition: "domSettled",
      timeoutMs: 3000,
    });

    // 3. Search / Query Operations
    if (spec.operation === "SEARCH" || spec.operation === "COMPARE" || spec.operation === "FILTER" || spec.operation === "COUNT") {
      targetLocatorsNeeded.push({
        role: "search_input",
        preferredStrategies: ["placeholder", "role", "label", "name", "css"],
      });
      targetLocatorsNeeded.push({
        role: "submit_button",
        preferredStrategies: ["role", "text", "css"],
      });
      targetLocatorsNeeded.push({
        role: "result_card",
        preferredStrategies: ["css", "role"],
      });

      requirements.push({
        id: "obs-search-input",
        type: "INPUT_DISCOVERED",
        description: "Discover visible search input box or searchbox role on live page",
        condition: "elementAppears",
        timeoutMs: 5000,
      });
    }

    // 4. Form Operations
    if (spec.operation === "FORM_FILL" || spec.operation === "FORM_SUBMIT" || spec.operation === "FORM_DRAFT") {
      targetLocatorsNeeded.push({
        role: "form_field",
        preferredStrategies: ["label", "placeholder", "name", "role", "css"],
      });
      if (spec.operation === "FORM_SUBMIT") {
        targetLocatorsNeeded.push({
          role: "submit_button",
          preferredStrategies: ["role", "text"],
        });
      }

      requirements.push({
        id: "obs-form-fields",
        type: "INPUT_DISCOVERED",
        description: "Discover all visible interactive form inputs, selects, and textareas on live DOM",
        condition: "domSettled",
        timeoutMs: 5000,
      });
    }

    // 5. Dynamic Content Loading
    if (spec.operation === "WAIT_DYNAMIC") {
      requirements.push({
        id: "obs-dynamic-settled",
        type: "CONTAINER_SETTLED",
        description: "Wait for dynamic content to asynchronously render and settle in DOM",
        condition: "domSettled",
        timeoutMs: 10000,
      });
    }

    // 6. Download Operations
    if (spec.operation === "DOWNLOAD") {
      targetLocatorsNeeded.push({
        role: "download_trigger",
        preferredStrategies: ["role", "text", "label", "css"],
      });
      requirements.push({
        id: "obs-download-trigger",
        type: "BUTTON_DISCOVERED",
        description: "Locate visible download button, link, or export control on live DOM",
        condition: "elementAppears",
        timeoutMs: 5000,
      });
    }

    // 7. Multi-Tab Operations
    if (spec.operation === "OPEN_TAB") {
      targetLocatorsNeeded.push({
        role: "tab_link",
        preferredStrategies: ["role", "text", "css"],
      });
      requirements.push({
        id: "obs-tab-link",
        type: "BUTTON_DISCOVERED",
        description: "Identify link or button configured to open in a new tab (target='_blank')",
        condition: "elementAppears",
        timeoutMs: 5000,
      });
    }

    // 8. Media Operations
    if (spec.operation === "MEDIA_PLAY" || spec.operation === "MEDIA_PAUSE" || spec.operation === "MEDIA_MUTE") {
      targetLocatorsNeeded.push({
        role: "media_element",
        preferredStrategies: ["role", "css", "text"],
      });
      requirements.push({
        id: "obs-media-element",
        type: "MEDIA_DISCOVERED",
        description: "Locate video or audio playback element or media controls on live DOM",
        condition: "elementAppears",
        timeoutMs: 5000,
      });
    }

    return {
      taskId: spec.id,
      requiresInitialObservation: !currentObservation,
      requiredObservations: requirements,
      targetLocatorsNeeded,
    };
  }
}
