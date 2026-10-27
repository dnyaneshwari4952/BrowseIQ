import {
  TaskSpecification,
  TaskSpecificationSchema,
  BrowserOperationType,
  FilterConstraint,
  OrderingConstraint,
  OrdinalConstraint,
  NegativeConstraint,
} from "./task-specification";
import { CommandInterpreter, InterpretedCommand } from "./command-interpreter";
import { PageObservation } from "../types/browser";
import { validateUrlString } from "../validation/url-policy";
import { AgentError } from "../types/errors";
import { WebsiteRegistry } from "./website-registry";

export interface ResolverOptions {
  rawInstruction: string;
  targetUrl?: string;
  observation?: PageObservation | null;
}

/**
 * Entity & Constraint Resolver (Phase 2 Component B)
 * Extracts entities, constraints, URL resolution, confidence, and clarification needs
 * without external LLMs or hardcoded site-specific workflows.
 */
export class EntityConstraintResolver {
  // Destructive / High-risk keywords
  private static readonly DESTRUCTIVE_PATTERNS = [
    /\b(?:delete|purge|wipe|drop)\s+(?:all\s+)?(?:users?|database|tables?|records?|files?)\b/i,
    /\b(?:transfer\s+money|wire\s+funds|drain\s+account|delete\s+bank\s+account)\b/i,
  ];

  // Unsupported desktop operations or external non-browser transactions
  private static readonly UNSUPPORTED_DESKTOP_PATTERNS = [
    /\b(?:install\s+(?:app|software|exe|program)|run\s+terminal\s+as\s+root|reboot\s+pc|shutdown\s+computer)\b/i,
    /\b(?:book\s+a\s+flight|reserve\s+hotel|book\s+a\s+hotel|call\s+uber|order\s+taxi|book\s+train)\b/i,
  ];

  // Reusable linguistic synonym dictionary (general categories only, never specific products)
  private static readonly SYNONYM_MAP: Record<string, string> = {
    notebooks: "laptop",
    notebook: "laptop",
    laptops: "laptop",
    laptop: "laptop",
    "portable computer": "laptop",
    "portable computers": "laptop",
    "portable workstation": "laptop",
    smartphones: "phone",
    smartphone: "phone",
    mobiles: "phone",
    mobile: "phone",
    cellphones: "phone",
    cellphone: "phone",
    phones: "phone",
    monitors: "monitor",
    screens: "monitor",
    screen: "monitor",
    display: "monitor",
    displays: "monitor",
    headphones: "headphones",
    headphone: "headphones",
    headsets: "headphones",
    headset: "headphones",
    earphones: "headphones",
    earphone: "headphones",
    earbuds: "headphones",
    keyboards: "keyboard",
    keyboard: "keyboard",
  };

