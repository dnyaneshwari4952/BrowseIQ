import { validateUrlString } from "../validation/url-policy";
import { AgentError } from "../types/errors";

export interface RecognizedWebsite {
  canonicalName: string;
  canonicalUrl: string;
  aliases: string[];
  category: "ecommerce" | "media" | "knowledge" | "social" | "search" | "developer" | "general";
  preferredSearchPath?: string;
  notes?: string;
}

export interface WebsiteResolutionResult {
  targetWebsite?: string;
  targetUrl?: string;
  urlClarificationNeeded: boolean;
  ambiguityReason?: string;
  isRecognized: boolean;
  isExplicitDomain: boolean;
}

/**
 * Centralized, maintainable Website & Domain Registry (Phase 2)
 * Maps natural-language website names, domain variations, and aliases to canonical homepages
 * safely without scattered if/else branches.
 */
export class WebsiteRegistry {
  private static readonly REGISTRY: RecognizedWebsite[] = [
    // E-Commerce & Retail
    {
      canonicalName: "flipkart",
      canonicalUrl: "https://www.flipkart.com",
      aliases: ["flipkart", "flipkart.com", "flipkart store", "flipkart india"],
      category: "ecommerce",
    },
    {
      canonicalName: "amazon",
      canonicalUrl: "https://www.amazon.com",
      aliases: ["amazon", "amazon.com", "amazon store", "amazon prime"],
      category: "ecommerce",
    },
    {
      canonicalName: "walmart",
      canonicalUrl: "https://www.walmart.com",
      aliases: ["walmart", "walmart.com", "wal-mart"],
      category: "ecommerce",
    },
    {
      canonicalName: "ebay",
      canonicalUrl: "https://www.ebay.com",
      aliases: ["ebay", "ebay.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "target",
      canonicalUrl: "https://www.target.com",
      aliases: ["target.com", "target store", "target retail"],
      category: "ecommerce",
    },
    {
      canonicalName: "bestbuy",
      canonicalUrl: "https://www.bestbuy.com",
      aliases: ["bestbuy", "best buy", "bestbuy.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "myntra",
      canonicalUrl: "https://www.myntra.com",
      aliases: ["myntra", "myntra.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "etsy",
      canonicalUrl: "https://www.etsy.com",
      aliases: ["etsy", "etsy.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "aliexpress",
      canonicalUrl: "https://www.aliexpress.com",
      aliases: ["aliexpress", "ali express", "aliexpress.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "nykaa",
      canonicalUrl: "https://www.nykaa.com",
      aliases: ["nykaa", "nykaa.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "swiggy",
      canonicalUrl: "https://www.swiggy.com",
      aliases: ["swiggy", "swiggy.com"],
      category: "ecommerce",
    },
    {
      canonicalName: "zomato",
      canonicalUrl: "https://www.zomato.com",
      aliases: ["zomato", "zomato.com"],
      category: "ecommerce",
    },

    // Media & Entertainment
    {
      canonicalName: "youtube",
      canonicalUrl: "https://www.youtube.com",
      aliases: ["youtube", "youtube.com", "yt"],
      category: "media",
    },
    {
      canonicalName: "spotify",
      canonicalUrl: "https://open.spotify.com",
      aliases: ["spotify", "open.spotify.com", "spotify.com"],
      category: "media",
    },
    {
      canonicalName: "soundcloud",
      canonicalUrl: "https://soundcloud.com",
      aliases: ["soundcloud", "soundcloud.com"],
      category: "media",
    },
    {
      canonicalName: "vimeo",
      canonicalUrl: "https://vimeo.com",
      aliases: ["vimeo", "vimeo.com"],
      category: "media",
    },
    {
      canonicalName: "twitch",
      canonicalUrl: "https://www.twitch.tv",
      aliases: ["twitch", "twitch.tv"],
      category: "media",
    },
    {
      canonicalName: "netflix",
      canonicalUrl: "https://www.netflix.com",
      aliases: ["netflix", "netflix.com"],
      category: "media",
    },
    {
      canonicalName: "hulu",
      canonicalUrl: "https://www.hulu.com",
      aliases: ["hulu", "hulu.com"],
      category: "media",
    },
    {
      canonicalName: "disneyplus",
      canonicalUrl: "https://www.disneyplus.com",
      aliases: ["disneyplus", "disney plus", "disney+.com"],
      category: "media",
    },
    {
      canonicalName: "dailymotion",
      canonicalUrl: "https://www.dailymotion.com",
      aliases: ["dailymotion", "dailymotion.com"],
      category: "media",
    },
    {
      canonicalName: "imdb",
      canonicalUrl: "https://www.imdb.com",
      aliases: ["imdb", "imdb.com"],
      category: "media",
    },

    // Knowledge & Information
    {
      canonicalName: "wikipedia",
      canonicalUrl: "https://www.wikipedia.org",
      aliases: ["wikipedia", "wikipedia.org", "wiki"],
      category: "knowledge",
    },
    {
      canonicalName: "hackernews",
      canonicalUrl: "https://news.ycombinator.com",
      aliases: ["hacker news", "hackernews", "hn", "ycombinator", "news.ycombinator.com"],
      category: "knowledge",
    },
    {
      canonicalName: "archive",
      canonicalUrl: "https://archive.org",
      aliases: ["internet archive", "archive.org", "wayback machine"],
      category: "knowledge",
    },
    {
      canonicalName: "arxiv",
      canonicalUrl: "https://arxiv.org",
      aliases: ["arxiv", "arxiv.org"],
      category: "knowledge",
    },
    {
      canonicalName: "medium",
      canonicalUrl: "https://medium.com",
      aliases: ["medium", "medium.com"],
      category: "knowledge",
    },
    {
      canonicalName: "quora",
      canonicalUrl: "https://www.quora.com",
      aliases: ["quora", "quora.com"],
      category: "knowledge",
    },
    {
      canonicalName: "bbc",
      canonicalUrl: "https://www.bbc.com",
      aliases: ["bbc", "bbc news", "bbc.com", "bbc.co.uk"],
      category: "knowledge",
    },
    {
      canonicalName: "cnn",
      canonicalUrl: "https://www.cnn.com",
      aliases: ["cnn", "cnn news", "cnn.com"],
      category: "knowledge",
    },
    {
      canonicalName: "coursera",
      canonicalUrl: "https://www.coursera.org",
      aliases: ["coursera", "coursera.org"],
      category: "knowledge",
    },
    {
      canonicalName: "udemy",
      canonicalUrl: "https://www.udemy.com",
      aliases: ["udemy", "udemy.com"],
      category: "knowledge",
    },
    {
      canonicalName: "khanacademy",
      canonicalUrl: "https://www.khanacademy.org",
      aliases: ["khan academy", "khanacademy", "khanacademy.org"],
      category: "knowledge",
    },

    // Developer & Code
    {
      canonicalName: "github",
      canonicalUrl: "https://github.com",
      aliases: ["github", "github.com"],
      category: "developer",
    },
    {
      canonicalName: "stackoverflow",
      canonicalUrl: "https://stackoverflow.com",
      aliases: ["stackoverflow", "stack overflow", "stackoverflow.com"],
      category: "developer",
    },
    {
      canonicalName: "npm",
      canonicalUrl: "https://www.npmjs.com",
      aliases: ["npm", "npmjs", "npmjs.com"],
      category: "developer",
    },
    {
      canonicalName: "pypi",
      canonicalUrl: "https://pypi.org",
      aliases: ["pypi", "pypi.org", "python package index"],
      category: "developer",
    },

    // Search Engines
    {
      canonicalName: "google",
      canonicalUrl: "https://www.google.com",
      aliases: ["google", "google.com", "google search"],
      category: "search",
    },
    {
      canonicalName: "duckduckgo",
      canonicalUrl: "https://duckduckgo.com",
      aliases: ["duckduckgo", "duck duck go", "ddg", "duckduckgo.com"],
      category: "search",
    },
    {
      canonicalName: "bing",
      canonicalUrl: "https://www.bing.com",
      aliases: ["bing", "bing.com"],
      category: "search",
    },
    {
      canonicalName: "yahoo",
      canonicalUrl: "https://www.yahoo.com",
      aliases: ["yahoo", "yahoo.com"],
      category: "search",
    },

    // Social & Professional
    {
      canonicalName: "reddit",
      canonicalUrl: "https://www.reddit.com",
      aliases: ["reddit", "reddit.com"],
      category: "social",
    },
    {
      canonicalName: "twitter",
      canonicalUrl: "https://x.com",
      aliases: ["twitter", "x", "x.com", "twitter.com"],
      category: "social",
    },
    {
      canonicalName: "linkedin",
      canonicalUrl: "https://www.linkedin.com",
      aliases: ["linkedin", "linkedin.com"],
      category: "social",
    },
    {
      canonicalName: "instagram",
      canonicalUrl: "https://www.instagram.com",
      aliases: ["instagram", "instagram.com"],
      category: "social",
    },
    {
      canonicalName: "facebook",
      canonicalUrl: "https://www.facebook.com",
      aliases: ["facebook", "facebook.com"],
      category: "social",
    },
    {
      canonicalName: "pinterest",
      canonicalUrl: "https://www.pinterest.com",
      aliases: ["pinterest", "pinterest.com"],
      category: "social",
    },
    {
      canonicalName: "apple",
      canonicalUrl: "https://www.apple.com",
      aliases: ["apple", "apple.com", "apple store"],
      category: "general",
    },
  ];

  // Non-site words that must NEVER be misidentified as destination websites
  private static readonly NON_SITE_WORDS = new Set([
    "the", "this", "that", "these", "those", "a", "an",
    "page", "site", "website", "webpage", "catalog", "screen", "table", "form", "list", "view", "tab", "window",
    "here", "there", "it", "its", "my", "our", "your", "their", "any", "some", "each", "every",
    "top", "bottom", "left", "right", "first", "second", "third", "last",
    "submit", "click", "search", "details", "contact",
    "size", "color", "order", "cart", "checkout", "filter", "sort", "menu", "button", "link", "input",
    "file", "dialog", "modal", "header", "footer", "section", "card", "item", "result", "results",
    "them", "something", "somewhere", "anything", "everything",
    "least", "most", "best", "worst", "all", "stock", "sale", "price", "cost", "once", "twice",
    "home", "work", "school", "store", "shop", "account", "login", "signup", "settings", "profile",
    "help", "support", "faq", "usd", "dollar", "dollars", "eur", "euro", "inr", "rupees", "percent",
    "discount", "deal", "deals", "ratings", "reviews", "brand", "brands", "model", "models",
    "phone", "phones", "mobile", "mobiles", "laptop", "laptops", "product", "products", "song", "songs",
    "video", "videos", "tutorial", "tutorials", "story", "stories", "post", "posts", "article", "articles",
    "downloads", "download", "folder", "folders", "storage", "disk", "local", "computer", "pc", "directory",
  ]);

  /**
   * Look up a website name or alias against the registry.
   */
  public static findByAlias(rawName: string): RecognizedWebsite | undefined {
    const normalized = rawName.toLowerCase().trim().replace(/^(?:https?:\/\/)?(?:www\.)?/, "").replace(/\/$/, "");
    return this.REGISTRY.find((entry) => {
      if (entry.canonicalName === normalized) return true;
      return entry.aliases.some((alias) => {
        const normAlias = alias.toLowerCase().trim().replace(/^(?:https?:\/\/)?(?:www\.)?/, "").replace(/\/$/, "");
        return normAlias === normalized;
      });
    });
  }

  /**
   * Resolves a destination website and canonical URL from user instruction or explicit URL.
   */
  public static resolveTarget(
    instruction: string,
    providedUrl?: string
  ): WebsiteResolutionResult {
    // 1. Explicitly provided target URL takes top precedence
    if (providedUrl) {
      try {
        const validated = validateUrlString(providedUrl, "provided target URL");
        // Check if provided URL maps to a recognized website name
        const recognized = this.findByAlias(validated.hostname);
        return {
          targetUrl: validated.href,
          targetWebsite: recognized?.canonicalName || validated.hostname,
          urlClarificationNeeded: false,
          isRecognized: Boolean(recognized),
          isExplicitDomain: true,
        };
      } catch (err: unknown) {
        if (err instanceof AgentError) throw err;
        return {
          targetWebsite: providedUrl,
          urlClarificationNeeded: true,
          ambiguityReason: `Provided URL "${providedUrl}" failed URL safety validation.`,
          isRecognized: false,
          isExplicitDomain: true,
        };
      }
    }

    const trimmed = instruction.trim();

    // Prevent website resolution for local-file tasks (Requirement 6)
    const isLocalFileTask =
      /\b(?:downloads?\s+folder|downloads?|local\s+storage|local\s+file|local\s+files|local\s+disk|my\s+computer|from\s+local|in\s+local|from\s+downloads|in\s+downloads)\b/i.test(trimmed);
    const hasExplicitWebsite =
      /\b(?:on\s+(?:spotify|youtube|soundcloud|vimeo|apple\s+music|netflix|flipkart|amazon)|https?:\/\/|[a-zA-Z0-9-]+\.(?:com|org|net|io|in|tv|edu|gov))\b/i.test(trimmed);

    if (isLocalFileTask && !hasExplicitWebsite) {
      return {
        urlClarificationNeeded: false,
        isRecognized: false,
        isExplicitDomain: false,
      };
    }

    // 2. Look for full URL in instruction (http:// or https://)
    const urlMatch = trimmed.match(/https?:\/\/[^\s\)\>\,]+/i);
    if (urlMatch) {
      try {
        const validated = validateUrlString(urlMatch[0], "instruction target URL");
        const recognized = this.findByAlias(validated.hostname);
        return {
          targetUrl: validated.href,
          targetWebsite: recognized?.canonicalName || validated.hostname,
          urlClarificationNeeded: false,
          isRecognized: Boolean(recognized),
          isExplicitDomain: true,
        };
      } catch (err: unknown) {
        if (err instanceof AgentError) throw err;
        return {
          targetWebsite: urlMatch[0],
          urlClarificationNeeded: true,
          ambiguityReason: `URL "${urlMatch[0]}" is invalid or prohibited by policy.`,
          isRecognized: false,
          isExplicitDomain: true,
        };
      }
    }

    // 3. Look for explicit domain format (e.g., flipkart.com, news.ycombinator.com, wikipedia.org)
    const domainMatch = trimmed.match(/\b([a-zA-Z0-9-]+\.(?:[a-zA-Z0-9-]+\.)*(?:com|org|net|io|edu|gov|co|in|dev|app|ai|tv|me|info|biz|xyz|uk|ca|de|jp|fr|au))\b/i);
    if (domainMatch) {
      const rawDomain = domainMatch[1].toLowerCase();
      const recognized = this.findByAlias(rawDomain);
      if (recognized) {
        return {
          targetUrl: recognized.canonicalUrl,
          targetWebsite: recognized.canonicalName,
          urlClarificationNeeded: false,
          isRecognized: true,
          isExplicitDomain: true,
        };
      }
      try {
        const candidate = `https://${rawDomain}`;
        const validated = validateUrlString(candidate, "instruction domain resolution");
        return {
          targetUrl: validated.href,
          targetWebsite: rawDomain,
          urlClarificationNeeded: false,
          isRecognized: false,
          isExplicitDomain: true,
        };
      } catch (err: unknown) {
        if (err instanceof AgentError) throw err;
        return {
          targetWebsite: rawDomain,
          urlClarificationNeeded: true,
          ambiguityReason: `Domain "${rawDomain}" is prohibited by safety policy.`,
          isRecognized: false,
          isExplicitDomain: true,
        };
      }
    }

    // 4. Multi-word recognized website check (e.g. "Hacker News", "Khan Academy", "Best Buy")
    const lower = trimmed.toLowerCase();
    for (const site of this.REGISTRY) {
      for (const alias of site.aliases) {
        if (alias.includes(" ")) {
          const aliasRegex = new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`, "i");
          if (aliasRegex.test(lower)) {
            return {
              targetUrl: site.canonicalUrl,
              targetWebsite: site.canonicalName,
              urlClarificationNeeded: false,
              isRecognized: true,
              isExplicitDomain: false,
            };
          }
        }
      }
    }

    // 5. Prepositional website matching: e.g. "on flipkart", "from wikipedia", "search on youtube", "search hacker news"
    // Handles phrases like: "search for cheapest mobile phones on flipkart", "tutorials on wikipedia"
    const prepMatch = trimmed.match(
      /\b(?:search\s+on|find\s+on|look\s+up\s+on|on|from|at|via|in|into|using)\s+([a-zA-Z0-9.-]+(?:\s+[a-zA-Z0-9.-]+)?)\b/i
    );

    if (prepMatch) {
      const candidateRaw = prepMatch[1].trim();
      const candidateKey = candidateRaw.toLowerCase();

      // Check multi-word or single-word alias in registry
      const recognized = this.findByAlias(candidateKey) || this.findByAlias(candidateKey.split(/\s+/)[0]);
      if (recognized) {
        return {
          targetUrl: recognized.canonicalUrl,
          targetWebsite: recognized.canonicalName,
          urlClarificationNeeded: false,
          isRecognized: true,
          isExplicitDomain: false,
        };
      }

      // Check if candidate is a domain with dot
      if (candidateKey.includes(".")) {
        try {
          const candidateUrl = candidateKey.startsWith("http") ? candidateKey : `https://${candidateKey}`;
          const validated = validateUrlString(candidateUrl, "prepositional domain");
          return {
            targetUrl: validated.href,
            targetWebsite: candidateRaw,
            urlClarificationNeeded: false,
            isRecognized: false,
            isExplicitDomain: true,
          };
        } catch (err: unknown) {
          if (err instanceof AgentError) throw err;
          return {
            targetWebsite: candidateRaw,
            urlClarificationNeeded: true,
            ambiguityReason: `Destination "${candidateRaw}" is prohibited by policy.`,
            isRecognized: false,
            isExplicitDomain: true,
          };
        }
      }
    }

    // 6. Action verb targeting a website: e.g. "open flipkart", "visit youtube", "go to wikipedia", "launch hacker news"
    const actionMatch = trimmed.match(
      /\b(?:open|go\s+to|visit|browse|navigate\s+to|launch|head\s+to|access)\s+([a-zA-Z0-9.-]+(?:\s+[a-zA-Z0-9.-]+)?)\b/i
    );

    if (actionMatch) {
      const candidateRaw = actionMatch[1].trim();
      const candidateKey = candidateRaw.toLowerCase();

      const words = candidateKey.split(/\s+/);
      const firstWord = words[0];

      // First check full candidate against registry
      const recognized = this.findByAlias(candidateKey) || this.findByAlias(firstWord);
      if (recognized) {
        return {
          targetUrl: recognized.canonicalUrl,
          targetWebsite: recognized.canonicalName,
          urlClarificationNeeded: false,
          isRecognized: true,
          isExplicitDomain: false,
        };
      }

      // Check if it's a domain
      if (firstWord.includes(".")) {
        try {
          const candidateUrl = firstWord.startsWith("http") ? firstWord : `https://${firstWord}`;
          const validated = validateUrlString(candidateUrl, "action domain");
          return {
            targetUrl: validated.href,
            targetWebsite: firstWord,
            urlClarificationNeeded: false,
            isRecognized: false,
            isExplicitDomain: true,
          };
        } catch (err: unknown) {
          if (err instanceof AgentError) throw err;
          return {
            targetWebsite: firstWord,
            urlClarificationNeeded: true,
            ambiguityReason: `Destination "${firstWord}" is prohibited by policy.`,
            isRecognized: false,
            isExplicitDomain: true,
          };
        }
      }

      // If it's not a generic non-site noun, it's an unrecognized destination requiring user clarification
      if (!this.NON_SITE_WORDS.has(firstWord) && !["and", "then", "to", "for", "a", "an", "the"].includes(firstWord)) {
        return {
          targetWebsite: firstWord,
          urlClarificationNeeded: true,
          ambiguityReason: `Destination website "${firstWord}" mentioned without a valid web address.`,
          isRecognized: false,
          isExplicitDomain: false,
        };
      }
    }

    // 7. Look for single-word recognized website names anywhere in the instruction
    // e.g. "flipkart search for mobile phones", "youtube kya baat hai", "wikipedia python"
    for (const site of this.REGISTRY) {
      // Exclude common English words that might be used generically unless preceded/followed by site context
      if (site.canonicalName === "target" || site.canonicalName === "apple" || site.canonicalName === "x") {
        continue;
      }
      const regex = new RegExp(`\\b${site.canonicalName}\\b`, "i");
      if (regex.test(lower)) {
        return {
          targetUrl: site.canonicalUrl,
          targetWebsite: site.canonicalName,
          urlClarificationNeeded: false,
          isRecognized: true,
          isExplicitDomain: false,
        };
      }
    }

    // 8. No target website identified in instruction
    return {
      urlClarificationNeeded: false,
      isRecognized: false,
      isExplicitDomain: false,
    };
  }

  /**
   * Get all registered websites.
   */
  public static getAll(): RecognizedWebsite[] {
    return [...this.REGISTRY];
  }
}
