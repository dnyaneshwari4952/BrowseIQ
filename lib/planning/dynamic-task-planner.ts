import { Action, ActionType, RiskLevel } from "../types/actions";
import { Plan } from "../types/plans";
import { TaskSpecification } from "./task-specification";
import { PageObservation } from "../types/browser";
import { ObservationPlanner } from "./observation-planner";
import { VerificationSpecBuilder } from "./verification-spec";
import { EntityConstraintResolver } from "./entity-constraint-resolver";
import { LocalFileSecurityManager } from "../local/local-file-security-manager";

export interface PlannerInput {
  spec: TaskSpecification;
  observation?: PageObservation | null;
  targetUrl?: string;
}

/**
 * Dynamic Task Planner (Phase 2 Component D)
 * Generates browser action sequences grounded in natural-language specifications
 * and actual live page observations without external hosted LLMs or hardcoded site templates.
 */
export class DynamicTaskPlanner {
  /**
   * Generates a grounded Plan from task specification and live page observation
   */
  static plan(input: PlannerInput): Plan {
    const { spec, observation, targetUrl: explicitUrl } = input;
    const actions: Action[] = [];
    const targetUrl = explicitUrl || spec.targetUrl;

    const obsPlan = ObservationPlanner.planObservations(spec, observation);
    const verificationSpec = VerificationSpecBuilder.build(spec);

    // Case 1: Unsupported Task
    if (spec.isUnsupported || spec.operation === "UNSUPPORTED") {
      actions.push({
        id: "step-unsupported",
        type: ActionType.FINISH,
        risk: RiskLevel.LOW,
        reason: spec.unsupportedReason || "Task requested an unsupported or restricted operation.",
      });

      return {
        id: `plan-${Date.now()}`,
        taskInterpretation: spec.inferredGoal,
        actions: this.enrichActions(actions, spec),
        successCriteria: [spec.unsupportedReason || "Refused unsupported operation"],
        taskSuccessCriteria: verificationSpec.taskSuccessCriteria,
        taskSpec: spec,
        revision: 0,
      };
    }

    // Case 2: Ambiguous Task requiring clarification
    if (spec.isAmbiguous || spec.operation === "AMBIGUOUS") {
      actions.push({
        id: "step-clarification",
        type: ActionType.REQUEST_CLARIFICATION,
        risk: RiskLevel.LOW,
        reason: spec.clarificationQuestion || spec.ambiguityReason || "Clarification required.",
      });
      actions.push({
        id: "step-finish-clarify",
        type: ActionType.FINISH,
        risk: RiskLevel.LOW,
        reason: "Halt execution pending user clarification",
      });

      return {
        id: `plan-${Date.now()}`,
        taskInterpretation: spec.inferredGoal,
        actions: this.enrichActions(actions, spec),
        successCriteria: ["Clarification requested from user"],
        taskSuccessCriteria: verificationSpec.taskSuccessCriteria,
        taskSpec: spec,
        revision: 0,
      };
    }

    // Step 1: Initial Navigation (if targetUrl is provided and not already on target page)
    const currentUrl = observation?.url;
    const isAlreadyOnMediaPage = Boolean(
      spec.operation === "MEDIA_PLAY" &&
      (
        (observation?.mediaElements && observation.mediaElements.length > 0) ||
        (currentUrl && (currentUrl.includes("/watch") || currentUrl.includes("/track") || currentUrl.includes("/test-fixtures/media")))
      )
    );

    let navUrl = targetUrl || spec.targetUrl;
    if (!isAlreadyOnMediaPage && navUrl && (spec.operation === "SEARCH" || spec.operation === "MEDIA_PLAY") && (spec.searchQuery || spec.targetEntity)) {
      if (/^https?:\/\/open\.spotify\.com\/?$/i.test(navUrl)) {
        navUrl = "https://open.spotify.com/search";
      }
    }

    const isAlreadyAtTarget = isAlreadyOnMediaPage || Boolean(
      currentUrl &&
      navUrl &&
      currentUrl !== "about:blank" &&
      (currentUrl === navUrl ||
       currentUrl.replace(/\/$/, "") === navUrl.replace(/\/$/, "") ||
       (currentUrl.startsWith("http") && navUrl.startsWith("http") && new URL(currentUrl).origin === new URL(navUrl).origin && (navUrl.includes("/search") ? currentUrl.includes("/search") : true)))
    );

    if (navUrl && !isAlreadyAtTarget) {
      actions.push({
        id: "step-1-nav",
        type: ActionType.NAVIGATE,
        value: navUrl,
        risk: RiskLevel.LOW,
        reason: `Navigate to target: ${navUrl}`,
        retries: { maxRetries: 3, backoffMs: 500 },
      });
      actions.push({
        id: "step-2-wait-page-load",
        type: ActionType.WAIT,
        value: 1000,
        risk: RiskLevel.LOW,
        reason: "Wait for destination page to load and interface to settle",
      });
    }

    // Step 2: Synthesis based on operation type and live observations
    switch (spec.operation) {
      case "SEARCH":
      case "COMPARE":
      case "FILTER":
      case "COUNT": {
        const query = spec.searchQuery || spec.targetEntity || "";

        // Find best search input locator from observation if available
        const searchInputTarget = this.resolveSearchInputLocator(observation);
        const searchBtnTarget = this.resolveSearchButtonLocator(observation);

        actions.push({
          id: `step-${actions.length + 1}-wait-input`,
          type: ActionType.WAIT,
          value: 400,
          risk: RiskLevel.LOW,
          reason: "Wait for search interface to settle",
        });

        actions.push({
          id: `step-${actions.length + 1}-fill-search`,
          type: ActionType.FILL,
          target: searchInputTarget,
          value: query,
          risk: RiskLevel.LOW,
          reason: `Enter search query '${query}' into search field`,
          retries: { maxRetries: 2, backoffMs: 400 },
        });

        // Submit search either by clicking search button (default) or pressing Enter
        actions.push({
          id: `step-${actions.length + 1}-click-search`,
          type: ActionType.CLICK,
          target: searchBtnTarget || {
            strategy: "css",
            value: "button[type='submit'], input[type='submit'], button:has-text('Search'), button:has-text('Find')",
          },
          risk: RiskLevel.LOW,
          reason: "Click search button to submit search",
          retries: { maxRetries: 2, backoffMs: 400 },
        });

        // Wait for results
        actions.push({
          id: `step-${actions.length + 1}-wait-results`,
          type: ActionType.WAIT,
          value: 2000,
          risk: RiskLevel.LOW,
          reason: "Wait for search results to load",
        });

        // Check if an explicit open action was requested (e.g. "Open the second matching result and extract its title" or "open the article result")
        const shouldOpenResult =
          /\bopen\b/i.test(spec.originalInstruction) &&
          !spec.negations.some((n) => n.operation === "open" && n.forbidden);

        if (shouldOpenResult) {
          const nth = spec.ordinal ? spec.ordinal.index + 1 : 1;
          actions.push({
            id: `step-${actions.length + 1}-click-open-result`,
            type: ActionType.CLICK,
            target: {
              strategy: "css",
              value: "a",
              isSearchResult: true,
              description: `Open ${spec.ordinal ? spec.ordinal.target : "first"} matching result`,
            } as any,
            value: spec.targetEntity || query,
            risk: RiskLevel.LOW,
            reason: `Open ${spec.ordinal ? spec.ordinal.target : "first"} matching result`,
          });

          actions.push({
            id: `step-${actions.length + 1}-wait-navigation`,
            type: ActionType.WAIT,
            value: 600,
            risk: RiskLevel.LOW,
            reason: "Wait for destination page to load and settle",
          });
        } else if (spec.ordinal && /\b(?:extract|price|title)\b/i.test(spec.originalInstruction)) {
          const nth = spec.ordinal.index + 1;
          const ordinalTitleTarget = spec.resultType === "product"
            ? `.product-card:nth-of-type(${nth}) .product-title, .result-card:nth-of-type(${nth}) h3, .product-card:nth-of-type(${nth}) h3`
            : spec.resultType === "article"
            ? `article:nth-of-type(${nth}) h2, article:nth-of-type(${nth}) h3, .mw-parser-output h2, h2, h3`
            : `.result-item:nth-of-type(${nth}) h3, .result-card:nth-of-type(${nth}) h3, h3, h2`;
          actions.push({
            id: "extract-title-ordinal",
            type: ActionType.EXTRACT_TEXT,
            target: {
              strategy: "css",
              value: ordinalTitleTarget,
              index: spec.ordinal.index,
            },
            risk: RiskLevel.LOW,
            reason: `Extract title from ${spec.ordinal.target} search result`,
          });

          if (spec.resultType === "product" || spec.originalInstruction.toLowerCase().includes("price")) {
            actions.push({
              id: "extract-price-ordinal",
              type: ActionType.EXTRACT_TEXT,
              target: {
                strategy: "css",
                value: `.product-card:nth-of-type(${nth}) .product-price, .result-card:nth-of-type(${nth}) [class*='price'], .product-card:nth-of-type(${nth}) [class*='price']`,
                index: spec.ordinal.index,
              },
              risk: RiskLevel.LOW,
              reason: `Extract price from ${spec.ordinal.target} search result`,
            });
          }
        } else if (spec.resultType === "product" && (spec.ordering || spec.filters.length > 0 || /\b(?:price|cost|cheapest|expensive)\b/i.test(spec.originalInstruction))) {
          // Extract and compare/filter results if product price comparison/filtering is requested
          actions.push({
            id: `step-${actions.length + 1}-extract`,
            type: ActionType.EVALUATE_SAFE,
            risk: RiskLevel.LOW,
            reason: "Extract product cards from page for semantic evaluation and price comparison",
          });
        }
        // General search concludes here without forcing artificial product extraction
        break;
      }

      case "FORM_FILL":
      case "FORM_SUBMIT": {
        actions.push({
          id: `step-${actions.length + 1}-wait-form`,
          type: ActionType.WAIT,
          value: 400,
          risk: RiskLevel.LOW,
          reason: "Wait for form controls to be interactive",
        });

        // Extract user-specified form values from instruction
        const nameMatch =
          spec.originalInstruction.match(/(?:with\s+name|name\s+is|name[:=])\s+["']?([A-Za-z\s]+?)["']?(?:\s+and|\s+with|\s+email|$)/i) ||
          spec.originalInstruction.match(/name\s+["']([^"']+)["']/i);
        const emailMatch =
          spec.originalInstruction.match(/(?:and\s+email|email\s+is|email[:=])\s+["']?([^\s"']+)["']?/i) ||
          spec.originalInstruction.match(/email\s+["']([^"']+)["']/i) ||
          spec.originalInstruction.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);

        const customName = nameMatch ? (nameMatch[1] || nameMatch[0]).trim() : "Test User";
        const customEmail = emailMatch ? (emailMatch[1] || emailMatch[0]).trim() : "user@example.com";

        // If observation has specific form fields, fill them
        const formInputs = this.extractFormInputs(observation);
        if (formInputs.length > 0) {
          for (const inputEl of formInputs) {
            const fieldKey = (inputEl.name || inputEl.placeholder || inputEl.id || "").toLowerCase();
            const val = fieldKey.includes("email")
              ? customEmail
              : fieldKey.includes("name")
              ? customName
              : this.getDefaultValueForField(fieldKey);

            actions.push({
              id: `step-${actions.length + 1}-fill-${inputEl.id || inputEl.name || "field"}`,
              type: ActionType.FILL,
              target: {
                strategy: inputEl.id ? "id" : inputEl.name ? "name" : "placeholder",
                value: inputEl.id || inputEl.name || inputEl.placeholder || "",
              },
              value: val,
              risk: RiskLevel.LOW,
              reason: `Fill form field: ${inputEl.name || inputEl.placeholder || inputEl.id}`,
            });
          }
        } else {
          // General fallback form fill with extracted values
          actions.push({
            id: `step-${actions.length + 1}-fill-name`,
            type: ActionType.FILL,
            target: { strategy: "name", value: "fullName" },
            value: customName,
            risk: RiskLevel.LOW,
            reason: `Fill name field with '${customName}'`,
          });
          actions.push({
            id: `step-${actions.length + 1}-fill-email`,
            type: ActionType.FILL,
            target: { strategy: "name", value: "email" },
            value: customEmail,
            risk: RiskLevel.LOW,
            reason: `Fill email field with '${customEmail}'`,
          });
        }

        // Check if submission is forbidden by negative constraint
        const isForbiddenSubmit = spec.negations.some((n) => n.operation === "submit" && n.forbidden);
        if (!isForbiddenSubmit && spec.operation === "FORM_SUBMIT") {
          const submitBtnTarget = this.resolveSubmitButtonLocator(observation);
          actions.push({
            id: `step-${actions.length + 1}-click-submit`,
            type: ActionType.CLICK,
            target: submitBtnTarget,
            risk: RiskLevel.LOW,
            reason: "Submit form by clicking submit button",
            retries: { maxRetries: 2, backoffMs: 500 },
          });
        }
        break;
      }

      case "WAIT_DYNAMIC": {
        const dynTarget = this.resolveDynamicContainerLocator(observation);
        actions.push({
          id: `step-${actions.length + 1}-wait-dyn`,
          type: ActionType.WAIT,
          value: 1800,
          risk: RiskLevel.LOW,
          reason: "Wait for dynamic content to asynchronously render and settle in DOM",
          expectedState: { elementAppears: dynTarget.value },
        });

        actions.push({
          id: `step-${actions.length + 1}-extract-dyn`,
          type: ActionType.EXTRACT_TEXT,
          target: dynTarget,
          risk: RiskLevel.LOW,
          reason: "Extract loaded dynamic content and verification status",
        });
        break;
      }

      case "DOWNLOAD": {
        const downloadTarget = this.resolveDownloadLocator(observation);
        actions.push({
          id: `step-${actions.length + 1}-wait-dl`,
          type: ActionType.WAIT,
          value: 400,
          risk: RiskLevel.LOW,
          reason: "Wait for download link to be interactive",
        });

        actions.push({
          id: `step-${actions.length + 1}-click-dl`,
          type: ActionType.DOWNLOAD,
          target: downloadTarget,
          risk: RiskLevel.LOW,
          reason: "Trigger file download and verify file reception",
        });
        break;
      }

      case "OPEN_TAB": {
        const tabTarget = this.resolveTabLinkLocator(observation);
        actions.push({
          id: `step-${actions.length + 1}-wait-tab`,
          type: ActionType.WAIT,
          value: 400,
          risk: RiskLevel.LOW,
          reason: "Wait for link elements to be interactive",
        });

        actions.push({
          id: `step-${actions.length + 1}-open-tab`,
          type: ActionType.OPEN_NEW_TAB,
          target: tabTarget,
          value: targetUrl ? `${targetUrl}/target` : "about:blank",
          risk: RiskLevel.LOW,
          reason: "Open target link in new browser tab",
        });

        actions.push({
          id: `step-${actions.length + 1}-switch-tab`,
          type: ActionType.SWITCH_TAB,
          value: "tab-1",
          risk: RiskLevel.LOW,
          reason: "Switch focus context to newly opened tab",
        });
        break;
      }

      case "MEDIA_PLAY": {
        const query = spec.searchQuery || spec.targetEntity;
        const isAlreadyOnMediaPage = Boolean(
          observation?.mediaElements && observation.mediaElements.length > 0
        ) || Boolean(
          observation?.url && (observation.url.includes("/watch") || observation.url.includes("/test-fixtures/media"))
        );

        // If user requested a specific song/video/item and browser is navigating to the platform
        if (query && targetUrl && !isAlreadyOnMediaPage) {
          const searchInputTarget = this.resolveSearchInputLocator(observation);

          actions.push({
            id: `step-${actions.length + 1}-wait-input`,
            type: ActionType.WAIT,
            value: 600,
            risk: RiskLevel.LOW,
            reason: "Wait for search input to be interactive",
          });

          actions.push({
            id: `step-${actions.length + 1}-fill-search`,
            type: ActionType.FILL,
            target: searchInputTarget,
            value: query,
            risk: RiskLevel.LOW,
            reason: `Enter media title '${query}' into search field`,
            retries: { maxRetries: 2, backoffMs: 400 },
          });

          actions.push({
            id: `step-${actions.length + 1}-press-enter`,
            type: ActionType.PRESS,
            target: searchInputTarget,
            value: "Enter",
            risk: RiskLevel.LOW,
            reason: "Press Enter to submit search query",
          });

          actions.push({
            id: `step-${actions.length + 1}-wait-results`,
            type: ActionType.WAIT,
            value: 2000,
            expectedState: {
              elementAppears: "ytd-video-renderer, [role='article'], .result-card, [data-testid*='result'], [data-testid*='track'], [data-testid*='video'], h3 a, a[href*='watch'], a[href*='track'], a[href*='video']",
            },
            risk: RiskLevel.LOW,
            reason: "Wait for search results to appear",
          });

          const cleanTitle = (spec.targetEntity || query || "")
            .replace(/\s+(?:song|track|video|music|audio)$/i, "")
            .trim();

          // Open matching media result
          actions.push({
            id: `step-${actions.length + 1}-click-result`,
            type: ActionType.CLICK,
            target: {
              strategy: "css",
              value: "a",
              isSearchResult: true,
              description: `Select and open matching media result for '${cleanTitle}'`,
            } as any,
            value: cleanTitle,
            risk: RiskLevel.LOW,
            reason: `Select and open matching media result for '${cleanTitle}'`,
            retries: { maxRetries: 2, backoffMs: 500 },
          });

          actions.push({
            id: `step-${actions.length + 1}-wait-player`,
            type: ActionType.WAIT,
            value: 1500,
            expectedState: {
              elementAppears: "video, audio, [data-testid*='player'], .html5-video-player, button.ytp-play-button, button[aria-label*='Play' i]",
            },
            risk: RiskLevel.LOW,
            reason: "Wait for media player to initialize",
          });
        }

        // Media playback execution
        actions.push({
          id: `step-${actions.length + 1}-media-play`,
          type: ActionType.MEDIA_PLAY,
          target: {
            strategy: "css",
            value: "video, audio, button.ytp-play-button, .ytp-large-play-button, button[aria-label*='Play' i], button[title*='Play' i], .play-button, button:has-text('Play')",
          },
          risk: RiskLevel.LOW,
          reason: "Start media playback and verify playing state",
          retries: { maxRetries: 2, backoffMs: 500 },
        });
        break;
      }

      case "LOCAL_MEDIA_PLAY": {
        // 1. Enforce local-file permission check (Requirement 1 & 6)
        if (!LocalFileSecurityManager.isEnabled()) {
          actions.push({
            id: `step-${actions.length + 1}-local-perm-req`,
            type: ActionType.REQUEST_CLARIFICATION,
            risk: RiskLevel.LOW,
            reason: "LOCAL_PERMISSION_REQUIRED: Local file access is currently disabled. Please enable Local Storage Access permission in Settings to allow access to local files.",
          });
          actions.push({
            id: `step-${actions.length + 1}-finish-perm`,
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Halt: Local Files permission required",
          });
          break;
        }

        if (LocalFileSecurityManager.getAccessMode() === "whole_computer" && !LocalFileSecurityManager.wholeComputerConfirmed) {
          actions.push({
            id: `step-${actions.length + 1}-whole-computer-confirm-req`,
            type: ActionType.REQUEST_CLARIFICATION,
            risk: RiskLevel.LOW,
            reason: "WHOLE_COMPUTER_CONFIRMATION_REQUIRED: Whole-computer access mode requires explicit user confirmation in Settings before access is granted.",
          });
          actions.push({
            id: `step-${actions.length + 1}-finish-confirm`,
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Halt: Whole-computer confirmation required",
          });
          break;
        }

        // 2. Audio search strictly within approved directory (Requirement 3 & 5)
        const query = spec.searchQuery || spec.targetEntity || "";
        const searchResult = LocalFileSecurityManager.searchAudioFiles(query);

        if (!searchResult.found || searchResult.candidates.length === 0) {
          actions.push({
            id: `step-${actions.length + 1}-not-found`,
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: `No audio files matching '${query}' found in approved directory '${searchResult.searchedDirectory}'. Supported extensions: .mp3, .wav, .m4a, .aac, .ogg, .flac.`,
          });
          break;
        }

        if (searchResult.isAmbiguous) {
          const fileList = searchResult.candidates.slice(0, 5).map((c) => `"${c.filename}"`).join(", ");
          actions.push({
            id: `step-${actions.length + 1}-file-selection`,
            type: ActionType.REQUEST_CLARIFICATION,
            risk: RiskLevel.LOW,
            reason: `FILE_SELECTION_REQUIRED: Multiple matching audio files found in approved directory: ${fileList}. Please clarify which file to play.`,
          });
          actions.push({
            id: `step-${actions.length + 1}-finish-clarify`,
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Halt: File selection clarification required",
          });
          break;
        }

        // 3. Playback via dedicated secure audio player endpoint (Requirement 4)
        const matched = searchResult.bestMatch!;
        const playerUrl = `http://localhost:3000/player/audio?path=${encodeURIComponent(matched.canonicalPath)}&title=${encodeURIComponent(matched.filename)}`;

        actions.push({
          id: `step-${actions.length + 1}-nav-player`,
          type: ActionType.NAVIGATE,
          value: playerUrl,
          risk: RiskLevel.LOW,
          reason: `Open local audio player for verified file: ${matched.filename}`,
          retries: { maxRetries: 3, backoffMs: 500 },
        });

        actions.push({
          id: `step-${actions.length + 1}-wait-player`,
          type: ActionType.WAIT,
          value: 1200,
          risk: RiskLevel.LOW,
          reason: "Wait for audio stream to initialize and player interface to render",
        });

        actions.push({
          id: `step-${actions.length + 1}-click-play`,
          type: ActionType.CLICK,
          target: { strategy: "id", value: "audio-play-button" },
          risk: RiskLevel.LOW,
          reason: "Click play button to ensure audio playback is started",
          retries: { maxRetries: 2, backoffMs: 400 },
        });

        actions.push({
          id: `step-${actions.length + 1}-wait-progress`,
          type: ActionType.WAIT,
          value: 1500,
          risk: RiskLevel.LOW,
          reason: "Allow playback to progress and verify audio time advance",
        });

        // Verify active playback progression (Requirement 4 & 6)
        actions.push({
          id: `step-${actions.length + 1}-verify-progress`,
          type: ActionType.EXTRACT_TEXT,
          target: { strategy: "id", value: "playback-progressing" },
          risk: RiskLevel.LOW,
          reason: "Verify credible evidence that playback is actively progressing (currentTime > 0)",
        });

        break;
      }

      case "MEDIA_PAUSE": {
        actions.push({
          id: `step-${actions.length + 1}-media-pause`,
          type: ActionType.MEDIA_PAUSE,
          target: { strategy: "role", value: "Pause", role: "button" },
          risk: RiskLevel.LOW,
          reason: "Pause media playback",
        });
        break;
      }

      case "MEDIA_MUTE": {
        actions.push({
          id: `step-${actions.length + 1}-media-mute`,
          type: ActionType.MEDIA_MUTE,
          target: { strategy: "role", value: "Mute", role: "button" },
          risk: RiskLevel.LOW,
          reason: "Mute media audio",
        });
        break;
      }

      case "PAGINATE": {
        actions.push({
          id: `step-${actions.length + 1}-paginate-next`,
          type: ActionType.CLICK,
          target: { strategy: "role", value: "Next", role: "button" },
          risk: RiskLevel.LOW,
          reason: "Navigate to next page of results",
        });
        break;
      }

      case "INSPECT": {
        actions.push({
          id: `step-${actions.length + 1}-inspect-dom`,
          type: ActionType.EXTRACT_TEXT,
          target: { strategy: "css", value: "form, body" },
          risk: RiskLevel.LOW,
          reason: `Inspect page content for ${spec.targetEntity || "requested element"}`,
        });
        break;
      }

      case "EXTRACT": {
        const shouldOpenResult =
          /\bopen\b/i.test(spec.originalInstruction) &&
          !spec.negations.some((n) => n.operation === "open" && n.forbidden);

        if (shouldOpenResult) {
          const nth = spec.ordinal ? spec.ordinal.index + 1 : 1;
          const openTargetValue = spec.resultType === "product"
            ? `.product-card:nth-of-type(${nth}), [data-action='open-product'], .result-card:nth-of-type(${nth})`
            : spec.resultType === "article"
            ? `article a, .mw-parser-output a, main a, h2 a, h3 a`
            : `[data-action='open-result'], [data-action='open-product'], h3 a, .result a, article a, [role='link']`;
          actions.push({
            id: `step-${actions.length + 1}-click-open-result`,
            type: ActionType.CLICK,
            target: {
              strategy: "css",
              value: openTargetValue,
              index: spec.ordinal ? spec.ordinal.index : 0,
            },
            risk: RiskLevel.LOW,
            reason: `Open ${spec.ordinal ? spec.ordinal.target : "first"} matching ${spec.resultType || "search"} result`,
          });
        }

        if (spec.ordinal) {
          const nth = spec.ordinal.index + 1;
          const titleTargetValue = spec.resultType === "product"
            ? `.product-card:nth-of-type(${nth}) .product-title, .result-card:nth-of-type(${nth}) h3, .product-card:nth-of-type(${nth}) h3`
            : spec.resultType === "article"
            ? `h1, h2, article h1, article h2, .mw-parser-output h1`
            : `h1, h2, h3, .result-title, .title`;
          actions.push({
            id: "extract-title-ordinal",
            type: ActionType.EXTRACT_TEXT,
            target: {
              strategy: "css",
              value: titleTargetValue,
              index: spec.ordinal.index,
            },
            risk: RiskLevel.LOW,
            reason: `Extract title from ${spec.ordinal.target} ${spec.resultType || "search"} result`,
          });

          if (spec.resultType === "product" || spec.originalInstruction.toLowerCase().includes("price")) {
            actions.push({
              id: "extract-price-ordinal",
              type: ActionType.EXTRACT_TEXT,
              target: {
                strategy: "css",
                value: `.product-card:nth-of-type(${nth}) .product-price, .result-card:nth-of-type(${nth}) [class*='price'], .product-card:nth-of-type(${nth}) [class*='price']`,
                index: spec.ordinal.index,
              },
              risk: RiskLevel.LOW,
              reason: `Extract price from ${spec.ordinal.target} search result`,
            });
          }
        } else {
          const titleTargetValue = spec.resultType === "product"
            ? ".product-card:first-of-type .product-title, .result-card:first-of-type h3, .product-card:first-of-type h3"
            : spec.resultType === "article"
            ? "h1, #firstHeading, article h1, main h1"
            : "h1, h2, h3, .title, main";
          actions.push({
            id: `step-${actions.length + 1}-extract-title`,
            type: ActionType.EXTRACT_TEXT,
            target: {
              strategy: "css",
              value: titleTargetValue,
              index: 0,
            },
            risk: RiskLevel.LOW,
            reason: `Extract title from first ${spec.resultType || "search"} result`,
          });
        }
        break;
      }

      case "HISTORY_BACK": {
        actions.push({
          id: `step-${actions.length + 1}-back`,
          type: ActionType.BACK,
          risk: RiskLevel.LOW,
          reason: "Navigate back in browser history",
        });
        break;
      }

      case "HISTORY_FORWARD": {
        actions.push({
          id: `step-${actions.length + 1}-forward`,
          type: ActionType.FORWARD,
          risk: RiskLevel.LOW,
          reason: "Navigate forward in browser history",
        });
        break;
      }

      case "RELOAD": {
        actions.push({
          id: `step-${actions.length + 1}-reload`,
          type: ActionType.RELOAD,
          risk: RiskLevel.LOW,
          reason: "Reload current browser page",
        });
        break;
      }

      default: {
        actions.push({
          id: `step-${actions.length + 1}-inspect`,
          type: ActionType.INSPECT,
          risk: RiskLevel.LOW,
          reason: "Inspect page state",
        });
        break;
      }
    }

    // Conclude with FINISH action if not already terminated
    const lastAction = actions[actions.length - 1];
    if (!lastAction || lastAction.type !== ActionType.FINISH) {
      actions.push({
        id: `step-${actions.length + 1}-finish`,
        type: ActionType.FINISH,
        risk: RiskLevel.LOW,
        reason: "Verify task-level completion criteria and conclude plan execution",
      });
    }

    const enrichedActions = this.enrichActions(actions, spec);

    return {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskInterpretation: spec.inferredGoal,
      assumptions: [
        "Plan synthesized from generalized semantic interpretation",
        "Deterministic pre-execution validation before each action",
        "Grounded in observable Playwright browser state",
      ],
      actions: enrichedActions,
      successCriteria: [
        "All required actions executed successfully",
        "Task-level success criteria verified against live page state",
      ],
      taskSuccessCriteria: verificationSpec.taskSuccessCriteria,
      taskSpec: spec,
      revision: 0,
    };
  }

  // Locator resolution helpers grounded in observation
  private static resolveSearchInputLocator(obs?: PageObservation | null) {
    if (obs?.interactiveElements) {
      // 1. Look specifically for an INPUT or TEXTAREA element representing search
      const inputMatch = obs.interactiveElements.find(
        (el) =>
          (el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
          (el.name?.toLowerCase() === "q" ||
            el.name?.toLowerCase() === "search_query" ||
            el.name?.toLowerCase().includes("search") ||
            el.type === "search" ||
            el.role === "searchbox" ||
            el.placeholder?.toLowerCase().includes("search") ||
            el.placeholder?.toLowerCase().includes("play") ||
            el.ariaLabel?.toLowerCase().includes("search") ||
            el.ariaLabel?.toLowerCase().includes("play") ||
            (el as any).title?.toLowerCase().includes("search") ||
            (el as any).titleAttr?.toLowerCase().includes("search") ||
            (el.id && !el.id.startsWith("elem-") && el.id.toLowerCase().includes("search")))
      );

      const match = inputMatch || obs.interactiveElements.find(
        (el) =>
          el.type === "search" ||
          el.role === "searchbox" ||
          el.name?.toLowerCase() === "q" ||
          el.name?.toLowerCase() === "search_query" ||
          el.placeholder?.toLowerCase().includes("search") ||
          el.placeholder?.toLowerCase().includes("play") ||
          el.ariaLabel?.toLowerCase().includes("search") ||
          (el.id && !el.id.startsWith("elem-") && el.id.toLowerCase().includes("search"))
      );

      if (match) {
        if (match.name) return { strategy: "name" as const, value: match.name };
        if (match.placeholder) return { strategy: "placeholder" as const, value: match.placeholder };
        if (match.ariaLabel) return { strategy: "label" as const, value: match.ariaLabel };
        if (match.testId) return { strategy: "testId" as const, value: match.testId };
        if (match.id && !match.id.startsWith("elem-")) return { strategy: "id" as const, value: match.id };
      }
    }
    return {
      strategy: "css" as const,
      value: "input[name='q'], input[title*='search' i], input[placeholder*='search' i], input[type='search'], input[data-testid*='search' i], input[role='searchbox'], input[name='search_query'], input[aria-label*='search' i], textarea[aria-label*='search' i], input[id*='search' i]",
    };
  }

  private static resolveSearchButtonLocator(obs?: PageObservation | null) {
    if (obs?.interactiveElements) {
      const match = obs.interactiveElements.find(
        (el) =>
          (el.tagName === "BUTTON" || el.type === "submit" || el.role === "button") &&
          (el.text?.toLowerCase().includes("search") ||
            el.ariaLabel?.toLowerCase().includes("search") ||
            el.testId?.toLowerCase().includes("search") ||
            el.name?.toLowerCase().includes("search"))
      );
      if (match && match.text && match.text.trim()) {
        return { strategy: "role" as const, value: match.text.trim(), role: "button" };
      }
      if (match && match.ariaLabel) {
        return { strategy: "role" as const, value: match.ariaLabel, role: "button" };
      }
      if (match && match.testId) {
        return { strategy: "testId" as const, value: match.testId };
      }
    }
    return undefined;
  }

  private static resolveSubmitButtonLocator(obs?: PageObservation | null) {
    if (obs?.interactiveElements) {
      const match = obs.interactiveElements.find(
        (el) =>
          (el.tagName === "BUTTON" || el.type === "submit" || el.role === "button") &&
          (el.text?.toLowerCase().includes("submit") || el.text?.toLowerCase().includes("send"))
      );
      if (match && match.text) {
        return { strategy: "role" as const, value: match.text, role: "button" };
      }
    }
    return { strategy: "role" as const, value: "Submit", role: "button" };
  }

  private static resolveDownloadLocator(obs?: PageObservation | null) {
    if (obs?.interactiveElements) {
      const match = obs.interactiveElements.find(
        (el) =>
          el.text?.toLowerCase().includes("download") ||
          el.text?.toLowerCase().includes("export") ||
          (el.id && !el.id.startsWith("elem-") && el.id.toLowerCase().includes("download"))
      );
      if (match?.id && !match.id.startsWith("elem-")) {
        return { strategy: "id" as const, value: match.id };
      }
      if (match?.text) {
        return { strategy: "text" as const, value: match.text, role: "button" };
      }
    }
    return { strategy: "css" as const, value: "button:has-text('Download'), a[download], [id*='download']" };
  }

  private static resolveTabLinkLocator(obs?: PageObservation | null) {
    if (obs?.interactiveElements) {
      const match = obs.interactiveElements.find(
        (el) =>
          el.text?.toLowerCase().includes("new tab") ||
          (el.id && !el.id.startsWith("elem-") && el.id.toLowerCase().includes("tab"))
      );
      if (match?.id && !match.id.startsWith("elem-")) {
        return { strategy: "css" as const, value: `#${match.id}` };
      }
      if (match?.text) {
        return { strategy: "text" as const, value: match.text };
      }
    }
    return { strategy: "css" as const, value: "a[target='_blank'], [id*='open-tab'], button:has-text('New Tab')" };
  }

  private static resolveDynamicContainerLocator(obs?: PageObservation | null) {
    if (obs?.interactiveElements) {
      const match = obs.interactiveElements.find(
        (el) =>
          (el.id && !el.id.startsWith("elem-") && el.id.toLowerCase().includes("delayed")) ||
          (el.id && !el.id.startsWith("elem-") && el.id.toLowerCase().includes("dynamic"))
      );
      if (match?.id && !match.id.startsWith("elem-")) {
        return { strategy: "css" as const, value: `#${match.id}` };
      }
    }
    return { strategy: "css" as const, value: "[id*='delayed'], [class*='dynamic'], #delayed-card" };
  }

  private static extractFormInputs(obs?: PageObservation | null) {
    if (!obs?.interactiveElements) return [];
    return obs.interactiveElements.filter(
      (el) =>
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") &&
        el.type !== "submit" &&
        el.type !== "hidden"
    );
  }

  private static getDefaultValueForField(fieldName: string): string {
    const lower = fieldName.toLowerCase();
    if (lower.includes("name")) return "Test User";
    if (lower.includes("email")) return "user@example.com";
    if (lower.includes("phone")) return "555-0199";
    if (lower.includes("subject")) return "General Inquiry";
    if (lower.includes("message")) return "Automated inquiry message.";
    return "Test Value";
  }

  /**
   * Adapts the plan grounded in live observation when an action fails
   * Strictly preserves original user goal and constraints (Section 8)
   */
  static replan(options: {
    currentPlan: Plan;
    failedStepIndex: number;
    observation: PageObservation;
    failureReason: string;
    failedTargets?: Set<string>;
  }): Plan {
    const { currentPlan, failedStepIndex, observation, failureReason, failedTargets } = options;
    const completedActions = currentPlan.actions.slice(0, failedStepIndex);

    // Check for ambiguous controls on live page
    const lowerObs = (observation.summary || "").toLowerCase();
    const submitCount = (observation.interactiveElements || []).filter(
      (e) => e.text?.toLowerCase() === "submit" || e.name?.toLowerCase() === "submit"
    ).length;

    if (submitCount > 1 || lowerObs.includes("ambiguous")) {
      return {
        ...currentPlan,
        revision: (currentPlan.revision || 0) + 1,
        actions: [
          ...completedActions,
          {
            id: `step-clarify-${Date.now()}`,
            type: ActionType.REQUEST_CLARIFICATION,
            risk: RiskLevel.LOW,
            reason: "Multiple competing identical controls found on page. Please clarify target.",
          },
          {
            id: `finish-clarify-${Date.now()}`,
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Halt for clarification",
          },
        ],
      };
    }

    // Determine page state and failure mode
    const currentUrl = observation?.url || (observation as any)?.currentUrl || "";
    const isBlank = currentUrl === "about:blank" || currentUrl === "" || (failureReason || "").includes("about:blank");
    const isPreconditionFailure =
      (failureReason || "").toLowerCase().includes("precondition") ||
      (failureReason || "").toLowerCase().includes("about:blank") ||
      (failureReason || "").toLowerCase().includes("target") ||
      isBlank;

    // Check if task is a local-file task (Requirement 2 & 6)
    const isLocalFileTask =
      Boolean(currentPlan.taskSpec?.isLocalFile) ||
      currentPlan.taskSpec?.operation === "LOCAL_MEDIA_PLAY";

    if (isPreconditionFailure && isBlank) {
      if (isLocalFileTask) {
        if (!LocalFileSecurityManager.isEnabled()) {
          return {
            ...currentPlan,
            revision: (currentPlan.revision || 0) + 1,
            actions: [
              ...completedActions,
              {
                id: `step-clarify-perm-${Date.now()}`,
                type: ActionType.REQUEST_CLARIFICATION,
                risk: RiskLevel.LOW,
                reason: "LOCAL_PERMISSION_REQUIRED: Local file access is currently disabled. Please enable Local Files permission in Settings to allow access to your Downloads folder.",
              },
              {
                id: `finish-clarify-perm-${Date.now()}`,
                type: ActionType.FINISH,
                risk: RiskLevel.LOW,
                reason: "Halt: Local Files permission required",
              },
            ],
          };
        }

        if (LocalFileSecurityManager.getAccessMode() === "whole_computer" && !LocalFileSecurityManager.wholeComputerConfirmed) {
          return {
            ...currentPlan,
            revision: (currentPlan.revision || 0) + 1,
            actions: [
              ...completedActions,
              {
                id: `step-clarify-confirm-${Date.now()}`,
                type: ActionType.REQUEST_CLARIFICATION,
                risk: RiskLevel.LOW,
                reason: "WHOLE_COMPUTER_CONFIRMATION_REQUIRED: Whole-computer access mode requires explicit user confirmation in Settings before access is granted.",
              },
              {
                id: `finish-clarify-confirm-${Date.now()}`,
                type: ActionType.FINISH,
                risk: RiskLevel.LOW,
                reason: "Halt: Whole-computer confirmation required",
              },
            ],
          };
        }

        const query = currentPlan.taskSpec?.searchQuery || currentPlan.taskSpec?.targetEntity || "";
        const searchResult = LocalFileSecurityManager.searchAudioFiles(query);

        if (!searchResult.found || searchResult.candidates.length === 0) {
          return {
            ...currentPlan,
            revision: (currentPlan.revision || 0) + 1,
            actions: [
              ...completedActions,
              {
                id: `step-local-not-found-${Date.now()}`,
                type: ActionType.FINISH,
                risk: RiskLevel.LOW,
                reason: `No audio files matching '${query}' found in approved directory '${searchResult.searchedDirectory}'.`,
              },
            ],
          };
        }

        if (searchResult.isAmbiguous) {
          const fileList = searchResult.candidates.slice(0, 5).map((c) => `"${c.filename}"`).join(", ");
          return {
            ...currentPlan,
            revision: (currentPlan.revision || 0) + 1,
            actions: [
              ...completedActions,
              {
                id: `step-local-ambig-${Date.now()}`,
                type: ActionType.REQUEST_CLARIFICATION,
                risk: RiskLevel.LOW,
                reason: `FILE_SELECTION_REQUIRED: Multiple matching audio files found in approved directory: ${fileList}. Please clarify which file to play.`,
              },
              {
                id: `finish-ambig-${Date.now()}`,
                type: ActionType.FINISH,
                risk: RiskLevel.LOW,
                reason: "Halt: File selection clarification required",
              },
            ],
          };
        }

        const matched = searchResult.bestMatch!;
        const playerUrl = `http://localhost:3000/player/audio?path=${encodeURIComponent(matched.canonicalPath)}&title=${encodeURIComponent(matched.filename)}`;

        return {
          ...currentPlan,
          revision: (currentPlan.revision || 0) + 1,
          actions: [
            {
              id: `repaired-local-nav-${Date.now()}`,
              type: ActionType.NAVIGATE,
              value: playerUrl,
              risk: RiskLevel.LOW,
              reason: `Repair: Navigate to local audio player for verified file: ${matched.filename}`,
              retries: { maxRetries: 3, backoffMs: 500 },
            },
            {
              id: `repaired-local-wait-${Date.now()}`,
              type: ActionType.WAIT,
              value: 1200,
              risk: RiskLevel.LOW,
              reason: "Wait for audio stream to initialize",
            },
            {
              id: `repaired-local-play-${Date.now()}`,
              type: ActionType.CLICK,
              target: { strategy: "id", value: "audio-play-button" },
              risk: RiskLevel.LOW,
              reason: "Click play button",
            },
            {
              id: `repaired-local-progress-${Date.now()}`,
              type: ActionType.WAIT,
              value: 1500,
              risk: RiskLevel.LOW,
              reason: "Allow playback to progress",
            },
            {
              id: `repaired-verify-${Date.now()}`,
              type: ActionType.EXTRACT_TEXT,
              target: { strategy: "id", value: "playback-progressing" },
              risk: RiskLevel.LOW,
              reason: "Verify playback progression",
            },
            {
              id: `repaired-finish-${Date.now()}`,
              type: ActionType.FINISH,
              risk: RiskLevel.LOW,
              reason: "Playback verified successfully",
            },
          ],
        };
      }

      // Find destination from original plan or instruction
      const navAction = currentPlan.actions.find((a) => a.type === ActionType.NAVIGATE && typeof a.value === "string");
      let targetUrl = navAction ? String(navAction.value) : undefined;
      if (!targetUrl) {
        targetUrl = currentPlan.taskSpec?.targetUrl;
      }
      if (!targetUrl) {
        const rawText = currentPlan.taskSpec?.originalInstruction || currentPlan.taskInterpretation;
        const resolved = EntityConstraintResolver.resolve({ rawInstruction: rawText });
        targetUrl = resolved.targetUrl;
      }

      if (targetUrl) {
        if ((currentPlan.taskSpec?.operation === "SEARCH" || currentPlan.taskSpec?.operation === "MEDIA_PLAY") && (currentPlan.taskSpec?.searchQuery || currentPlan.taskSpec?.targetEntity)) {
          if (/^https?:\/\/open\.spotify\.com\/?$/i.test(targetUrl)) {
            targetUrl = "https://open.spotify.com/search";
          }
        }
        // If the failing step was already a navigate action to this target, avoid duplicate back-to-back navigate
        const remainingActions = currentPlan.actions.slice(failedStepIndex).filter((a, idx) => {
          if (idx === 0 && a.type === ActionType.NAVIGATE && String(a.value || "") === targetUrl) {
            return false;
          }
          return true;
        });

        const repairedNav: Action[] = [
          {
            id: `repaired-nav-${Date.now()}`,
            type: ActionType.NAVIGATE,
            value: targetUrl,
            risk: RiskLevel.LOW,
            reason: `Prerequisite repair: Navigate to target website ${targetUrl}`,
            retries: { maxRetries: 3, backoffMs: 500 },
          },
          {
            id: `repaired-wait-${Date.now()}`,
            type: ActionType.WAIT,
            value: 1200,
            risk: RiskLevel.LOW,
            reason: "Wait for target page to load and controls to render",
          },
          ...remainingActions,
        ];

        return {
          ...currentPlan,
          taskSpec: currentPlan.taskSpec,
          revision: (currentPlan.revision || 0) + 1,
          actions: repairedNav,
        };
      } else {
        return {
          ...currentPlan,
          revision: (currentPlan.revision || 0) + 1,
          actions: [
            ...completedActions,
            {
              id: `step-clarify-${Date.now()}`,
              type: ActionType.REQUEST_CLARIFICATION,
              risk: RiskLevel.LOW,
              reason: "Browser is at 'about:blank' and target website address was not provided. Please specify which website or URL to visit.",
            },
            {
              id: `finish-clarify-${Date.now()}`,
              type: ActionType.FINISH,
              risk: RiskLevel.LOW,
              reason: "Halt execution pending destination clarification",
            },
          ],
        };
      }
    }

    // Adapt button text based on observed buttons (e.g. "Find Products" instead of "Search")
    let targetButton = "Search";
    if (observation.interactiveElements) {
      const liveBtn = observation.interactiveElements.find(
        (el) =>
          (el.tagName === "BUTTON" || el.type === "submit") &&
          el.text &&
          (!failedTargets || !failedTargets.has(`text:${el.text.toLowerCase()}`))
      );
      if (liveBtn?.text) {
        targetButton = liveBtn.text;
      }
    }

    const revisedActions: Action[] = [
      {
        id: `repaired-action-${Date.now()}`,
        type: ActionType.CLICK,
        target: {
          strategy: "text",
          value: targetButton,
          role: "button",
          description: `Live adapted button: ${targetButton}`,
        },
        risk: RiskLevel.LOW,
        reason: `Click '${targetButton}' button adapted from live DOM observation`,
        retries: { maxRetries: 2, backoffMs: 500 },
      },
      {
        id: `finish-replan-${Date.now()}`,
        type: ActionType.FINISH,
        risk: RiskLevel.LOW,
        reason: "Conclude replanned workflow",
      },
    ];

    const enrichedRevised = this.enrichActions(revisedActions);

    return {
      ...currentPlan,
      taskSpec: currentPlan.taskSpec,
      taskInterpretation: currentPlan.taskInterpretation, // Strictly preserved!
      taskSuccessCriteria: currentPlan.taskSuccessCriteria, // Strictly preserved!
      actions: [...completedActions, ...enrichedRevised],
      revision: (currentPlan.revision || 0) + 1,
      assumptions: [
        ...(currentPlan.assumptions || []),
        `Re-planned at step ${failedStepIndex + 1}: ${failureReason}`,
      ],
    };
  }

  /**
   * Enriches generated actions with Vector-inspired structured planning attributes:
   * userIntent, targetDescription, parameters, preconditions, postconditions, dependencies,
   * verificationMethod, and verificationTarget.
   */
  public static enrichActions(actions: Action[], spec?: TaskSpecification): Action[] {
    return actions.map((action, idx) => {
      // 1. User Intent
      const userIntent = action.userIntent || action.reason || spec?.inferredGoal || "Execute planned browser step";

      // 2. Target Description
      const targetDescription = action.targetDescription || (
        action.target
          ? (action.target.description || `${action.target.strategy}: ${action.target.value}`)
          : undefined
      );

      // 3. Dependencies (linear DAG dependency on preceding actions)
      const dependencies = action.dependencies || (
        idx > 0 ? [actions[idx - 1].id] : []
      );

      // 4. Preconditions based on action type
      let preconditions = action.preconditions;
      if (!preconditions || preconditions.length === 0) {
        switch (action.type) {
          case ActionType.NAVIGATE:
            preconditions = ["browser_ready", "valid_url"];
            break;
          case ActionType.CLICK:
          case ActionType.DOUBLE_CLICK:
          case ActionType.HOVER:
          case ActionType.FILL:
          case ActionType.TYPE:
          case ActionType.SELECT:
          case ActionType.CHECK:
          case ActionType.UNCHECK:
            preconditions = ["page_loaded", "target_element_exists"];
            break;
          case ActionType.PRESS:
            preconditions = ["page_loaded"];
            break;
          case ActionType.EXTRACT_TEXT:
          case ActionType.EXTRACT_ATTRIBUTE:
          case ActionType.EXTRACT_TABLE:
            preconditions = ["page_loaded", "target_element_exists"];
            break;
          case ActionType.MEDIA_PLAY:
          case ActionType.MEDIA_PAUSE:
          case ActionType.MEDIA_MUTE:
            preconditions = ["page_loaded", "media_element_present"];
            break;
          case ActionType.FINISH:
            preconditions = idx > 0 ? ["prerequisite_actions_completed"] : [];
            break;
          case ActionType.WAIT:
          default:
            preconditions = [];
            break;
        }
      }

      // 5. Postconditions based on action type
      let postconditions = action.postconditions;
      if (!postconditions || postconditions.length === 0) {
        switch (action.type) {
          case ActionType.NAVIGATE:
            postconditions = ["url_updated", "page_loaded"];
            break;
          case ActionType.FILL:
          case ActionType.TYPE:
            postconditions = ["input_value_set"];
            break;
          case ActionType.CLICK:
          case ActionType.DOUBLE_CLICK:
            postconditions = ["element_activated", "state_transitioned"];
            break;
          case ActionType.EXTRACT_TEXT:
          case ActionType.EXTRACT_ATTRIBUTE:
          case ActionType.EXTRACT_TABLE:
            postconditions = ["data_extracted"];
            break;
          case ActionType.MEDIA_PLAY:
            postconditions = ["playback_active"];
            break;
          case ActionType.MEDIA_PAUSE:
            postconditions = ["playback_paused"];
            break;
          case ActionType.FINISH:
            postconditions = ["task_goal_satisfied"];
            break;
          case ActionType.WAIT:
          default:
            postconditions = ["step_completed"];
            break;
        }
      }

      // 6. Verification Method & Target
      let verificationMethod = action.verificationMethod;
      let verificationTarget = action.verificationTarget;
      if (!verificationMethod) {
        switch (action.type) {
          case ActionType.NAVIGATE:
            verificationMethod = "url_change";
            verificationTarget = typeof action.value === "string" ? action.value : undefined;
            break;
          case ActionType.FILL:
            verificationMethod = "value_check";
            verificationTarget = typeof action.value === "string" ? action.value : undefined;
            break;
          case ActionType.CLICK:
            verificationMethod = "dom_mutation";
            verificationTarget = action.target?.value;
            break;
          case ActionType.EXTRACT_TEXT:
          case ActionType.EXTRACT_ATTRIBUTE:
          case ActionType.EXTRACT_TABLE:
            verificationMethod = "extracted_data";
            verificationTarget = action.target?.value;
            break;
          case ActionType.MEDIA_PLAY:
          case ActionType.MEDIA_PAUSE:
            verificationMethod = "media_state";
            break;
          case ActionType.FINISH:
            verificationMethod = "task_criteria";
            break;
          default:
            verificationMethod = "none";
            break;
        }
      }

      // 7. Parameters
      const parameters = action.parameters || (
        action.value !== undefined ? { value: action.value } : undefined
      );

      return {
        ...action,
        userIntent,
        targetDescription,
        parameters,
        preconditions,
        postconditions,
        dependencies,
        verificationMethod,
        verificationTarget,
      };
    });
  }
}
