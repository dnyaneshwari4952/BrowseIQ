import { BrowserOperationType } from "./task-specification";

export interface NormalizedTokens {
  raw: string;
  normalized: string;
  tokens: string[];
  stemmedTokens: string[];
  phrases: string[];
  numbers: number[];
  currencies: Array<{ symbol: string; value: number }>;
  quotedPhrases: string[];
}

export interface InterpretedCommand {
  primaryVerb: string;
  operationType: BrowserOperationType;
  isQuestion: boolean;
  isNegated: boolean;
  negatedConcepts: string[];
  extractedKeywords: string[];
  normalizedInput: string;
  tokens: NormalizedTokens;
  confidenceScore: number;
}

/**
 * Generalized Command Interpreter (Phase 2 Component A)
 * Built with text normalization, tokenization, stemming, Jaccard/Levenshtein semantic similarity,
 * and generalized linguistic patterns without relying on external hosted LLMs.
 */
export class CommandInterpreter {
  // Common stop words to filter out during tokenization (preserving grammatical/comparison markers)
  private static readonly STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of", "with",
    "by", "from", "as", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "can", "could", "should", "would",
    "will", "shall", "me", "my", "myself", "we", "our", "you", "your", "it", "its",
    "this", "that", "these", "those", "please", "kindly", "here", "there", "just",
    "tell", "give", "help", "want", "like", "need", "could", "would", "able",
  ]);

  // Contraction expansion dictionary
  private static readonly CONTRACTIONS: Array<[RegExp, string]> = [
    [/\bcan't\b/gi, "cannot"],
    [/\bwon't\b/gi, "will not"],
    [/\bdon't\b/gi, "do not"],
    [/\bdoesn't\b/gi, "does not"],
    [/\bdidn't\b/gi, "did not"],
    [/\bshouldn't\b/gi, "should not"],
    [/\bcouldn't\b/gi, "could not"],
    [/\bwouldn't\b/gi, "would not"],
    [/\bisn't\b/gi, "is not"],
    [/\baren't\b/gi, "are not"],
    [/\bwasn't\b/gi, "was not"],
    [/\bweren't\b/gi, "were not"],
    [/\bhasn't\b/gi, "has not"],
    [/\bhaven't\b/gi, "have not"],
    [/\bhadn't\b/gi, "had not"],
    [/\bit's\b/gi, "it is"],
    [/\bwhat's\b/gi, "what is"],
    [/\bthat's\b/gi, "that is"],
    [/\bthere's\b/gi, "there is"],
  ];

  // Specific operations priority order to prevent generic verbs ("go to") from shadowing specific tasks ("go back", "next page")
  private static readonly OPERATION_VOCABULARY: Array<{
    operation: BrowserOperationType;
    canonicalVerb: string;
    patterns: RegExp[];
    coreKeywords: string[];
  }> = [
    // 1. History Navigation (Priority over generic Navigate)
    {
      operation: "HISTORY_BACK",
      canonicalVerb: "back",
      patterns: [
        /\b(?:go\s+back|browser\s+back|navigate\s+back|return\s+to\s+previous\s+page)\b/i,
      ],
      coreKeywords: ["back", "previouspage"],
    },
    {
      operation: "HISTORY_FORWARD",
      canonicalVerb: "forward",
      patterns: [
        /\b(?:go\s+forward|browser\s+forward|navigate\s+forward)\b/i,
      ],
      coreKeywords: ["forward"],
    },
    {
      operation: "RELOAD",
      canonicalVerb: "reload",
      patterns: [
        /\b(?:reload(?:\s+page)?|refresh(?:\s+page)?|re-fetch)\b/i,
      ],
      coreKeywords: ["reload", "refresh"],
    },
    // 2. Pagination (Priority over generic "go to")
    {
      operation: "PAGINATE",
      canonicalVerb: "paginate",
      patterns: [
        /\b(?:next\s+page|previous\s+page|go\s+to\s+the\s+next\s+page|page\s+\d+|paginate|load\s+more\s+results)\b/i,
      ],
      coreKeywords: ["nextpage", "paginate", "loadmore"],
    },
    // 3. Tab Management
    {
      operation: "OPEN_TAB",
      canonicalVerb: "open_tab",
      patterns: [
        /\b(?:open\s+(?:in\s+)?(?:a\s+)?new\s+tab|open\s+tab|new\s+tab|multi-tab|open\s+another\s+tab)\b/i,
      ],
      coreKeywords: ["newtab", "opentab", "tab"],
    },
    {
      operation: "SWITCH_TAB",
      canonicalVerb: "switch_tab",
      patterns: [
        /\b(?:switch\s+to\s+tab|switch\s+tab|change\s+tab|focus\s+tab)\b/i,
      ],
      coreKeywords: ["switchtab", "focustab"],
    },
    {
      operation: "CLOSE_TAB",
      canonicalVerb: "close_tab",
      patterns: [
        /\b(?:close\s+tab|shut\s+tab|kill\s+tab)\b/i,
      ],
      coreKeywords: ["closetab"],
    },
    // 4. Downloads & Uploads
    {
      operation: "DOWNLOAD",
      canonicalVerb: "download",
      patterns: [
        /\b(?:download(?:\s+the)?|save\s+file|fetch\s+file|export\s+(?:pdf|csv|invoice|document|file))\b/i,
      ],
      coreKeywords: ["download", "savefile", "export"],
    },
    {
      operation: "UPLOAD",
      canonicalVerb: "upload",
      patterns: [
        /\b(?:upload(?:\s+file)?|attach\s+file|choose\s+file|browse\s+file\s+to\s+upload)\b/i,
      ],
      coreKeywords: ["upload", "attach"],
    },
    // 5. Media Controls
    {
      operation: "MEDIA_PLAY",
      canonicalVerb: "play",
      patterns: [
        /\b(?:play(?:\s+the)?(?:\s+video|\s+audio|\s+track|\s+song|\s+media)?|start\s+playback|resume\s+video)\b/i,
      ],
      coreKeywords: ["play", "playback", "resume"],
    },
    {
      operation: "MEDIA_PAUSE",
      canonicalVerb: "pause",
      patterns: [
        /\b(?:pause(?:\s+the)?(?:\s+video|\s+audio|\s+playback)?|stop\s+playback|freeze\s+video)\b/i,
      ],
      coreKeywords: ["pause", "stop"],
    },
    {
      operation: "MEDIA_MUTE",
      canonicalVerb: "mute",
      patterns: [
        /\b(?:mute(?:\s+the)?(?:\s+audio|\s+sound|\s+video)?|unmute|silence\s+audio)\b/i,
      ],
      coreKeywords: ["mute", "unmute", "silence"],
    },
    // 6. Dynamic wait
    {
      operation: "WAIT_DYNAMIC",
      canonicalVerb: "wait",
      patterns: [
        /\b(?:wait\s+for(?:\s+delayed|\s+dynamic)?|delayed\s+content|dynamic\s+content|wait\s+until(?:\s+loaded)?)\b/i,
      ],
      coreKeywords: ["wait", "delayed", "dynamic"],
    },
    // 7. Form Operations
    {
      operation: "FORM_SUBMIT",
      canonicalVerb: "submit",
      patterns: [
        /\b(?:submit(?:\s+form|\s+inquiry|\s+details|\s+message)?|send\s+message|send\s+form|dispatch\s+form)\b/i,
      ],
      coreKeywords: ["submit", "sendmessage", "sendform"],
    },
    {
      operation: "FORM_DRAFT",
      canonicalVerb: "draft",
      patterns: [
        /\b(?:save(?:\s+as)?\s+(?:a\s+)?draft|keep(?:\s+as)?\s+(?:a\s+)?draft|draft\s+form)\b/i,
      ],
      coreKeywords: ["draft", "savedraft"],
    },
    {
      operation: "FORM_FILL",
      canonicalVerb: "fill",
      patterns: [
        /\b(?:fill(?:\s+out)?|enter(?:\s+details)?|type\s+into|populate\s+form|complete\s+form|input\s+text)\b/i,
      ],
      coreKeywords: ["fill", "enter", "populate", "type"],
    },
    // 8. General Navigation
    {
      operation: "NAVIGATE",
      canonicalVerb: "navigate",
      patterns: [
        /\b(?:navigate(?:\s+to)?|go\s+to|visit|head\s+to|open\s+(?:url|website|site|page)|browse\s+to|load\s+url)\b/i,
      ],
      coreKeywords: ["navigate", "visit", "browse", "goto", "openurl"],
    },
    // 9. Click / Interaction
    {
      operation: "CLICK",
      canonicalVerb: "click",
      patterns: [
        /\b(?:click(?:\s+on)?|press|tap|hit|select\s+button|follow\s+link|trigger\s+button)\b/i,
      ],
      coreKeywords: ["click", "press", "tap"],
    },
    {
      operation: "HOVER",
      canonicalVerb: "hover",
      patterns: [
        /\b(?:hover(?:\s+over)?|mouse\s+over|move\s+mouse\s+to)\b/i,
      ],
      coreKeywords: ["hover", "mouseover"],
    },
    {
      operation: "SCROLL",
      canonicalVerb: "scroll",
      patterns: [
        /\b(?:scroll(?:\s+down|\s+up|\s+to)?|page\s+down|page\s+up)\b/i,
      ],
      coreKeywords: ["scroll", "scrolldown", "scrollup"],
    },
    // 10. Search / Information Retrieval / Inspection / Extraction
    {
      operation: "SEARCH",
      canonicalVerb: "search",
      patterns: [
        /\b(?:search(?:\s+for)?|look\s+for|look\s+up|query(?:\s+for)?|find|seek|hunt\s+down)\b/i,
        /\b(?:which\s+(?:listed|available)?|what\s+is\s+the|show\s+me|identify\s+(?:the)?|procure\s+(?:for\s+me)?)\b/i,
      ],
      coreKeywords: ["search", "find", "lookup", "query", "which", "identify", "procure"],
    },
    {
      operation: "INSPECT",
      canonicalVerb: "inspect",
      patterns: [
        /\b(?:inspect|check\s+whether|check\s+if|verify\s+whether|verify\s+if|examine|look\s+if|observe)\b/i,
      ],
      coreKeywords: ["inspect", "verify", "check", "examine"],
    },
    {
      operation: "EXTRACT",
      canonicalVerb: "extract",
      patterns: [
        /\b(?:extract|grab|scrape|copy|list|get|gather|collect|read\s+off)\b/i,
      ],
      coreKeywords: ["extract", "grab", "scrape", "copy", "get"],
    },
  ];

  /**
   * Rule-based morphological suffix reduction (model-free stemming)
   */
  public static stemWord(word: string): string {
    let w = word.toLowerCase();
    if (w.length <= 3) return w;

    if (w.endsWith("ing") && w.length > 5) {
      w = w.slice(0, -3);
      if (w.endsWith("tt") || w.endsWith("nn") || w.endsWith("pp") || w.endsWith("gg")) {
        w = w.slice(0, -1);
      }
    } else if (w.endsWith("ed") && w.length > 4) {
      w = w.slice(0, -2);
    } else if (w.endsWith("es") && w.length > 4) {
      w = w.slice(0, -2);
    } else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) {
      w = w.slice(0, -1);
    } else if (w.endsWith("ly") && w.length > 4) {
      w = w.slice(0, -2);
    }
    return w;
  }

  /**
   * Compute Jaccard similarity coefficient between two token arrays
   */
  public static jaccardSimilarity(a: string[], b: string[]): number {
    if (!a.length || !b.length) return 0;
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Compute Levenshtein distance for fuzzy keyword tolerance
   */
  public static levenshtein(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + cost // substitution
        );
      }
    }
    return dp[m][n];
  }

  /**
   * Normalizes raw user input into clean tokens, phrases, numbers, and currencies
   */
  static tokenize(input: string): NormalizedTokens {
    const raw = input.trim();

    // 1. Expand contractions
    let expanded = raw;
    for (const [re, replacement] of this.CONTRACTIONS) {
      expanded = expanded.replace(re, replacement);
    }

    // 2. Extract quoted phrases before stripping quotes
    const quotedPhrases: string[] = [];
    const quoteMatches = expanded.match(/["']([^"']{2,60})["']/g);
    if (quoteMatches) {
      for (const q of quoteMatches) {
        quotedPhrases.push(q.replace(/["']/g, "").trim());
      }
    }

    // 3. Normalize diacritics and strip excessive punctuation
    const normalized = expanded
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s\-\.\:\/\?@=&#$₹€£%]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const lower = normalized.toLowerCase();
    const rawWords = lower.split(/\s+/).filter(Boolean);

    // 4. Extract numbers and currencies
    const numbers: number[] = [];
    const currencies: Array<{ symbol: string; value: number }> = [];

    for (const w of rawWords) {
      const currMatch = w.match(/^([$₹€£])?(\d+(?:,\d{3})*(?:\.\d+)?)/);
      if (currMatch) {
        const symbol = currMatch[1] || "";
        const val = parseFloat(currMatch[2].replace(/,/g, ""));
        if (!isNaN(val)) {
          numbers.push(val);
          if (symbol) {
            currencies.push({ symbol, value: val });
          }
        }
      }
    }

    // 5. Generate n-grams (bigrams and trigrams)
    const phrases: string[] = [];
    for (let i = 0; i < rawWords.length - 1; i++) {
      phrases.push(`${rawWords[i]} ${rawWords[i + 1]}`);
      if (i < rawWords.length - 2) {
        phrases.push(`${rawWords[i]} ${rawWords[i + 1]} ${rawWords[i + 2]}`);
      }
    }

    // 6. Stem tokens
    const stemmedTokens = rawWords.map((w) => this.stemWord(w));

    return {
      raw,
      normalized,
      tokens: rawWords,
      stemmedTokens,
      phrases,
      numbers,
      currencies,
      quotedPhrases,
    };
  }

  /**
   * Interprets the user input into primary linguistic intent, detecting negation, questions,
   * and broad browser operations using pattern matching and model-free semantic similarity.
   */
  static interpret(rawInput: string): InterpretedCommand {
    const tokens = this.tokenize(rawInput);
    const lower = tokens.normalized.toLowerCase();

    // 1. Detect interrogative sentence mood
    const isQuestion =
      /^(?:what|which|how|where|who|is|are|can|does|do|could|would)\b/i.test(rawInput.trim()) ||
      rawInput.trim().endsWith("?");

    // 2. Detect polarity and negation scope
    const isNegated = /\b(?:not|don't|do\s+not|never|without|no|unsubmitted)\b/i.test(lower);
    const negatedConcepts: string[] = [];

    if (
      /\b(?:not|don't|do\s+not|never|without)\s+[^.,;!?:()]*?\b(?:submit|submitting|send\s+(?:a\s+)?message|send\s+inquiry|post)\b/i.test(lower) ||
      lower.includes("unsubmitted")
    ) {
      negatedConcepts.push("submit");
    }
    if (/\b(?:not|don't|do\s+not|never|without)\s+(?:buy|purchase|checkout|order)/i.test(lower)) {
      negatedConcepts.push("purchase");
    }
    if (/\b(?:not|don't|do\s+not|never|without)\s+(?:add|adding)\s+(?:to\s+)?cart/i.test(lower)) {
      negatedConcepts.push("add_to_cart");
    }
    if (/\b(?:without\s+opening|do\s+not\s+open|don't\s+open)\b/i.test(lower)) {
      negatedConcepts.push("open");
    }
    if (/\b(?:without\s+changing|do\s+not\s+leave|stay\s+on\s+this\s+page)\b/i.test(lower)) {
      negatedConcepts.push("navigate");
    }

    // 3. Primary operation determination
    let primaryVerb = "search";
    let operationType: BrowserOperationType = "SEARCH";
    let highestConfidence = 0.5;

    // Check pattern matching in priority order
    for (const mapping of this.OPERATION_VOCABULARY) {
      const regexMatch = mapping.patterns.some((re) => re.test(lower));
      if (regexMatch) {
        primaryVerb = mapping.canonicalVerb;
        operationType = mapping.operation;
        highestConfidence = 0.9;
        break;
      }
    }

    // If no direct regex match, use model-free Jaccard similarity across vocabulary
    if (highestConfidence < 0.9) {
      let bestSimilarity = 0;
      let matchedOp = operationType;
      let matchedVerb = primaryVerb;

      for (const mapping of this.OPERATION_VOCABULARY) {
        const sim = this.jaccardSimilarity(tokens.stemmedTokens, mapping.coreKeywords);
        if (sim > bestSimilarity && sim >= 0.2) {
          bestSimilarity = sim;
          matchedOp = mapping.operation;
          matchedVerb = mapping.canonicalVerb;
        }
      }

      if (bestSimilarity > 0) {
        operationType = matchedOp;
        primaryVerb = matchedVerb;
        highestConfidence = Math.min(0.85, 0.5 + bestSimilarity);
      }
    }

    // 4. Extract meaningful keywords excluding stop words
    const extractedKeywords = tokens.tokens.filter(
      (t) => !this.STOP_WORDS.has(t) && t.length > 2 && !/^\d+$/.test(t)
    );

    return {
      primaryVerb,
      operationType,
      isQuestion,
      isNegated,
      negatedConcepts,
      extractedKeywords,
      normalizedInput: tokens.normalized,
      tokens,
      confidenceScore: highestConfidence,
    };
  }
}
