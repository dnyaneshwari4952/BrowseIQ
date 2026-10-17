import { TaskIntent } from "../types/plans";
import { PageObservation } from "../types/browser";

export interface CapabilityCheckResult {
  hasMismatch: boolean;
  requiredCapability?: string;
  availableCapabilities: string[];
  explanation?: string;
}

export class PageCapabilityDetector {
  /**
   * Evaluates whether the currently observed page contains the structural
   * capabilities required by the user's TaskIntent.
   */
  static detectMismatch(intent: TaskIntent, observation: PageObservation): CapabilityCheckResult {
    const elements = observation.interactiveElements || [];
    const title = (observation.title || "").toLowerCase();
    const url = (observation.url || "").toLowerCase();

    const availableCapabilities: string[] = [];

    // Search input detection
    const hasSearchInput = elements.some((e) => {
      const type = (e.type || "").toLowerCase();
      const placeholder = (e.placeholder || "").toLowerCase();
      const label = (e.label || "").toLowerCase();
      const name = (e.name || "").toLowerCase();
      const id = (e.id || "").toLowerCase();
      return (
        type === "search" ||
        placeholder.includes("search") ||
        placeholder.includes("find") ||
        label.includes("search") ||
        name.includes("search") ||
        id.includes("search") ||
        e.role === "searchbox"
      );
    });

    // Form inputs detection
    const hasFormInputs = elements.some((e) => {
      const name = (e.name || "").toLowerCase();
      const label = (e.label || "").toLowerCase();
      const id = (e.id || "").toLowerCase();
      return (
        name.includes("name") ||
        name.includes("email") ||
        name.includes("phone") ||
        name.includes("message") ||
        label.includes("name") ||
        label.includes("email") ||
        id.includes("fullname") ||
        id.includes("email")
      );
    });

    const hasSubmitButton = elements.some((e) => {
      const text = (e.text || "").toLowerCase();
      return text.includes("submit") || text.includes("send") || text.includes("apply");
    });

    // Download capability
    const hasDownloadLink = elements.some((e) => {
      const text = (e.text || "").toLowerCase();
      const href = (e.href || "").toLowerCase();
      return text.includes("download") || href.includes("download") || href.endsWith(".pdf");
    });

    if (hasSearchInput) availableCapabilities.push("SEARCH");
    if (hasFormInputs && hasSubmitButton) availableCapabilities.push("FORM_SUBMISSION");
    if (hasDownloadLink) availableCapabilities.push("DOWNLOAD");

    // 1. Check mismatch: User requested SEARCH, but page is purely a Form or has no search capability
    const isSearchIntent = [
      "SEARCH",
      "SEARCH_AND_COMPARE",
      "SEARCH_AND_FILTER",
      "SEARCH_AND_COUNT",
      "SEARCH_AND_SELECT",
    ].includes(intent.intentType);

    if (isSearchIntent && !hasSearchInput) {
      if (availableCapabilities.includes("FORM_SUBMISSION") || title.includes("contact") || url.includes("/form")) {
        return {
          hasMismatch: true,
          requiredCapability: "SEARCH",
          availableCapabilities,
          explanation: `Page capability mismatch: Target page "${observation.title || observation.url}" provides [FORM_SUBMISSION] capabilities but does not have a search interface. Cannot execute search query for "${intent.query || intent.entity || "products"}" on this page. Please provide a search catalog URL.`,
        };
      }
    }

    // 2. Check mismatch: User requested FORM_SUBMIT, but page has no form inputs and is a search page
    if (intent.intentType === "FORM_SUBMIT" && !hasFormInputs && hasSearchInput) {
      return {
        hasMismatch: true,
        requiredCapability: "FORM_SUBMISSION",
        availableCapabilities,
        explanation: `Page capability mismatch: Target page "${observation.title || observation.url}" is a Search page and does not contain a submission form.`,
      };
    }

    return {
      hasMismatch: false,
      availableCapabilities,
    };
  }
}
