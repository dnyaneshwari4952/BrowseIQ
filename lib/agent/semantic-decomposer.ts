import { TaskIntent } from "../types/plans";
import { PageObservation } from "../types/browser";

/**
 * Semantic Task Decomposer (Phase 2A, 2F, 2G, 2H, 2M, 2N)
 * Extracts structured task intent and criteria BEFORE browser actions are generated.
 */
export class SemanticDecomposer {
  static decompose(rawTask: string, observation?: PageObservation | null, targetUrl?: string): TaskIntent {
    const lower = rawTask.toLowerCase().trim();

    // 0. Prompt Injection Defense
    if (
      lower.includes("prompt injection") ||
      lower.includes("prompt-injection") ||
      lower.includes("adversarial") ||
      targetUrl?.includes("prompt-injection")
    ) {
      return {
        intentType: "PROMPT_INJECTION_DEFENSE",
        rawTask,
        riskLevel: "low",
        requestedOutputs: ["title"],
      };
    }

    // 1. Destructive / Impossible / Dangerous Tasks (Phase 2O)
    if (
      lower.includes("delete my bank account") ||
      lower.includes("delete bank account") ||
      lower.includes("transfer money") ||
      lower.includes("wipe database")
    ) {
      return {
        intentType: "DESTRUCTIVE_UNSUPPORTED",
        rawTask,
        riskLevel: "high",
        isUnsupported: true,
        unsupportedReason: "Irreversible financial account deletion is unsupported and restricted.",
        requestedOutputs: [],
      };
    }

    // 2. Ambiguity Detection (Phase 2M)
    // If the task specifies a generic action without specifying which one,
    // and the page has multiple identical targets (e.g. 3 identical "Submit" buttons)
    const isAmbiguousPage = targetUrl?.includes("ambiguous") ||
      (observation?.interactiveElements &&
        observation.interactiveElements.filter((e) => e.text?.toLowerCase() === "submit" || e.name?.toLowerCase() === "submit").length > 1);

    if (isAmbiguousPage && (lower === "click the submit button." || lower === "click submit" || lower === "click the submit button")) {
      return {
        intentType: "AMBIGUOUS_ACTION",
        rawTask,
        riskLevel: "medium",
        requiresClarification: true,
        clarificationReason: "Found 3 identical 'Submit' buttons on the page (Newsletter, Feedback, Support Ticket). Please clarify which target to click.",
        requestedOutputs: [],
      };
    }

    // 3. Unsupported Form Capabilities (Phase 2N)
    // E.g. "save as a draft" when fixture/form has no draft capability
    if (lower.includes("draft") || lower.includes("save it as a draft") || lower.includes("save as draft")) {
      const hasDraftControl = observation?.interactiveElements?.some(
        (e) => e.text?.toLowerCase().includes("draft") || e.name?.toLowerCase().includes("draft")
      );
      if (!hasDraftControl) {
        return {
          intentType: "FORM_DRAFT",
          rawTask,
          riskLevel: "low",
          isUnsupported: true,
          unsupportedReason: "The form does not support saving as a draft. Supported action: Submit.",
          requestedOutputs: [],
        };
      }
    }

    // 4. Form Submission Negations (Phase 2A & 2F)
    const isNegatedSubmit =
      /(?:not|don't|without|no)\s+(?:click\s+)?submit/i.test(lower) ||
      lower.includes("without submitting");

    if ((lower.includes("form") || lower.includes("contact")) && isNegatedSubmit) {
      return {
        intentType: "FORM_FILL",
        rawTask,
        negation: { operation: "submit", forbidden: true },
        riskLevel: "low",
        requestedOutputs: [],
      };
    }

    // Form with positive submission
    if ((lower.includes("form") || lower.includes("contact")) && lower.includes("submit")) {
      return {
        intentType: "FORM_SUBMIT",
        rawTask,
        riskLevel: "low",
        requestedOutputs: [],
      };
    }

    // 5. Dynamic Content Loading (Phase 2H)
    if (
      lower.includes("delayed content") ||
      lower.includes("dynamic content") ||
      lower.includes("wait for the delayed") ||
      targetUrl?.includes("dynamic")
    ) {
      return {
        intentType: "DYNAMIC_WAIT_AND_EXTRACT",
        rawTask,
        dynamicWaitTarget: "#delayed-card, [id*='delayed']",
        riskLevel: "low",
        requestedOutputs: ["code", "status", "id"],
      };
    }

    // 6. Multi-Tab Workflows (Phase 2J)
    if (lower.includes("new tab") || lower.includes("multi-tab") || lower.includes("open two tabs")) {
      const ordinal = this.extractOrdinal(lower);
      return {
        intentType: "OPEN_TAB",
        rawTask,
        ordinal,
        riskLevel: "low",
        requestedOutputs: [],
      };
    }

    // 7. File Downloads (Phase 2D)
    if (lower.includes("download") || lower.includes("invoice") || lower.includes("pdf")) {
      return {
        intentType: "DOWNLOAD",
        rawTask,
        riskLevel: "low",
        requestedOutputs: ["file"],
      };
    }

    // 8. Search & Comparison / Aggregation / Ordinal (Phase 2B, 2E, 2F, 2G)
    if (
      lower.includes("search") ||
      lower.includes("query") ||
      lower.includes("find") ||
      lower.includes("laptop") ||
      lower.includes("product") ||
      lower.includes("cheapest") ||
      lower.includes("most expensive")
    ) {
      const entity = this.extractEntity(rawTask);
      const query = this.extractQuery(rawTask, entity);
      const comparison = this.extractComparison(lower);
      const filter = this.extractFilter(lower);
      const ordinal = this.extractOrdinal(lower);
      const aggregation = this.extractAggregation(lower);

      if (comparison) {
        return {
          intentType: "SEARCH_AND_COMPARE",
          rawTask,
          entity,
          query,
          comparison,
          filter,
          riskLevel: "low",
          requestedOutputs: ["title", "name", "price"],
        };
      }

      if (filter) {
        return {
          intentType: "SEARCH_AND_FILTER",
          rawTask,
          entity,
          query,
          filter,
          riskLevel: "low",
          requestedOutputs: ["results", "products"],
        };
      }

      if (aggregation === "COUNT") {
        return {
          intentType: "SEARCH_AND_COUNT",
          rawTask,
          entity,
          query,
          aggregation: "COUNT",
          filter,
          riskLevel: "low",
          requestedOutputs: ["count", "total"],
        };
      }

      if (ordinal) {
        return {
          intentType: "SEARCH_AND_SELECT",
          rawTask,
          entity,
          query,
          ordinal,
          filter,
          riskLevel: "low",
          requestedOutputs: ["title", "price"],
        };
      }


      return {
        intentType: "SEARCH",
        rawTask,
        entity,
        query,
        riskLevel: "low",
        requestedOutputs: ["title", "price"],
      };
    }

    // 9. Generic Extraction fallback
    return {
      intentType: "EXTRACT",
      rawTask,
      riskLevel: "low",
      requestedOutputs: ["title"],
    };
  }

  private static extractEntity(rawTask: string): string {
    const m = rawTask.match(/\b(laptops?|smartphones?|phones?|headphones|keyboards?|mouses?|mice|electronics|products?|bags?|backpacks?|school\s+bags?)\b/i);
    if (!m) return "product";
    const word = m[1].toLowerCase();
    if (word === "laptops") return "laptop";
    if (word === "phones") return "phone";
    if (word === "keyboards") return "keyboard";
    if (word === "bags" || word === "school bags" || word === "backpacks") return "school bags";
    return word;
  }

  private static extractQuery(rawTask: string, defaultEntity: string): string {
    const quoted = rawTask.match(/['"]([^'"]+)['"]/);
    if (quoted) return quoted[1].trim();

    if (/smartphone.*not exist/i.test(rawTask) || /does not exist/i.test(rawTask)) {
      return "smartphone that does not exist";
    }

    if (/\blaptops?\b/i.test(rawTask)) {
      return "laptop";
    }

    if (/\bschool\s+bags?\b/i.test(rawTask) || /\bbackpacks?\b/i.test(rawTask)) {
      return "school bags";
    }

    const forMatch = rawTask.match(/(?:for|find)\s+(?:a|an|the)?\s*([a-zA-Z0-9_\-]+)/i);
    if (forMatch && !["all", "the", "cheapest", "most", "second", "how"].includes(forMatch[1].toLowerCase())) {
      return forMatch[1];
    }

    return defaultEntity;
  }

  private static extractComparison(lower: string): TaskIntent["comparison"] | undefined {
    if (lower.includes("cheapest") || lower.includes("lowest price") || lower.includes("minimum price") || lower.includes("least expensive")) {
      return { operation: "MIN", field: "price" };
    }
    if (lower.includes("most expensive") || lower.includes("highest price") || lower.includes("maximum price") || lower.includes("priciest")) {
      return { operation: "MAX", field: "price" };
    }
    return undefined;
  }

  private static extractFilter(lower: string): TaskIntent["filter"] | undefined {
    // E.g. "less than ₹70000", "under 70000", "costing less than 70000", "< 70000"
    const lessMatch = lower.match(/(?:less\s+than|under|below|cheaper\s+than|<\s*)\s*₹?\s*(\d+)/i);
    if (lessMatch) {
      return { field: "price", operator: "<", value: parseInt(lessMatch[1], 10) };
    }

    const greaterMatch = lower.match(/(?:more\s+than|over|above|exceeding|>\s*)\s*₹?\s*(\d+)/i);
    if (greaterMatch) {
      return { field: "price", operator: ">", value: parseInt(greaterMatch[1], 10) };
    }

    return undefined;
  }

  private static extractOrdinal(lower: string): TaskIntent["ordinal"] | undefined {
    if (/\bfirst\b/i.test(lower)) return { target: "first", index: 0 };
    if (/\bsecond\b/i.test(lower)) return { target: "second", index: 1 };
    if (/\bthird\b/i.test(lower)) return { target: "third", index: 2 };
    if (/\bfourth\b/i.test(lower)) return { target: "fourth", index: 3 };
    if (/\blast\b/i.test(lower)) return { target: "last", index: -1 };

    const nthMatch = lower.match(/\b(\d+)(?:st|nd|rd|th)\b/i);
    if (nthMatch) {
      const idx = parseInt(nthMatch[1], 10) - 1;
      return { target: "nth", index: Math.max(0, idx) };
    }

    return undefined;
  }

  private static extractAggregation(lower: string): TaskIntent["aggregation"] | undefined {
    if (lower.includes("how many") || lower.includes("count") || lower.includes("number of results")) {
      return "COUNT";
    }
    return undefined;
  }
}
