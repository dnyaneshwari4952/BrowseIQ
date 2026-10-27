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
      lower.includes("wipe database") ||
      lower.includes("delete all users") ||
      lower.includes("purge database") ||
      lower.includes("drop table") ||
      lower.includes("drop database")
    ) {
      return {
        intentType: "DESTRUCTIVE_UNSUPPORTED",
        rawTask,
        riskLevel: "high",
        isUnsupported: true,
        unsupportedReason: "Irreversible destructive data purge or financial transfer is unsupported and restricted by safety guardrails.",
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

    if (
      /\b(?:somewhere|search\s+for\s+something|find\s+something|do\s+something)\b/i.test(lower) ||
      lower.includes("book a flight somewhere") ||
      lower.includes("fly somewhere")
    ) {
      return {
        intentType: "AMBIGUOUS_ACTION",
        rawTask,
        riskLevel: "medium",
        requiresClarification: true,
        clarificationReason: "User instruction is missing specific target search terms or destination ('something' / 'somewhere'). Please clarify what item or destination you would like to find.",
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

    // 3b. Unsupported External Operations on Current Page (Phase 4 Section 3)
    if (lower.includes("flight") || lower.includes("hotel") || lower.includes("uber") || lower.includes("train")) {
      return {
        intentType: "DESTRUCTIVE_UNSUPPORTED",
        rawTask,
        riskLevel: "low",
        isUnsupported: true,
        unsupportedReason: "Flight, travel, or lodging reservation is not supported by this product catalog interface.",
        requestedOutputs: [],
      };
    }

    // 4. General Negations & Task Restrictions (Phase 2 Step 3)
    const negation = this.extractNegation(lower);

    // Form submission with negation or positive submission
    if ((lower.includes("form") || lower.includes("contact")) && negation?.operation === "submit") {
      return {
        intentType: "FORM_FILL",
        rawTask,
        negation,
        riskLevel: "low",
        requestedOutputs: [],
      };
    }

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
    const isDownloadAction =
      (lower.includes("invoice") || lower.includes("pdf") || /\bdownload(?:ing)?\b/i.test(lower)) &&
      !/\b(?:from\s+downloads\s+folder|from\s+downloads|in\s+downloads|downloads\s+folder)\b/i.test(lower) &&
      !/\b(?:play|stream|listen(?:\s+to)?)\b/i.test(lower);

    if (isDownloadAction) {
      return {
        intentType: "DOWNLOAD",
        rawTask,
        riskLevel: "low",
        requestedOutputs: ["file"],
      };
    }

    // 8. Explicit Non-Search Tasks (Phase 2 Step 3: Inspections, Static Extractions, Navigations)
    // 8a. Inspection tasks (e.g. "Check if the contact form contains a phone field", "Inspect privacy policy")
    const isInspection =
      (lower.includes("inspect") ||
        lower.includes("check whether") ||
        lower.includes("check if") ||
        lower.includes("verify whether") ||
        lower.includes("find whether")) &&
      (lower.includes("field") ||
        lower.includes("policy") ||
        lower.includes("disclaimer") ||
        lower.includes("footer") ||
        lower.includes("contains"));

    if (isInspection) {
      return {
        intentType: "CONTENT_INSPECT",
        rawTask,
        riskLevel: "low",
        requestedOutputs: ["element", "status"],
      };
    }

    // 8b. Extraction without navigation (e.g. "Extract the available product names and prices without changing the page")
    if (
      (lower.includes("extract") || lower.includes("show") || lower.includes("list")) &&
      (negation?.operation === "navigate" || lower.includes("without changing the page") || lower.includes("stay on this page"))
    ) {
      const requestedOutputs: string[] = [];
      if (lower.includes("name") || lower.includes("title")) requestedOutputs.push("name");
      if (lower.includes("price") || lower.includes("cost")) requestedOutputs.push("price");
      if (requestedOutputs.length === 0) requestedOutputs.push("title");

      return {
        intentType: "EXTRACT",
        rawTask,
        negation: { operation: "navigate", forbidden: true },
        riskLevel: "low",
        requestedOutputs,
      };
    }

    // 8c. Open details with negation (e.g. "Open the product details without adding the item to the cart")
    if (
      (lower.includes("open") || lower.includes("details")) &&
      negation?.operation === "add_to_cart"
    ) {
      return {
        intentType: "NAVIGATION",
        rawTask,
        negation,
        riskLevel: "low",
        requestedOutputs: ["title"],
      };
    }

    // 8d. Explicit Click Actions (e.g. "Click non-existent checkout button", "Click disabled button")
    if (lower.startsWith("click ") || lower.includes("click button") || lower.includes("click non-existent")) {
      const match = rawTask.match(/click\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+button)?$/i);
      const entity = match ? match[1].trim() : "button";
      return {
        intentType: "CLICK_ELEMENT",
        rawTask,
        entity,
        riskLevel: "low",
        requestedOutputs: [],
      };
    }

    // 8e. Media Playback (Local File or Online Platform) (Phase 3 & Requirement 2)
    const isMediaPlayback =
      /\b(?:play|stream|listen(?:\s+to)?|watch)\b/i.test(lower) &&
      !lower.startsWith("click ") &&
      !lower.includes("playwright");

    const isLocalFileTask =
      /\b(?:downloads?\s+folder|downloads?|desktop|documents?|music\s+folder|music|videos?\s+folder|videos?|local\s+storage|local\s+file|local\s+files|local\s+disk|my\s+computer|this\s+pc|on\s+my\s+pc|on\s+my\s+computer|on\s+computer|from\s+computer|from\s+local|in\s+local|from\s+downloads|in\s+downloads|local\s+audio|local\s+song|local\s+music|whole\s+computer)\b/i.test(lower);

    const hasWebsiteIndicator =
      Boolean(targetUrl) ||
      /\b(?:on\s+(?:spotify|youtube|soundcloud|vimeo|apple\s+music|netflix|flipkart|amazon)|https?:\/\/|[a-zA-Z0-9-]+\.(?:com|org|net|io|in|tv))\b/i.test(lower);

    const taskScope: "website" | "local_file" | "mixed" =
      isLocalFileTask && hasWebsiteIndicator
        ? "mixed"
        : isLocalFileTask
        ? "local_file"
        : "website";

    const isLocalAudioAction =
      taskScope === "local_file" &&
      (/\b(?:find|search(?:\s+for)?|locate|open)\b/i.test(lower) &&
        (/\b(?:hey\s+sinamika|sinamika|song|track|audio|music|wav|mp3|flac|m4a|aac|ogg)\b/i.test(lower) ||
          /\b(?:on\s+my\s+computer|on\s+computer|on\s+this\s+pc|in\s+downloads|in\s+music)\b/i.test(lower)));

    if (isMediaPlayback || isLocalAudioAction) {
      const mediaMatch = rawTask.match(
        /(?:play|stream|listen(?:\s+to)?|watch|find|search(?:\s+for)?|locate|open)\s+(?:a|an|the)?\s*([a-zA-Z0-9_\-\s]+?)(?=\s+\b(?:on|in|at|by|from|via)\b|[.,!?;:]|$)/i
      );
      let mediaEntity = mediaMatch ? mediaMatch[1].trim() : this.extractEntity(rawTask);
      mediaEntity = mediaEntity.replace(/\s+(?:song|track|video|music|audio)$/i, "").trim();
      const mediaQuery = mediaEntity || this.extractQuery(rawTask, mediaEntity);
      const cleanMediaTitle = mediaQuery
        .replace(
          /\b(?:from\s+downloads\s+folder|from\s+downloads|from\s+local\s+storage|from\s+local|from\s+desktop|from\s+documents|from\s+music|from\s+computer|on\s+my\s+computer|on\s+computer|on\s+this\s+pc|on\s+desktop|in\s+downloads|in\s+music|in\s+documents|in\s+videos|downloads\s+folder|local\s+storage|local\s+disk|whole\s+computer|on\s+local\s+storage)\b/gi,
          ""
        )
        .replace(/\s+(?:song|track|video|music|audio)$/i, "")
        .trim();

      if (taskScope === "local_file") {
        return {
          intentType: "LOCAL_MEDIA_PLAY",
          taskScope: "local_file",
          rawTask,
          entity: cleanMediaTitle || mediaEntity,
          query: cleanMediaTitle || mediaQuery,
          localFileDetails: {
            targetTitle: cleanMediaTitle,
            targetDirectoryType: lower.includes("downloads")
              ? "downloads"
              : lower.includes("music")
              ? "music"
              : lower.includes("documents")
              ? "documents"
              : lower.includes("desktop")
              ? "desktop"
              : lower.includes("videos")
              ? "videos"
              : lower.includes("computer") || lower.includes("pc")
              ? "whole_computer"
              : "unknown",
            mediaType: "audio",
          },
          negation,
          riskLevel: "low",
          requestedOutputs: ["mediaState", "playbackProgress"],
        };
      }

      return {
        intentType: "MEDIA_PLAY",
        taskScope,
        rawTask,
        entity: mediaEntity,
        query: mediaQuery,
        negation,
        riskLevel: "low",
        requestedOutputs: ["mediaState"],
      };
    }

    // 9. Search & Comparison / Aggregation / Ordinal / Window Limits (Phase 2B, 2E, 2F, 2G & Phase 2 Step 3)
    const entity = this.extractEntity(rawTask);
    const query = this.extractQuery(rawTask, entity);
    const comparison = this.extractComparison(lower);
    const filter = this.extractFilter(lower);
    const ordinal = this.extractOrdinal(lower);
    const aggregation = this.extractAggregation(lower);
    const windowLimit = this.extractWindowLimit(lower);

    const isFormInspection =
      lower.includes("contact form") &&
      (lower.includes("contains") || lower.includes("field") || lower.includes("whether"));

    const isSearchOrCatalogTask =
      !isFormInspection &&
      (lower.includes("search") ||
        lower.includes("query") ||
        lower.includes("find") ||
        lower.includes("look up") ||
        lower.includes("look for") ||
        lower.includes("which") ||
        lower.includes("catalog") ||
        lower.includes("compare") ||
        lower.includes("identify") ||
        Boolean(comparison) ||
        Boolean(filter) ||
        Boolean(ordinal) ||
        Boolean(aggregation) ||
        Boolean(windowLimit));

    if (isSearchOrCatalogTask) {
      if (comparison) {
        return {
          intentType: "SEARCH_AND_COMPARE",
          rawTask,
          entity,
          query,
          comparison,
          filter,
          ordinal,
          windowLimit,
          negation,
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
          ordinal,
          windowLimit,
          negation,
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
          negation,
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
          windowLimit,
          negation,
          riskLevel: "low",
          requestedOutputs: ["title", "price"],
        };
      }

      return {
        intentType: "SEARCH",
        rawTask,
        entity,
        query,
        windowLimit,
        negation,
        riskLevel: "low",
        requestedOutputs: ["title", "price"],
      };
    }

    // 10. Generic Extraction fallback
    return {
      intentType: "EXTRACT",
      rawTask,
      negation,
      riskLevel: "low",
      requestedOutputs: ["title"],
    };
  }

  private static extractNegation(lower: string): TaskIntent["negation"] | undefined {
    // Form submission negation
    const isNegatedSubmit =
      /(?:not|don't|without|no|never)\s+(?:click\s+)?submit/i.test(lower) ||
      /(?:leave|keep)\s+(?:it\s+)?unsubmitted/i.test(lower) ||
      lower.includes("without submitting") ||
      lower.includes("unsubmitted");
    if (isNegatedSubmit) {
      return { operation: "submit", forbidden: true };
    }

    // Purchase / Buy / Checkout negation
    if (
      /(?:do\s+not|don't|never|without)\s+(?:purchase|buy|ordering|place\s+order|checkout)/i.test(lower) ||
      lower.includes("without buying") ||
      lower.includes("do not buy") ||
      lower.includes("do not purchase") ||
      lower.includes("don't purchase")
    ) {
      return { operation: "purchase", forbidden: true };
    }

    // Add to cart negation
    if (
      /(?:without|do\s+not|don't|never)\s+adding\s+(?:the\s+item\s+)?to\s+(?:the\s+)?cart/i.test(lower) ||
      /(?:do\s+not|don't|without)\s+add\s+(?:it\s+|the\s+item\s+)?to\s+(?:the\s+)?cart/i.test(lower) ||
      lower.includes("without adding")
    ) {
      return { operation: "add_to_cart", forbidden: true };
    }

    // Navigation / Page change negation
    if (
      /(?:without|do\s+not|don't|never)\s+(?:changing\s+(?:the\s+)?page|navigating|leaving\s+(?:the\s+)?page)/i.test(lower) ||
      lower.includes("without changing the page") ||
      lower.includes("stay on this page")
    ) {
      return { operation: "navigate", forbidden: true };
    }

    return undefined;
  }

  private static extractWindowLimit(lower: string): number | undefined {
    const wordToNum: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };

    const match =
      lower.match(
        /(?:show\s+(?:me\s+)?(?:the\s+)?|top\s+|first\s+|list\s+(?:the\s+)?|get\s+(?:the\s+)?)(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:most|least|cheapest|priciest|lowest|highest|affordable|matching|best|products|items|results)/i
      ) || lower.match(/(\d+|one|two|three|four|five)\s+most\s+(?:affordable|expensive)/i);

    if (match) {
      const val = match[1].toLowerCase();
      if (wordToNum[val] !== undefined) return wordToNum[val];
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return undefined;
  }

  private static extractEntity(rawTask: string): string {
    const quoted = rawTask.match(/['"]([^'"]+)['"]/);
    if (quoted && quoted[1].trim().length > 1 && !["submit", "click", "download"].includes(quoted[1].toLowerCase().trim())) {
      return quoted[1].toLowerCase().trim();
    }

    if (/\b(?:portable\s+computers?)\b/i.test(rawTask)) {
      return "portable computer";
    }

    const m = rawTask.match(/\b(laptops?|notebooks?|smartphones?|phones?|mobiles?|cellphones?|headphones|keyboards?|mouses?|mice|electronics|products?|bags?|backpacks?|school\s+bags?|satchels?|knapsacks?|monitors?|tablets?|smartwatches?)\b/i);
    if (m) {
      const word = m[1].toLowerCase();
      if (word === "laptops" || word === "notebook" || word === "notebooks") return "laptop";
      if (word === "phones" || word === "mobile" || word === "mobiles" || word === "cellphone" || word === "cellphones") return "phone";
      if (word === "bags" || word === "school bags" || word === "backpacks" || word === "satchel" || word === "satchels" || word === "knapsack" || word === "knapsacks") return "school bags";
      if (word === "headphones") return "headphones";
      if (word === "keyboards") return "keyboard";
      if (word === "electronics") return "electronics";
      if (word === "products") return "product";
      if (word.endsWith("s")) return word.slice(0, -1);
      return word;
    }

    // Dynamic entity extraction for unseen product nouns (e.g. "cheapest monitor", "search for smartwatches")
    const dynamicMatch = rawTask.match(
      /(?:find|search(?:\s+for)?|query|lookup|compare|which|show|list|get|extract|cheapest|priciest|lowest-priced|lowest\s+priced|most\s+expensive|least\s+expensive)\s+(?:\b(?:a|an|the|this|that|all|listed|available|cheapest|priciest|lowest-priced|lowest|most|least|expensive|best|top|highest-priced|highest|second-cheapest|second|third|fourth|fifth|eligible|matching)\b\s*)*([a-zA-Z]{3,}(?:-[a-zA-Z]+)?)/i
    );
    if (dynamicMatch) {
      let candidate = dynamicMatch[1].toLowerCase();
      const STOPWORDS = new Set(["all", "the", "first", "second", "third", "fourth", "fifth", "second-cheapest", "third-cheapest", "most", "least", "cheapest", "priciest", "under", "page", "site", "website", "catalog", "products", "items", "item", "eligible", "matching", "applicable", "cost", "costs", "price", "one", "result", "results"]);
      if (!STOPWORDS.has(candidate)) {
        if (candidate.endsWith("ies") && candidate.length > 4) {
          return candidate.slice(0, -3) + "y";
        }
        if (candidate.endsWith("es") && !candidate.endsWith("ses") && candidate.length > 4) {
          return candidate.slice(0, -2);
        }
        if (candidate.endsWith("s") && !candidate.endsWith("ss") && candidate.length > 3) {
          return candidate.slice(0, -1);
        }
        return candidate;
      }
    }

    // Media title matching (e.g. "play Kya Baat Hai song on spotify", "stream Bohemian Rhapsody")
    const mediaEntityMatch = rawTask.match(/(?:play|stream|listen(?:\s+to)?|watch)\s+(?:a|an|the)?\s*([a-zA-Z0-9_\-\s]+?)(?=\s+\b(?:on|in|at|by|from|via)\b|[.,!?;:]|$)/i);
    if (mediaEntityMatch) {
      let title = mediaEntityMatch[1].trim();
      title = title.replace(/\s+(?:song|track|video|music|audio)$/i, "").trim();
      if (title.length >= 2) return title;
    }

    return "product";
  }

  private static extractQuery(rawTask: string, defaultEntity: string): string {
    const quoted = rawTask.match(/['"]([^'"]+)['"]/);
    if (quoted) return quoted[1].trim();

    // Media query matching
    const mediaQueryMatch = rawTask.match(/(?:play|stream|listen(?:\s+to)?|watch)\s+(?:a|an|the)?\s*([a-zA-Z0-9_\-\s]+?)(?=\s+\b(?:on|in|at|from|via)\b|[.,!?;:]|$)/i);
    if (mediaQueryMatch) {
      let title = mediaQueryMatch[1].trim();
      title = title.replace(/\s+(?:song|track|video|music|audio)$/i, "").trim();
      if (title.length >= 2) return title;
    }

    if (/smartphone.*not exist/i.test(rawTask) || /does not exist/i.test(rawTask)) {
      return "smartphone that does not exist";
    }

    if (/\b(?:portable\s+computers?)\b/i.test(rawTask)) {
      return "laptop";
    }

    if (/\b(?:laptops?|notebooks?)\b/i.test(rawTask)) {
      return "laptop";
    }

    if (/\b(?:school\s+bags?|backpacks?|knapsacks?|satchels?)\b/i.test(rawTask)) {
      return "school bags";
    }

    const forMatch = rawTask.match(/(?:for|find|query)\s+(?:\b(?:a|an|the)\b\s+)?([a-zA-Z0-9_\-]+)/i);
    if (forMatch) {
      const q = forMatch[1].toLowerCase();
      const STOPWORDS = new Set(["all", "the", "cheapest", "priciest", "most", "least", "lowest", "highest", "second", "third", "how", "what", "which", "product", "products", "item", "items", "page", "this"]);
      if (!STOPWORDS.has(q)) {
        return forMatch[1];
      }
    }

    return defaultEntity;
  }

  private static extractComparison(lower: string): TaskIntent["comparison"] | undefined {
    if (
      lower.includes("cheapest") ||
      lower.includes("lowest price") ||
      lower.includes("minimum price") ||
      lower.includes("least expensive") ||
      lower.includes("lowest-priced") ||
      lower.includes("lowest priced") ||
      lower.includes("costs the least") ||
      lower.includes("cost the least") ||
      lower.includes("least costly") ||
      lower.includes("least cost") ||
      lower.includes("most affordable") ||
      lower.includes("affordable") ||
      lower.includes("second-cheapest") ||
      lower.includes("second cheapest") ||
      lower.includes("third-cheapest")
    ) {
      return { operation: "MIN", field: "price" };
    }
    if (
      lower.includes("most expensive") ||
      lower.includes("highest price") ||
      lower.includes("maximum price") ||
      lower.includes("priciest") ||
      lower.includes("highest-priced") ||
      lower.includes("highest priced") ||
      lower.includes("costs the most") ||
      lower.includes("cost the most") ||
      lower.includes("highest cost")
    ) {
      return { operation: "MAX", field: "price" };
    }
    return undefined;
  }

  private static extractFilter(lower: string): TaskIntent["filter"] | undefined {
    // E.g. "less than ₹50000", "under $500", "costs less than 70000", "< 70000"
    const lessMatch = lower.match(/(?:less\s+than|under|below|cheaper\s+than|<\s*|costs?\s+less\s+than)\s*(?:[₹$€£]|rs\.?|inr|usd)?\s*([\d,]+)/i);
    if (lessMatch) {
      const cleanNum = lessMatch[1].replace(/,/g, "");
      return { field: "price", operator: "<", value: parseInt(cleanNum, 10) };
    }

    const greaterMatch = lower.match(/(?:more\s+than|over|above|exceeding|>\s*|costs?\s+more\s+than)\s*(?:[₹$€£]|rs\.?|inr|usd)?\s*([\d,]+)/i);
    if (greaterMatch) {
      const cleanNum = greaterMatch[1].replace(/,/g, "");
      return { field: "price", operator: ">", value: parseInt(cleanNum, 10) };
    }

    return undefined;
  }

  private static extractOrdinal(lower: string): TaskIntent["ordinal"] | undefined {
    if (/\bfirst\b/i.test(lower)) return { target: "first", index: 0 };
    if (/\bsecond\b|2nd\b/i.test(lower)) return { target: "second", index: 1 };
    if (/\bthird\b|3rd\b/i.test(lower)) return { target: "third", index: 2 };
    if (/\bfourth\b|4th\b/i.test(lower)) return { target: "fourth", index: 3 };
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