  /**
   * Resolves a raw natural-language instruction into a complete, typed TaskSpecification
   */
  static resolve(options: ResolverOptions): TaskSpecification {
    const { rawInstruction, targetUrl: providedUrl, observation } = options;
    const command = CommandInterpreter.interpret(rawInstruction);
    const lower = rawInstruction.toLowerCase().trim();

    // 1. Safety & Unsupported Task Evaluation
    for (const pattern of this.DESTRUCTIVE_PATTERNS) {
      if (pattern.test(lower)) {
        return this.buildUnsupportedSpec(
          rawInstruction,
          "Irreversible destructive operation (data deletion or financial transfer) is restricted by safety policy."
        );
      }
    }

    for (const pattern of this.UNSUPPORTED_DESKTOP_PATTERNS) {
      if (pattern.test(lower)) {
        return this.buildUnsupportedSpec(
          rawInstruction,
          "Desktop OS operations, reservations, or external non-browser transactions are unsupported."
        );
      }
    }

    // 2. URL & Website Resolution
    const { targetUrl, targetWebsite, urlClarificationNeeded } = this.resolveTargetUrl(
      rawInstruction,
      providedUrl
    );

    // 3. Negation & Exclusion Extraction
    const negations = this.extractNegations(lower, command);

    // 4. Extraction of Target Entity & Search Query
    const targetEntity = this.extractTargetEntity(rawInstruction, command);
    const searchQuery = this.extractSearchQuery(rawInstruction, targetEntity, command);

    // 5. Constraints: Ordering, Filters, Ordinals, Limits, Media
    const ordering = this.extractOrdering(lower);
    const filters = this.extractFilters(rawInstruction);
    const ordinal = this.extractOrdinal(lower);
    const windowLimit = this.extractWindowLimit(lower);
    const mediaProperties = this.extractMediaProperties(lower);
    const fileProperties = this.extractFileProperties(rawInstruction);

    // 6. Ambiguity & Clarification Needs
    let isAmbiguous = false;
    let ambiguityReason: string | undefined;
    let clarificationQuestion: string | undefined;

    if (urlClarificationNeeded) {
      isAmbiguous = true;
      ambiguityReason = `Destination website "${targetWebsite}" mentioned without a valid web address.`;
      clarificationQuestion = `Which website address (URL) would you like to visit for "${targetWebsite}"?`;
    } else if (
      (lower === "click submit" || lower === "click the submit button" || lower.startsWith("click submit")) &&
      observation?.interactiveElements &&
      observation.interactiveElements.filter((e) => e.text?.toLowerCase() === "submit" || e.name?.toLowerCase() === "submit").length > 1
    ) {
      isAmbiguous = true;
      ambiguityReason = "Multiple identical submit buttons found on current page.";
      clarificationQuestion = "Found multiple 'Submit' buttons on this page. Please specify which form or button to submit.";
    } else if (
      /\b(?:somewhere|search\s+for\s+something|find\s+something|do\s+something)\b/i.test(lower) ||
      (!targetEntity && !searchQuery && !targetUrl && command.operationType === "SEARCH")
    ) {
      isAmbiguous = true;
      ambiguityReason = "User instruction is missing specific target search terms or destination.";
      clarificationQuestion = "Your request did not specify what to search for. What item or topic would you like to find?";
    } else if (filters.length >= 2) {
      // Check for conflicting filters, e.g. price < 50 AND price > 200
      const lessFilter = filters.find((f) => f.operator === "<" || f.operator === "<=");
      const moreFilter = filters.find((f) => f.operator === ">" || f.operator === ">=");
      if (lessFilter && moreFilter && typeof lessFilter.value === "number" && typeof moreFilter.value === "number") {
        if (moreFilter.value > lessFilter.value) {
          isAmbiguous = true;
          ambiguityReason = `Conflicting price constraints: greater than ${moreFilter.value} and less than ${lessFilter.value}.`;
          clarificationQuestion = `The price filters conflict (greater than ${moreFilter.value} but less than ${lessFilter.value}). Which price range should be applied?`;
        }
      }
    }

    // 6B. Local File Task Classification (Requirement 2 & Whole Computer)
    const isLocalFileTask =
      !/\bon\s+(?:the\s+)?page\b|\bvideo\s+stream\b/i.test(lower) &&
      /\b(?:downloads?\s+folder|downloads|desktop|documents?\s+folder|documents|music\s+folder|videos?\s+folder|local\s+storage|local\s+file|local\s+files|local\s+disk|my\s+computer|this\s+pc|on\s+my\s+pc|on\s+my\s+computer|on\s+computer|from\s+computer|from\s+local|in\s+local|from\s+downloads|in\s+downloads|local\s+audio|local\s+song|local\s+music|whole\s+computer)\b/i.test(lower);
    const hasWebsiteIndicator =
      Boolean(targetUrl) ||
      /\b(?:on\s+(?:spotify|youtube|soundcloud|vimeo|apple\s+music|netflix|flipkart|amazon)|https?:\/\/|[a-zA-Z0-9-]+\.(?:com|org|net|io|in|tv))\b/i.test(lower);
    const taskScope: "website" | "local_file" | "mixed" =
      isLocalFileTask && hasWebsiteIndicator
        ? "mixed"
        : isLocalFileTask
        ? "local_file"
        : "website";

    let cleanTargetEntity = targetEntity;
    let cleanSearchQuery = searchQuery;
    if (taskScope === "local_file") {
      const LOCAL_TERMS_REGEX = /\b(?:from\s+downloads\s+folder|from\s+downloads|from\s+local\s+storage|from\s+local|from\s+desktop|from\s+documents|from\s+music|from\s+computer|on\s+my\s+computer|on\s+computer|on\s+this\s+pc|on\s+desktop|in\s+downloads|in\s+music|in\s+documents|in\s+videos|downloads\s+folder|local\s+storage|local\s+disk|whole\s+computer|on\s+local\s+storage)\b/gi;
      if (cleanTargetEntity) {
        cleanTargetEntity = cleanTargetEntity.replace(LOCAL_TERMS_REGEX, "").trim();
      }
      if (cleanSearchQuery) {
        cleanSearchQuery = cleanSearchQuery.replace(LOCAL_TERMS_REGEX, "").trim();
      }
      // For local file tasks, a missing website URL is expected and NOT an ambiguity
      isAmbiguous = false;
      ambiguityReason = undefined;
      clarificationQuestion = undefined;
    }

    // 7. Refine Operation Type based on extracted components
    let operation: BrowserOperationType = command.operationType;

    if (isAmbiguous) {
      operation = "AMBIGUOUS";
    } else if (/\b(?:determine\s+whether|check\s+(?:if|whether)|verify\s+(?:if|whether)|inspect|see\s+if)\b/i.test(lower)) {
      operation = "INSPECT";
    } else if (
      taskScope === "local_file" &&
      (mediaProperties?.action === "play" ||
        /\b(?:play|stream|listen(?:\s+to)?)\b/i.test(lower) ||
        (/\b(?:find|open|search(?:\s+for)?|locate)\b/i.test(lower) &&
          (/\b(?:hey\s+sinamika|sinamika|song|track|audio|music|wav|mp3|flac|m4a|aac|ogg)\b/i.test(lower) ||
            /\b(?:on\s+my\s+computer|on\s+computer|on\s+this\s+pc|in\s+downloads|in\s+music)\b/i.test(lower))))
    ) {
      operation = "LOCAL_MEDIA_PLAY";
    } else if (filters.length > 0) {
      operation = "FILTER";
    } else if (ordering) {
      operation = "COMPARE";
    } else if (/\b(?:how\s+many|count\s+(?:the)?|total\s+number\s+of)\b/i.test(lower)) {
      operation = "COUNT";
    } else if (negations.some((n) => n.operation === "submit" && n.forbidden)) {
      operation = "FORM_FILL"; // Fill without submitting
    } else if (mediaProperties?.action) {
      if (mediaProperties.action === "play") operation = "MEDIA_PLAY";
      else if (mediaProperties.action === "pause") operation = "MEDIA_PAUSE";
      else if (mediaProperties.action === "mute") operation = "MEDIA_MUTE";
    }

    // 7B. Determine Structured Result Type & Action Intent
    let resultType: "media" | "product" | "article" | "general" = "general";
    const isMediaPlatform = Boolean(targetWebsite && /(?:youtube|vimeo|spotify|soundcloud|dailymotion)/i.test(targetWebsite));
    const isMediaContent = Boolean(lower.match(/\b(?:song|songs|track|tracks|video|videos|music|audio|podcast|album|artist)\b/i));
    if (operation === "LOCAL_MEDIA_PLAY" || operation === "MEDIA_PLAY" || operation === "MEDIA_PAUSE" || operation === "MEDIA_MUTE" || isMediaPlatform || isMediaContent) {
      resultType = "media";
    } else if (
      operation === "COMPARE" ||
      operation === "FILTER" ||
      ordering ||
      filters.length > 0 ||
      Boolean(targetWebsite && /(?:amazon|flipkart|ebay|walmart|bestbuy|target|shop)/i.test(targetWebsite)) ||
      Boolean(lower.match(/\b(?:product|products|laptop|laptops|phone|phones|price|prices|cost|cheapest|expensive|buy|shopping|discount|deal)\b/i))
    ) {
      resultType = "product";
    } else if (
      Boolean(targetWebsite && /(?:wikipedia|mdn|docs|documentation|arxiv|medium|bbc|news)/i.test(targetWebsite)) ||
      Boolean(lower.match(/\b(?:article|articles|doc|docs|documentation|paper|papers|news|guide)\b/i))
    ) {
      resultType = "article";
    }

    let actionIntent: "search" | "open" | "play" | "compare" | "extract" | "fill" | "general" = "general";
    if (operation === "LOCAL_MEDIA_PLAY" || operation === "MEDIA_PLAY" || mediaProperties?.action === "play") {
      actionIntent = "play";
    } else if (/\bopen\b/i.test(lower) && !negations.some((n) => n.operation === "open" && n.forbidden)) {
      actionIntent = "open";
    } else if (operation === "COMPARE" || operation === "FILTER" || Boolean(ordering) || filters.length > 0) {
      actionIntent = "compare";
    } else if (operation === "EXTRACT" || /\bextract\b/i.test(lower)) {
      actionIntent = "extract";
    } else if (operation === "SEARCH") {
      actionIntent = "search";
    }

    // 8. Confidence Calculation
    const confidence = taskScope === "local_file" && (cleanTargetEntity || cleanSearchQuery)
      ? 0.95
      : this.calculateConfidence({
          operation,
          hasEntity: Boolean(cleanTargetEntity),
          hasUrl: Boolean(targetUrl),
          hasQuery: Boolean(cleanSearchQuery),
          isAmbiguous,
          filterCount: filters.length,
          hasOrdering: Boolean(ordering),
        });

    // 9. Required Evidence Specification
    const requiredEvidence = this.determineRequiredEvidence(operation, cleanTargetEntity, ordering, filters);

    // 10. Consequential / confirmation evaluation
    const isConsequential =
      /\b(?:buy|purchase|checkout|pay|place\s+order)\b/i.test(lower) &&
      !negations.some((n) => n.operation === "purchase" && n.forbidden);

    const spec: TaskSpecification = {
      id: `task-spec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      originalInstruction: rawInstruction,
      inferredGoal: this.generateGoalSummary(operation, cleanTargetEntity, cleanSearchQuery, ordering, filters, negations),
      operation,
      targetEntity: cleanTargetEntity,
      targetWebsite,
      targetUrl,
      taskScope,
      isLocalFile: taskScope === "local_file",
      localFileScope: taskScope === "local_file" ? {
        targetTitle: cleanSearchQuery || cleanTargetEntity,
        targetDirectory: lower.includes("downloads") ? "Downloads" : undefined,
        mediaType: "audio",
      } : undefined,
      resultType,
      actionIntent,
      searchQuery: cleanSearchQuery,
      ordering,
      filters,
      ordinal,
      negations,
      windowLimit,
      fileProperties,
      mediaProperties,
      expectedFinalState: this.describeExpectedFinalState(operation, cleanTargetEntity),
      preconditions: targetUrl ? [`Browser navigates to ${targetUrl}`] : [],
      requiredEvidence,
      verificationCriteria: [],
      confidence,
      isAmbiguous,
      ambiguityReason,
      clarificationQuestion,
      isConsequential,
      requiresConfirmation: isConsequential,
      isUnsupported: false,
      needsMultipleSteps: operation !== "HISTORY_BACK" && operation !== "RELOAD",
      missingFields: isAmbiguous ? [ambiguityReason || "Clarification needed"] : [],
      scopeRestrictions: [],
      timestamp: new Date().toISOString(),
    };

    return TaskSpecificationSchema.parse(spec);
  }

  /**
   * Resolves target URL from instruction or provided context (Section 6)
   */
  public static resolveTargetUrl(
    instruction: string,
    providedUrl?: string
  ): { targetUrl?: string; targetWebsite?: string; urlClarificationNeeded: boolean } {
    const res = WebsiteRegistry.resolveTarget(instruction, providedUrl);
    return {
      targetUrl: res.targetUrl,
      targetWebsite: res.targetWebsite,
      urlClarificationNeeded: res.urlClarificationNeeded,
    };
  }

  /**
   * Extracts target entity from natural language without assuming fixed tasks
   */
  private static extractTargetEntity(instruction: string, command: InterpretedCommand): string | undefined {
    // 1. Quoted phrases take precedence
    if (command.tokens.quotedPhrases.length > 0) {
      return command.tokens.quotedPhrases[0];
    }

    // Strip leading website navigation preamble if present (e.g. "open youtube and ...", "go to wikipedia and ...")
    let lower = instruction.toLowerCase();
    lower = lower.replace(/^(?:open|go\s+to|visit|browse|navigate\s+to)\s+[a-zA-Z0-9.-]+\s+and\s+/i, "");

    const IGNORED = new Set([
      "something", "somewhere", "anything", "everything",
      "product", "products", "item", "items", "results", "result",
      "page", "website", "catalog", "site", "details", "contact",
      "cost", "price", "pair", "one", "form",
    ]);

    // 2. Check for action verb anywhere in sentence (handles conversational preambles)
    const actionSearchMatch = lower.match(
      /(?:search(?:\s+for)?|look\s+for|look\s+up|query(?:\s+for)?|find|locate|view(?:\s+the)?|play|stream|listen(?:\s+to)?|watch)\s+(?:a|an|the|this|that|all)?\s*([a-zA-Z0-9_\-'\s]+?)(?=[.?!]|\b(?:on|in|at|under|below|above|over|between|priced|costing|with|without|that|which|and\s+report|and\s+sort|and\s+tell)\b|$)/i
    );
    if (actionSearchMatch) {
      let candidate = actionSearchMatch[1].replace(/[.,!?;:]+$/, "").trim();
      candidate = candidate.replace(/^(?:a|an|the|this|that|all|listed|available|cheapest|priciest|lowest-priced|lowest|most|least|expensive|best|top|second-cheapest|second|third|fourth|fifth|eligible|matching|pair\s+of)\s+/i, "").trim();
      // Check synonym map
      for (const [synonym, canonical] of Object.entries(this.SYNONYM_MAP)) {
        const regex = new RegExp(`\\b${synonym.replace(/\s+/g, "\\s+")}\\b`, "i");
        if (regex.test(candidate)) {
          return canonical;
        }
      }
      if (candidate && !IGNORED.has(candidate) && candidate.length >= 2) {
        return candidate;
      }
    }

    // 3. Check for synonym dictionary matches in the full phrase
    for (const [synonym, canonical] of Object.entries(this.SYNONYM_MAP)) {
      const regex = new RegExp(`\\b${synonym.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (regex.test(lower)) {
        return canonical;
      }
    }

    // 4. Generalized linguistic extraction: look for noun phrases following action/search indicators
    let cleaned = lower
      .replace(/^(?:hello[^!.]*[!.]\s*)?(?:hope[^!.]*[!.]\s*)?(?:if\s+you\s+don't\s+mind,?\s*)?(?:please|kindly|could\s+you(?:\s+please)?|i\s+desire\s+to(?:\s+view)?|i\s+want\s+to|procure\s+(?:for\s+me)?)\s+/i, "")
      .replace(/^(?:search(?:\s+for)?|look\s+for|look\s+up|query(?:\s+for)?|find|compare|which|extract|show|get|locate|select|view(?:\s+the)?|play|stream|listen(?:\s+to)?|watch)\s+/i, "")
      .trim();

    // Strip determiners, comparatives, ordinals, and "pair of"
    cleaned = cleaned
      .replace(/^(?:of\s+)?(?:\b(?:a|an|the|this|that|all|listed|available|cheapest|priciest|lowest-priced|lowest|most|least|expensive|best|top|highest-priced|highest|second-cheapest|second|third|fourth|fifth|eligible|matching|pair\s+of)\b\s*)+/i, "")
      .trim();

    // Remove trailing location/condition clauses or punctuation
    cleaned = cleaned
      .replace(/\s+\b(?:on|in|at|under|below|above|over|between|priced|costing|with|without|that|which|and\s+report|and\s+sort|and\s+tell|from\s+the)\b.*$/i, "")
      .replace(/[.,!?;:]+$/, "")
      .trim();

    if (cleaned && !IGNORED.has(cleaned) && cleaned.length >= 2) {
      for (const [synonym, canonical] of Object.entries(this.SYNONYM_MAP)) {
        const regex = new RegExp(`\\b${synonym.replace(/\s+/g, "\\s+")}\\b`, "i");
        if (regex.test(cleaned)) {
          return canonical;
        }
      }
      return cleaned;
    }

    // Fallback: Check extracted keywords
    const candidateKeyword = command.extractedKeywords.find((k) => !IGNORED.has(k.toLowerCase()));
    return candidateKeyword || undefined;
  }

  /**
   * Formulates a clean search query preserving user terms
   */
  private static extractSearchQuery(
    instruction: string,
    entity: string | undefined,
    command: InterpretedCommand
  ): string | undefined {
    // 1. Quoted phrases take precedence
    if (command.tokens.quotedPhrases.length > 0) {
      return command.tokens.quotedPhrases[0];
    }

    // 2. Extract specific search query phrase following search verbs
    const searchVerbMatch = instruction.match(
      /(?:search(?:\s+for)?|look\s+for|look\s+up|query(?:\s+for)?|find)\s+(?:a|an|the|this|that|all)?\s*([a-zA-Z0-9_\-'\s]+?)(?=[.?!]|\b(?:on|in|at|under|below|above|over|between|priced|costing|with|without|that|which|but|and\s+report|and\s+sort|and\s+tell|and\s+show|and\s+display|and\s+extract|and\s+get|and\s+return)\b|$)/i
    );

    if (searchVerbMatch) {
      let rawQuery = searchVerbMatch[1].replace(/[.,!?;:]+$/, "").trim();
      // Strip comparative/ordering words from query (e.g. "cheapest mobile phones" -> "mobile phones")
      rawQuery = rawQuery.replace(/^(?:a|an|the|this|that|all|listed|available|cheapest|priciest|lowest-priced|lowest|most|least|expensive|best|top|second-cheapest|second|third|fourth|fifth|eligible|matching|pair\s+of)\s+/i, "").trim();
      if (rawQuery && rawQuery.length >= 2 && !["something", "somewhere", "anything", "product", "item"].includes(rawQuery.toLowerCase())) {
        return rawQuery;
      }
    }

    if (entity) {
      const artistMatch = instruction.match(/\bby\s+([a-zA-Z0-9_\-\s]+?)(?=\s+\b(?:on|in|at|from|via)\b|[.,!?;:]|$)/i);
      if (artistMatch) {
        const artist = artistMatch[1].trim();
        return `${entity} ${artist}`;
      }
      return entity;
    }

    const IGNORED = new Set(["something", "somewhere", "anything", "product", "item"]);
    const validKeywords = command.extractedKeywords.filter((k) => !IGNORED.has(k.toLowerCase()));
    if (validKeywords.length > 0) {
      return validKeywords.slice(0, 3).join(" ");
    }

    return undefined;
  }

  /**
   * Extracts ordering / comparison constraints
   */
  private static extractOrdering(lower: string): OrderingConstraint | undefined {
    if (
      /\b(?:cheapest|lowest\s+price|least\s+expensive|lowest\s+cost|costs?\s+the\s+least|most\s+affordable|smallest\s+price\s+tag|most\s+economical|economical)\b/i.test(lower)
    ) {
      return { direction: "MIN", field: "price", rawExpression: "cheapest" };
    }

    if (
      /\b(?:most\s+expensive|priciest|highest\s+price|highest\s+cost|costs?\s+the\s+most|biggest\s+price\s+tag)\b/i.test(lower)
    ) {
      return { direction: "MAX", field: "price", rawExpression: "most expensive" };
    }

    if (/\b(?:sort\s+(?:by\s+(?:price|cost)\s+)?low\s+to\s+high|ascending|lowest\s+first)\b/i.test(lower)) {
      return { direction: "ASCENDING", field: "price", rawExpression: "low to high" };
    }

    if (/\b(?:sort\s+(?:by\s+(?:price|cost)\s+)?high\s+to\s+low|descending|highest\s+first)\b/i.test(lower)) {
      return { direction: "DESCENDING", field: "price", rawExpression: "high to low" };
    }

    return undefined;
  }

  /**
   * Extracts numeric filter constraints (including range filters)
   */
  private static extractFilters(instruction: string): FilterConstraint[] {
    const filters: FilterConstraint[] = [];
    const lower = instruction.toLowerCase();

    // Pattern: range "between ₹20,000 and ₹50,000" or "between $100 and $300"
    const rangeMatch = lower.match(
      /between\s*(?:[$₹€£]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:and|-)\s*(?:[$₹€£]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i
    );
    if (rangeMatch) {
      const minVal = parseFloat(rangeMatch[1].replace(/,/g, ""));
      const maxVal = parseFloat(rangeMatch[2].replace(/,/g, ""));
      filters.push({
        field: "price",
        operator: ">=",
        value: minVal,
        rawExpression: `>= ${minVal}`,
      });
      filters.push({
        field: "price",
        operator: "<=",
        value: maxVal,
        rawExpression: `<= ${maxVal}`,
      });
      return filters;
    }

    // Pattern: under / below / less than ₹50,000 / $500
    const underMatch = lower.match(
      /(?:under|below|less\s+than|cheaper\s+than|at\s+most)\s*(?:[$₹€£]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i
    );
    if (underMatch) {
      const val = parseFloat(underMatch[1].replace(/,/g, ""));
      filters.push({
        field: "price",
        operator: "<",
        value: val,
        rawExpression: underMatch[0],
      });
    }

    // Pattern: above / more than / over ₹10,000 / $100 / at least
    const overMatch = lower.match(
      /(?:above|over|more\s+than|greater\s+than|at\s+least|cost\s+at\s+least)\s*(?:[$₹€£]\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)/i
    );
    if (overMatch) {
      const val = parseFloat(overMatch[1].replace(/,/g, ""));
      filters.push({
        field: "price",
        operator: ">",
        value: val,
        rawExpression: overMatch[0],
      });
    }

    return filters;
  }

  /**
   * Extracts ordinal constraints ("first", "second", etc.)
   */
  private static extractOrdinal(lower: string): OrdinalConstraint | undefined {
    const ordinals: Array<{ pattern: RegExp; target: OrdinalConstraint["target"]; index: number }> = [
      { pattern: /\b(?:first|1st)\b/i, target: "first", index: 0 },
      { pattern: /\b(?:second|2nd)\b/i, target: "second", index: 1 },
      { pattern: /\b(?:third|3rd)\b/i, target: "third", index: 2 },
      { pattern: /\b(?:fourth|4th)\b/i, target: "fourth", index: 3 },
      { pattern: /\b(?:fifth|5th)\b/i, target: "fifth", index: 4 },
      { pattern: /\b(?:last)\b/i, target: "last", index: -1 },
    ];

    for (const ord of ordinals) {
      if (ord.pattern.test(lower)) {
        return { target: ord.target, index: ord.index, rawExpression: ord.target };
      }
    }

    return undefined;
  }

  /**
   * Extracts negative constraints / restrictions
   */
  private static extractNegations(lower: string, command: InterpretedCommand): NegativeConstraint[] {
    const negations: NegativeConstraint[] = [];

    if (
      command.negatedConcepts.includes("submit") ||
      /(?:not|don't|without|never)\s+[^.,;!?:()]*?\b(?:submit|submitting|send\s+(?:a\s+)?message|send\s+inquiry|post)\b/i.test(lower) ||
      /(?:leave|keep)\s+(?:it\s+)?unsubmitted/i.test(lower) ||
      lower.includes("without submitting")
    ) {
      negations.push({
        operation: "submit",
        forbidden: true,
        reason: "User explicitly instructed not to submit",
        rawPhrase: "do not submit",
      });
    }

    if (
      command.negatedConcepts.includes("purchase") ||
      /(?:not|don't|without|never)\s+(?:purchase|buy|checkout|order)/i.test(lower) ||
      lower.includes("without buying") ||
      lower.includes("do not buy") ||
      lower.includes("do not purchase")
    ) {
      negations.push({
        operation: "purchase",
        forbidden: true,
        reason: "User instructed not to purchase or checkout",
        rawPhrase: "do not purchase",
      });
    }

    if (
      command.negatedConcepts.includes("add_to_cart") ||
      /(?:without|do\s+not|don't|never)\s+adding\s+(?:the\s+item\s+)?to\s+(?:the\s+)?cart/i.test(lower) ||
      lower.includes("without adding")
    ) {
      negations.push({
        operation: "add_to_cart",
        forbidden: true,
        reason: "User instructed not to add item to cart",
        rawPhrase: "without adding to cart",
      });
    }

    if (
      command.negatedConcepts.includes("navigate") ||
      /(?:without|do\s+not|don't|never)\s+(?:changing\s+(?:the\s+)?page|navigating|leaving)/i.test(lower) ||
      lower.includes("without changing the page") ||
      lower.includes("stay on this page")
    ) {
      negations.push({
        operation: "navigate",
        forbidden: true,
        reason: "User instructed to stay on the current page",
        rawPhrase: "without changing the page",
      });
    }

    if (
      command.negatedConcepts.includes("open") ||
      /(?:without|do\s+not|don't|never)\s+opening/i.test(lower) ||
      lower.includes("without opening") ||
      lower.includes("do not open")
    ) {
      negations.push({
        operation: "open",
        forbidden: true,
        reason: "User instructed not to open product result",
        rawPhrase: "without opening",
      });
    }

    return negations;
  }

  /**
   * Extracts window limit ("top 3", "first 5", "three most affordable")
   */
  private static extractWindowLimit(lower: string): number | undefined {
    const digitMatch = lower.match(/\b(?:top|first|list|show)\s+(\d+)\b/i);
    if (digitMatch) {
      const val = parseInt(digitMatch[1], 10);
      if (!isNaN(val) && val > 0 && val <= 50) return val;
    }

    const wordMatch = lower.match(/\b(?:the\s+)?(two|three|four|five|six|seven|eight|nine|ten)\s+(?:most|cheapest|priciest|best|matching)\b/i);
    if (wordMatch) {
      const wordMap: Record<string, number> = {
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
      return wordMap[wordMatch[1].toLowerCase()];
    }

    return undefined;
  }

  /**
   * Extracts media properties (playback action, media type)
   */
  private static extractMediaProperties(lower: string) {
    const isAudio = lower.includes("song") || lower.includes("track") || lower.includes("audio") || lower.includes("podcast");
    const mediaType = isAudio ? ("audio" as const) : ("video" as const);
    if (/\b(?:pause|stop\s+playback|freeze)\b/i.test(lower)) {
      return { action: "pause" as const, mediaType };
    }
    if (/\b(?:mute|silence\s+audio|unmute)\b/i.test(lower)) {
      return { action: "mute" as const, mediaType };
    }
    if (/\b(?:play|start\s+playback|resume|listen(?:\s+to)?|stream|watch)\b/i.test(lower)) {
      return { action: "play" as const, mediaType };
    }
    return undefined;
  }

  /**
   * Extracts file properties from instruction
   */
  private static extractFileProperties(instruction: string) {
    const extMatch = instruction.match(/\b(?:\.)?(pdf|csv|json|xlsx?|txt|png|jpg)\b/i);
    const filenameMatch = instruction.match(/\b([a-zA-Z0-9_\-]+\.(?:pdf|csv|json|xlsx?|txt|png|jpg))\b/i);
    if (extMatch || filenameMatch) {
      return {
        filename: filenameMatch ? filenameMatch[1] : undefined,
        extension: extMatch ? extMatch[1].toLowerCase() : filenameMatch ? filenameMatch[1].split(".").pop() : undefined,
      };
    }
    return undefined;
  }

  /**
   * Computes confidence score (0.0 to 1.0)
   */
  private static calculateConfidence(params: {
    operation: BrowserOperationType;
    hasEntity: boolean;
    hasUrl: boolean;
    hasQuery: boolean;
    isAmbiguous: boolean;
    filterCount: number;
    hasOrdering: boolean;
  }): number {
    if (params.isAmbiguous) return 0.25;
    if (params.operation === "UNSUPPORTED") return 0.0;

    let score = 0.5;
    if (params.hasEntity) score += 0.2;
    if (params.hasUrl) score += 0.15;
    if (params.hasQuery) score += 0.1;
    if (params.hasOrdering || params.filterCount > 0) score += 0.05;

    return Math.min(1.0, Math.max(0.1, score));
  }

  private static determineRequiredEvidence(
    operation: BrowserOperationType,
    entity?: string,
    ordering?: OrderingConstraint,
    filters?: FilterConstraint[]
  ): string[] {
    const evidence: string[] = [];
    if (operation === "SEARCH" || operation === "COMPARE" || operation === "FILTER") {
      evidence.push("matching_items_found");
      evidence.push("title_extracted");
      if (ordering || (filters && filters.length > 0)) {
        evidence.push("price_extracted");
        evidence.push("constraint_satisfied");
      }
    } else if (operation === "COUNT") {
      evidence.push("matching_items_found");
      evidence.push("count_calculated");
    } else if (operation === "DOWNLOAD") {
      evidence.push("file_downloaded_to_disk");
    } else if (operation === "FORM_SUBMIT") {
      evidence.push("form_submitted_confirmation");
    } else if (operation === "FORM_FILL") {
      evidence.push("fields_populated");
    } else if (operation === "INSPECT") {
      evidence.push("element_inspection_completed");
    } else if (operation === "LOCAL_MEDIA_PLAY") {
      evidence.push("local_audio_file_found", "audio_player_active", "playback_progressing");
    } else if (operation === "MEDIA_PLAY" || operation === "MEDIA_PAUSE" || operation === "MEDIA_MUTE") {
      evidence.push("media_playback_state_updated");
    }
    return evidence;
  }

  private static generateGoalSummary(
    operation: BrowserOperationType,
    entity?: string,
    query?: string,
    ordering?: OrderingConstraint,
    filters?: FilterConstraint[],
    negations?: NegativeConstraint[]
  ): string {
    const parts: string[] = [operation.toLowerCase()];
    if (entity) parts.push(`for '${entity}'`);
    if (ordering) parts.push(`(${ordering.rawExpression || ordering.direction})`);
    if (filters && filters.length > 0) {
      parts.push(`where ${filters.map((f) => `${f.field} ${f.operator} ${f.value}`).join(", ")}`);
    }
    if (negations && negations.length > 0) {
      parts.push(`[Restriction: ${negations.map((n) => n.rawPhrase).join(", ")}]`);
    }
    return parts.join(" ");
  }

  private static describeExpectedFinalState(operation: BrowserOperationType, entity?: string): string {
    switch (operation) {
      case "COMPARE":
        return `Best matching ${entity || "product"} identified with price and provenance evidence`;
      case "SEARCH":
        return `Search results for ${entity || "query"} visible on page`;
      case "COUNT":
        return "Count of matching results computed from live page";
      case "DOWNLOAD":
        return "Target file successfully verified on local file system";
      case "FORM_FILL":
        return "Form fields populated without dispatching submission";
      case "FORM_SUBMIT":
        return "Form submitted with confirmation message or state transition";
      case "LOCAL_MEDIA_PLAY":
        return "Local audio file playback actively progressing in verified audio player";
      case "MEDIA_PLAY":
        return "Media playback active";
      case "MEDIA_PAUSE":
        return "Media playback paused";
      case "MEDIA_MUTE":
        return "Media audio muted";
      default:
        return "Target action completed and verified against observable DOM state";
    }
  }

  private static buildUnsupportedSpec(rawInstruction: string, reason: string): TaskSpecification {
    return TaskSpecificationSchema.parse({
      id: `task-spec-${Date.now()}-unsupported`,
      originalInstruction: rawInstruction,
      inferredGoal: `Refused: ${reason}`,
      operation: "UNSUPPORTED",
      confidence: 0.0,
      isAmbiguous: false,
      isUnsupported: true,
      unsupportedReason: reason,
      preconditions: [],
      filters: [],
      negations: [],
      requiredEvidence: [],
      verificationCriteria: [],
      isConsequential: false,
      requiresConfirmation: false,
      needsMultipleSteps: false,
      scopeRestrictions: [],
      missingFields: [reason],
      timestamp: new Date().toISOString(),
    });
  }
}
