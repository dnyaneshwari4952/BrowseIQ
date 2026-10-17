import { Action, ActionType, ExpectedState } from "../types/actions";
import { PageObservation } from "../types/browser";
import { DownloadedArtifact } from "../types/results";

export interface ActionVerificationResult {
  verified: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

/**
 * Action Verifier (Part 3)
 * Validates whether an INDIVIDUAL action achieved its expected immediate state change.
 */
export class ActionVerifier {
  /**
   * Verifies an action against the before and after browser observations.
   */
  static verifyAction(params: {
    action: Action;
    beforeObservation?: PageObservation | null;
    afterObservation: PageObservation;
    extractedValue?: unknown;
    downloadedArtifact?: DownloadedArtifact | null;
  }): ActionVerificationResult {
    const { action, beforeObservation, afterObservation, extractedValue, downloadedArtifact } = params;

    switch (action.type) {
      case ActionType.NAVIGATE: {
        const expectedTarget = typeof action.value === "string" ? action.value : "";
        if (expectedTarget) {
          try {
            const expectedUrl = new URL(expectedTarget);
            const actualUrl = new URL(afterObservation.url);
            // Verify origin and pathname match or target prefix
            const matchesOrigin = actualUrl.origin === expectedUrl.origin;
            const matchesPath = actualUrl.pathname.startsWith(expectedUrl.pathname) || expectedUrl.pathname === "/";
            if (!matchesOrigin) {
              return {
                verified: false,
                reason: `Navigation reached '${afterObservation.url}', expected origin '${expectedUrl.origin}'`,
                details: { actual: afterObservation.url, expected: expectedTarget },
              };
            }
          } catch {
            // If string target is relative or path
            if (!afterObservation.url.includes(expectedTarget)) {
              return {
                verified: false,
                reason: `Navigation reached '${afterObservation.url}', which does not contain '${expectedTarget}'`,
              };
            }
          }
        }
        return { verified: true, reason: `Navigation successfully reached ${afterObservation.url}` };
      }

      case ActionType.FILL:
      case ActionType.TYPE: {
        const expectedValue = String(action.value ?? "");
        if (!action.target) {
          return { verified: false, reason: "Fill action missing target selector" };
        }
        // Find visible element in after-observation (prefer visible interactive element over hidden duplicates)
        const matchingEl =
          afterObservation.interactiveElements.find(
            (el) =>
              el.isVisible &&
              (el.id === action.target?.value ||
                el.name === action.target?.value ||
                el.label === action.target?.value ||
                el.placeholder === action.target?.value)
          ) ||
          afterObservation.interactiveElements.find(
            (el) =>
              el.id === action.target?.value ||
              el.name === action.target?.value ||
              el.label === action.target?.value ||
              el.placeholder === action.target?.value
          );
        if (matchingEl && matchingEl.value !== undefined) {
          if (matchingEl.value !== expectedValue) {
            return {
              verified: false,
              reason: `Input element value '${matchingEl.value}' does not match expected '${expectedValue}'`,
              details: { actual: matchingEl.value, expected: expectedValue },
            };
          }
        }
        return { verified: true, reason: `Input filled with '${expectedValue}'` };
      }

      case ActionType.CLICK:
      case ActionType.DOUBLE_CLICK: {
        const expected = action.expectedState;
        if (expected) {
          if (expected.urlChange && beforeObservation && beforeObservation.url === afterObservation.url) {
            return {
              verified: false,
              reason: `Expected URL change after click, but URL remained '${afterObservation.url}'`,
            };
          }
          if (expected.elementAppears) {
            const expLower = expected.elementAppears.toLowerCase();
            const appeared = afterObservation.interactiveElements.some(
              (el) =>
                el.text?.toLowerCase().includes(expLower) ||
                el.name?.toLowerCase().includes(expLower) ||
                el.id?.toLowerCase() === expLower ||
                el.testId?.toLowerCase().includes(expLower)
            );
            if (!appeared && !afterObservation.headings.some((h) => h.toLowerCase().includes(expLower))) {
              return {
                verified: false,
                reason: `Expected element/text '${expected.elementAppears}' to appear after click`,
              };
            }
          }
        }
        return { verified: true, reason: "Click executed and validated" };
      }

      case ActionType.DOWNLOAD: {
        if (!downloadedArtifact) {
          return {
            verified: false,
            reason: "Download event was not captured or file was not received",
          };
        }
        if (downloadedArtifact.fileSizeBytes <= 0) {
          return {
            verified: false,
            reason: `Downloaded file '${downloadedArtifact.originalFilename}' is empty (0 bytes)`,
          };
        }
        return {
          verified: true,
          reason: `Download completed: ${downloadedArtifact.originalFilename} (${downloadedArtifact.fileSizeBytes} bytes)`,
          details: { artifact: downloadedArtifact },
        };
      }

      case ActionType.EXTRACT_TEXT:
      case ActionType.EXTRACT_ATTRIBUTE:
      case ActionType.EXTRACT_TABLE: {
        if (extractedValue === null || extractedValue === undefined || extractedValue === "") {
          return {
            verified: false,
            reason: "Extracted value is empty or not found on page",
          };
        }
        if (Array.isArray(extractedValue) && extractedValue.length === 0) {
          return {
            verified: false,
            reason: "Extracted collection is empty",
          };
        }
        return {
          verified: true,
          reason: "Data extracted successfully",
          details: { value: extractedValue },
        };
      }

      case ActionType.ASSERT: {
        const expected = action.expectedState;
        if (expected?.textContains) {
          const found =
            afterObservation.headings.some((h) => h.includes(expected.textContains!)) ||
            afterObservation.interactiveElements.some((el) => el.text?.includes(expected.textContains!));
          if (!found) {
            return {
              verified: false,
              reason: `Assertion failed: page does not contain text '${expected.textContains}'`,
            };
          }
        }
        return { verified: true, reason: "Assertion satisfied" };
      }

      default:
        return { verified: true, reason: `Action ${action.type} completed` };
    }
  }
}
