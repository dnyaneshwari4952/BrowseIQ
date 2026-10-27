import { Page, Locator } from "playwright";
import { AgentError, ErrorCode } from "../types/errors";
import { ElementTarget } from "../types/actions";

export interface SearchCandidateMetadata {
  price?: number;
  currency?: string;
  artist?: string;
  author?: string;
  channel?: string;
  date?: string;
  rating?: number;
  category?: string;
  [key: string]: unknown;
}

export interface SearchCandidate {
  id: string;
  selector: string;
  locator: Locator;
  title: string;
  snippet: string;
  url: string;
  visibleText: string;
  accessibleName: string;
  role: string;
  cardId: string;
  isThumbnail: boolean;
  isTitleLink: boolean;
  isVisible: boolean;
  isEnabled: boolean;
  metadata: SearchCandidateMetadata;
  score: number;
  scoreBreakdown: {
    titleExact?: number;
    tokenOverlap?: number;
    snippetMatch?: number;
    urlRelevance?: number;
    headingBonus?: number;
    metadataBonus?: number;
    rankBonus?: number;
    penalty?: number;
  };
  matchType: "exact" | "token_overlap" | "partial" | "metadata" | "none";
}

export interface SearchResolutionOptions {
  query: string;
  instruction?: string;
  taskType?: "media" | "product" | "article" | "general";
  ordinalIndex?: number;
  constraints?: {
    priceComparison?: "cheapest" | "expensive";
    forbiddenTerms?: string[];
    requiredTerms?: string[];
  };
  timeoutMs?: number;
}

export interface SearchResolutionResult {
  status: "resolved" | "ambiguous" | "no_match";
  selectedCandidate?: SearchCandidate;
  candidates: SearchCandidate[];
  deduplicatedCount: number;
  distinctResultsCount: number;
  ambiguityReason?: string;
  clarificationOptions?: { title: string; url?: string; description?: string }[];
  diagnostics: {
    query: string;
    totalElementsScanned: number;
    topScore: number;
    secondScore: number;
    scoreMargin: number;
    selectionRationale: string;
  };
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by",
  "song", "track", "video", "music", "audio", "full", "official", "lyrics", "hd", "4k",
  "episode", "ep", "part", "buy", "find", "search", "show", "open", "play"
]);

/**
 * Generalized Search Result Resolver
 *
 * Implements Phase 2: Live page observation, candidate normalization,
 * card association, thumbnail/title deduplication, semantic ranking,
 * and calibrated ambiguity handling.
 */
export class SearchResultResolver {
  /**
   * Waits for a meaningful search-results state using Playwright condition-based waiting
   */
  static async waitForResults(page: Page, timeoutMs = 2000): Promise<boolean> {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 1000) }).catch(() => {});

      // If visible content links or result containers are already present, return immediately
      const immediateCount = await page.locator(
        "ytd-video-renderer, .result-card, .product-card, [role='article'], h3 a, h2 a, a#video-title, #main-results a, #results a, main a"
      ).count().catch(() => 0);

      if (immediateCount > 0) {
        return true;
      }

      // Check if any visible links already exist in body
      const anyVisibleLinks = await page.locator("a:visible").count().catch(() => 0);
      if (anyVisibleLinks > 0) {
        return true;
      }

      const resultsIndicator = page.locator([
        // YouTube / video
        "ytd-video-renderer",
        "ytd-rich-item-renderer",
        "ytd-search",
        // E-commerce / products
        ".product-card",
        ".product-item",
        "[data-testid*='product']",
        // General search
        "[role='feed']",
        "[role='region']",
        "[role='article']",
        ".result-card",
        ".search-result",
        ".search-results",
        ".results",
        "#results",
        "#search",
        "article",
        "h3 a",
        "h2 a",
        "a[href*='watch']",
        "a[href*='/video/']",
        "a[href*='/track/']",
        "a[href*='/item/']",
        "a[href*='/p/']",
        "a[href*='/article/']",
        // Empty state
        ":has-text('No results found')",
        ":has-text('No matching videos found')",
      ].join(", ")).first();

      await resultsIndicator.waitFor({ state: "visible", timeout: Math.min(timeoutMs, 2000) }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Inspects the live DOM, normalizes candidate elements, deduplicates multiple links
   * within the same card, and constructs structured SearchCandidate records.
   */
  static async extractCandidates(page: Page): Promise<{
    candidates: SearchCandidate[];
    totalScanned: number;
    distinctCards: number;
  }> {
    // Extract raw structured data from the page in one atomic in-browser evaluation
    const rawData = await page.evaluate(() => {
      interface RawExtractedItem {
        id: string;
        selector: string;
        title: string;
        snippet: string;
        href: string;
        visibleText: string;
        accessibleName: string;
        role: string;
        cardId: string;
        isThumbnail: boolean;
        isTitleLink: boolean;
        metadata: {
          price?: number;
          currency?: string;
          artist?: string;
          channel?: string;
          date?: string;
          [key: string]: unknown;
        };
      }

      const results: RawExtractedItem[] = [];
      const seenCardIds = new Set<string>();

      // 1. Identify distinct result cards/containers
      const cardSelectors = [
        "ytd-video-renderer",
        "ytd-rich-item-renderer",
        "ytd-playlist-renderer",
        ".product-card",
        ".product-item",
        ".result-card",
        ".search-result",
        ".video-card",
        "[data-testid*='product-card']",
        "[data-testid*='result']",
        "[data-testid*='track']",
        "[data-testid*='video']",
        "[role='article']",
        "article",
        "li.b_algo", // Bing
        ".g",        // Google
        ".result",   // DuckDuckGo
        ".mw-search-result", // Wikipedia
      ];

      const cardElements = Array.from(document.querySelectorAll<HTMLElement>(cardSelectors.join(", ")))
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });

      let cardIndex = 0;

      if (cardElements.length > 0) {
        for (const card of cardElements) {
          cardIndex++;
          const cardId = card.id || `card_${cardIndex}`;
          seenCardIds.add(cardId);

          // Find all anchor links inside the card
          const links = Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => {
            const rect = a.getBoundingClientRect();
            const style = window.getComputedStyle(a);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });

          if (links.length === 0) continue;

          // Extract card-level text, title, snippet, metadata
          const cardText = card.innerText ? card.innerText.trim() : "";
          const headingEl = card.querySelector("h1, h2, h3, h4, #video-title, .title, [class*='title']");
          const cardTitle = headingEl ? headingEl.textContent?.trim() || "" : "";

          // Extract description / snippet
          const snippetEl = card.querySelector(
            ".snippet, .description, p, [class*='snippet'], [class*='desc'], #description-text"
          );
          const snippetText = snippetEl ? snippetEl.textContent?.trim() || "" : "";

          // Extract price if available
          let priceNum: number | undefined = undefined;
          let currencyStr: string | undefined = undefined;
          const priceMatch = cardText.match(/([$€£₹])\s*([\d,]+(?:\.\d{2})?)/) ||
                             cardText.match(/([\d,]+(?:\.\d{2})?)\s*([$€£₹])/);
          if (priceMatch) {
            const rawVal = priceMatch[1] && /[\d,]/.test(priceMatch[1]) ? priceMatch[1] : priceMatch[2];
            const rawCur = priceMatch[1] && !/[\d,]/.test(priceMatch[1]) ? priceMatch[1] : priceMatch[2];
            priceNum = parseFloat(rawVal.replace(/,/g, ""));
            currencyStr = rawCur;
          }

          // Extract channel / artist / author metadata
          const channelEl = card.querySelector(
            "ytd-channel-name, .channel, .author, [class*='channel'], [class*='author'], [class*='byline'], #channel-info"
          );
          const channelText = channelEl ? channelEl.textContent?.trim() || undefined : undefined;

          // Find primary title link vs thumbnail link
          let primaryTitleLink: HTMLAnchorElement | null = null;
          if (headingEl) {
            primaryTitleLink = headingEl.tagName === "A"
              ? (headingEl as HTMLAnchorElement)
              : headingEl.querySelector("a[href]");
          }
          if (!primaryTitleLink) {
            primaryTitleLink = links.find((l) => l.id === "video-title" || l.className.includes("title")) || links[0];
          }

          for (let li = 0; li < links.length; li++) {
            const link = links[li];
            const href = link.getAttribute("href") || "";
            const isThumb = Boolean(
              link.querySelector("img, svg, picture") ||
              link.className.includes("thumb") ||
              link.className.includes("preview") ||
              link.id.includes("thumbnail")
            );
            const isTitle = link === primaryTitleLink || (!isThumb && link.textContent?.trim().length! > 5);

            // Compute unique selector for this link
            let selector = "";
            if (link.id) {
              selector = `#${link.id}`;
            } else if (link.getAttribute("href")) {
              selector = `a[href="${link.getAttribute("href")}"]`;
            } else {
              selector = `a:has-text("${(link.textContent || "").slice(0, 30).trim()}")`;
            }

            const title = link.getAttribute("title") ||
                          link.getAttribute("aria-label") ||
                          (isTitle ? cardTitle : "") ||
                          link.textContent?.trim() || "";

            const accessibleName = link.getAttribute("aria-label") || link.getAttribute("title") || "";

            results.push({
              id: `${cardId}_link_${li}`,
              selector,
              title: title || cardTitle,
              snippet: snippetText,
              href,
              visibleText: link.textContent?.trim() || cardText.slice(0, 150),
              accessibleName,
              role: link.getAttribute("role") || "link",
              cardId,
              isThumbnail: isThumb,
              isTitleLink: isTitle,
              metadata: {
                price: priceNum,
                currency: currencyStr,
                artist: channelText,
                channel: channelText,
              },
            });
          }
        }
      }

      // 2. If no explicit result cards were found, inspect all visible content links in main area
      if (results.length === 0) {
        const mainArea = document.querySelector("main, [role='main'], #content, #results, .results, body") || document.body;
        const candidateLinks = Array.from(mainArea.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => {
          const rect = a.getBoundingClientRect();
          const style = window.getComputedStyle(a);
          if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") {
            return false;
          }
          // Filter out header, nav, footer, sidebar, pagination
          const closestHeaderOrNav = a.closest("header, nav, footer, [role='navigation'], [role='banner'], .pagination, aside");
          if (closestHeaderOrNav) return false;

          const text = (a.textContent || a.getAttribute("title") || a.getAttribute("aria-label") || "").trim();
          if (!text || text.length < 2) return false;

          const href = (a.getAttribute("href") || "").toLowerCase();
          const isUtility = /^\/(?:feed|browse|guide|channel|account|settings|about|terms|policies|privacy|help|login|signin)\b/i.test(href) ||
                            /^(?:home|explore|subscriptions|library|history|sign\s+in|help|privacy|terms)$/i.test(text);
          if (isUtility) return false;

          return true;
        });

        let linkIdx = 0;
        for (const link of candidateLinks) {
          linkIdx++;
          const cardId = `item_${linkIdx}`;
          seenCardIds.add(cardId);
          const text = (link.textContent || "").trim();
          const title = link.getAttribute("title") || link.getAttribute("aria-label") || text;
          const href = link.getAttribute("href") || "";

          // Check parent heading or container
          const parentHeading = link.closest("h1, h2, h3, h4");
          const parentContainer = link.parentElement;
          const snippetText = parentContainer ? parentContainer.textContent?.replace(text, "").trim().slice(0, 200) || "" : "";

          let selector = "";
          if (link.id) {
            selector = `#${link.id}`;
          } else if (href) {
            selector = `a[href="${href}"]`;
          } else {
            selector = `a:has-text("${text.slice(0, 30)}")`;
          }

          results.push({
            id: `link_${linkIdx}`,
            selector,
            title,
            snippet: snippetText,
            href,
            visibleText: text,
            accessibleName: link.getAttribute("aria-label") || "",
            role: link.getAttribute("role") || "link",
            cardId,
            isThumbnail: Boolean(link.querySelector("img")),
            isTitleLink: Boolean(parentHeading) || text.length > 5,
            metadata: {},
          });
        }
      }

      return {
        items: results,
        totalScanned: results.length,
        distinctCards: seenCardIds.size,
      };
    }).catch(() => ({ items: [], totalScanned: 0, distinctCards: 0 }));

    // Map raw extracted items back to Playwright locators with absolute URL resolution
    const currentUrl = page.url();
    const candidates: SearchCandidate[] = [];

    for (const raw of rawData.items) {
      let absoluteUrl = raw.href;
      try {
        if (raw.href && !raw.href.startsWith("http")) {
          absoluteUrl = new URL(raw.href, currentUrl).toString();
        }
      } catch {
        // Keep relative if URL parsing fails
      }

      // Build Playwright locator
      let locator: Locator;
      if (raw.selector.startsWith("#")) {
        locator = page.locator(raw.selector);
      } else if (raw.href) {
        // Use exact href matching when available
        locator = page.locator(`a[href="${raw.href}"]`).first();
      } else if (raw.title) {
        locator = page.locator(`a:has-text("${raw.title.slice(0, 40)}")`).first();
      } else {
        locator = page.locator(raw.selector).first();
      }

      candidates.push({
        id: raw.id,
        selector: raw.selector,
        locator,
        title: raw.title,
        snippet: raw.snippet,
        url: absoluteUrl,
        visibleText: raw.visibleText,
        accessibleName: raw.accessibleName,
        role: raw.role,
        cardId: raw.cardId,
        isThumbnail: raw.isThumbnail,
        isTitleLink: raw.isTitleLink,
        isVisible: true,
        isEnabled: true,
        metadata: raw.metadata,
        score: 0,
        scoreBreakdown: {},
        matchType: "none",
      });
    }

    return {
      candidates,
      totalScanned: rawData.totalScanned,
      distinctCards: rawData.distinctCards,
    };
  }

  /**
   * Ranks candidates semantically against the user's requested query, entity, and constraints.
   */
  static rankCandidates(
    candidates: SearchCandidate[],
    options: SearchResolutionOptions
  ): SearchCandidate[] {
    const query = options.query.trim().toLowerCase();
    const queryTokens = query
      .replace(/['".,!?:;()\-–—]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w));
    const normalizedQuery = queryTokens.join(" ");

    const total = candidates.length;

    for (let i = 0; i < total; i++) {
      const c = candidates[i];
      const titleLower = c.title.toLowerCase();
      const textLower = c.visibleText.toLowerCase();
      const snippetLower = c.snippet.toLowerCase();
      const urlLower = c.url.toLowerCase();
      const combined = `${titleLower} ${textLower} ${c.accessibleName.toLowerCase()}`.trim();

      let score = 0;
      const breakdown: SearchCandidate["scoreBreakdown"] = {};
      let matchType: SearchCandidate["matchType"] = "none";

      // 1. Exact Title / Prefix Match
      const cleanTitle = titleLower.replace(/['".,!?:;()\-–—]/g, " ").replace(/\s+/g, " ").trim();
      const cleanQuery = query.replace(/['".,!?:;()\-–—]/g, " ").replace(/\s+/g, " ").trim();

      const isExactFull = cleanTitle === cleanQuery || (normalizedQuery.length >= 2 && cleanTitle === normalizedQuery);
      const isPrefix = cleanTitle.startsWith(cleanQuery) || (normalizedQuery.length >= 2 && cleanTitle.startsWith(normalizedQuery));
      const isSubstring = cleanTitle.includes(cleanQuery) || (normalizedQuery.length >= 2 && cleanTitle.includes(normalizedQuery));

      if (isExactFull) {
        score += 1.0;
        breakdown.titleExact = 1.0;
        matchType = "exact";
      } else if (isPrefix) {
        const queryEffLen = normalizedQuery.length >= 2 && cleanTitle.startsWith(normalizedQuery)
          ? normalizedQuery.length
          : cleanQuery.length;
        const lengthRatio = Math.min(1, Math.max(0.1, queryEffLen / Math.max(1, cleanTitle.length)));
        const prefixScore = Number((0.68 + 0.20 * lengthRatio).toFixed(2));
        score += prefixScore;
        breakdown.titleExact = prefixScore;
        matchType = lengthRatio >= 0.85 ? "exact" : "partial";
      } else if (isSubstring) {
        const queryEffLen = normalizedQuery.length >= 2 && cleanTitle.includes(normalizedQuery)
          ? normalizedQuery.length
          : cleanQuery.length;
        const lengthRatio = Math.min(1, Math.max(0.1, queryEffLen / Math.max(1, cleanTitle.length)));
        const substringScore = Number((0.60 + 0.15 * lengthRatio).toFixed(2));
        score += substringScore;
        breakdown.titleExact = substringScore;
        matchType = lengthRatio >= 0.85 ? "exact" : "partial";
      } else if (queryTokens.length > 0) {
        // 2. Meaningful Token Overlap
        let matchedTokens = 0;
        for (const tok of queryTokens) {
          if (cleanTitle.includes(tok) || combined.includes(tok)) {
            matchedTokens++;
          }
        }
        const tokenRatio = matchedTokens / queryTokens.length;
        if (tokenRatio > 0) {
          const overlapScore = Number((tokenRatio * 0.70).toFixed(2));
          score += overlapScore;
          breakdown.tokenOverlap = overlapScore;
          matchType = tokenRatio >= 0.8 ? "token_overlap" : "partial";
        }
      }

      // 3. Snippet / Description Match
      if (queryTokens.length > 0 && snippetLower) {
        let snippetTokens = 0;
        for (const tok of queryTokens) {
          if (snippetLower.includes(tok)) snippetTokens++;
        }
        if (snippetTokens > 0) {
          const snippetBonus = Number(((snippetTokens / queryTokens.length) * 0.15).toFixed(2));
          score += snippetBonus;
          breakdown.snippetMatch = snippetBonus;
        }
      }

      // 4. URL Semantics Relevance
      if (urlLower.includes("watch") || urlLower.includes("video") || urlLower.includes("track") || urlLower.includes("item")) {
        score += 0.10;
        breakdown.urlRelevance = 0.10;
      }
      for (const tok of queryTokens) {
        if (urlLower.includes(tok)) {
          score += 0.05;
          breakdown.urlRelevance = (breakdown.urlRelevance || 0) + 0.05;
          break;
        }
      }

      // 5. Title Link vs Thumbnail Link preference
      if (c.isTitleLink) {
        score += 0.08;
        breakdown.headingBonus = 0.08;
      }

      // 6. Primary / Official media indicator bonus
      if (/\b(official\s*(video|audio|music\s*video|track)?)\b/i.test(combined)) {
        score += 0.10;
        breakdown.metadataBonus = (breakdown.metadataBonus || 0) + 0.10;
      }

      // 7. Metadata bonuses (Artist / Channel match if specified)
      if (options.instruction) {
        const instLower = options.instruction.toLowerCase();
        if (c.metadata.artist && instLower.includes(String(c.metadata.artist).toLowerCase())) {
          score += 0.15;
          breakdown.metadataBonus = (breakdown.metadataBonus || 0) + 0.15;
        }
      }

      // 8. Rank position preservation (top results returned by search engine receive positioning bonus)
      const rankBonus = i === 0 ? 0.12 : i === 1 ? 0.07 : i === 2 ? 0.04 : 0.01;
      score += rankBonus;
      breakdown.rankBonus = rankBonus;

      // 9. Derivative Content Penalties (Tutorial, Reaction, Lesson, Cover, Parody)
      // Only penalize if the user didn't explicitly request that genre
      let penalty = 0;
      const isDerivativeRequested = /\b(reaction|reacts|tutorial|tutorials|lesson|lessons|guitar lesson|how to play|cover|karaoke|parody)\b/i.test(query);
      if (!isDerivativeRequested) {
        if (/\b(reaction|reacts|reacting|vocal coach reacts)\b/i.test(combined)) {
          penalty += 0.35;
        }
        if (/\b(tutorial|tutorials|lesson|lessons|how to play|guitar lesson|chords tutorial)\b/i.test(combined)) {
          penalty += 0.35;
        }
        if (/\b(cover|karaoke|parody)\b/i.test(combined)) {
          penalty += 0.25;
        }
      }

      if (penalty > 0) {
        score = Math.max(0, score - penalty);
        breakdown.penalty = -penalty;
      }

      // 10. Negative Constraints check
      if (options.constraints?.forbiddenTerms) {
        for (const forbidden of options.constraints.forbiddenTerms) {
          if (combined.includes(forbidden.toLowerCase())) {
            score = 0;
            breakdown.penalty = -1.0;
            break;
          }
        }
      }

      c.score = Number(score.toFixed(3));
      c.scoreBreakdown = breakdown;
      c.matchType = matchType;
    }

    // Sort descending by score
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Resolves the best search result candidate, handling deduplication of title/thumbnail
   * links within the same card and evaluating genuine ambiguity.
   */
  static async resolveSearchResult(
    page: Page,
    options: SearchResolutionOptions
  ): Promise<SearchResolutionResult> {
    // 1. Wait for meaningful search results state
    await this.waitForResults(page, options.timeoutMs || 5000);

    // 2. Extract visible candidate elements
    const { candidates: rawCandidates, totalScanned, distinctCards } = await this.extractCandidates(page);

    if (rawCandidates.length === 0) {
      return {
        status: "no_match",
        candidates: [],
        deduplicatedCount: 0,
        distinctResultsCount: 0,
        diagnostics: {
          query: options.query,
          totalElementsScanned: 0,
          topScore: 0,
          secondScore: 0,
          scoreMargin: 0,
          selectionRationale: `No matching search result found for '${options.query}'. No interactive search results or content links were found on page.`,
        },
      };
    }

    // 3. Rank candidates semantically
    const ranked = this.rankCandidates(rawCandidates, options);

    // 4. Handle specific ordinal request (e.g. "open second result")
    if (typeof options.ordinalIndex === "number" && options.ordinalIndex >= 0) {
      // Group candidates by cardId or destination URL to identify distinct results
      const distinctCardsList: SearchCandidate[] = [];
      const seenCards = new Set<string>();

      for (const cand of ranked) {
        const key = cand.cardId || cand.url;
        if (!seenCards.has(key)) {
          seenCards.add(key);
          // Prefer title link for this card
          distinctCardsList.push(cand);
        }
      }

      const requestedIdx = options.ordinalIndex;
      if (requestedIdx < distinctCardsList.length) {
        const selected = distinctCardsList[requestedIdx];
        return {
          status: "resolved",
          selectedCandidate: selected,
          candidates: ranked,
          deduplicatedCount: ranked.length - distinctCardsList.length,
          distinctResultsCount: distinctCardsList.length,
          diagnostics: {
            query: options.query,
            totalElementsScanned: totalScanned,
            topScore: selected.score,
            secondScore: distinctCardsList[requestedIdx + 1]?.score || 0,
            scoreMargin: 0,
            selectionRationale: `Selected result at index ${requestedIdx} based on explicit ordinal constraint: "${selected.title}" (${selected.url})`,
          },
        };
      }
    }

    // 5. Evaluate top candidates for ambiguity vs clear selection
    const top = ranked[0];
    const second = ranked.length > 1 ? ranked[1] : undefined;

    // Check if score satisfies minimum relevance threshold
    if (!top || top.score < 0.35) {
      return {
        status: "no_match",
        candidates: ranked,
        deduplicatedCount: 0,
        distinctResultsCount: distinctCards,
        diagnostics: {
          query: options.query,
          totalElementsScanned: totalScanned,
          topScore: top?.score || 0,
          secondScore: second?.score || 0,
          scoreMargin: 0,
          selectionRationale: `No matching search result found for '${options.query}'. Available candidates did not meet the minimum semantic relevance threshold (top score: ${top?.score || 0} < 0.35).`,
        },
      };
    }

    // Deduplication check: Do top and second belong to the same result card or same destination?
    const isSameResult = second && (
      (top.cardId && top.cardId === second.cardId) ||
      (top.url && top.url === second.url)
    );

    if (isSameResult) {
      // Both top candidates represent the same result (e.g. title link and thumbnail link)
      // Pick the primary title link
      const bestLink = top.isTitleLink ? top : second!.isTitleLink ? second! : top;
      return {
        status: "resolved",
        selectedCandidate: bestLink,
        candidates: ranked,
        deduplicatedCount: 1,
        distinctResultsCount: distinctCards,
        diagnostics: {
          query: options.query,
          totalElementsScanned: totalScanned,
          topScore: bestLink.score,
          secondScore: ranked[2]?.score || 0,
          scoreMargin: bestLink.score - (ranked[2]?.score || 0),
          selectionRationale: `Deduplicated thumbnail/title links for result card '${bestLink.cardId}'. Selected primary title link: "${bestLink.title}"`,
        },
      };
    }

    // Evaluate score margin between distinct results
    const scoreMargin = second ? Number((top.score - second.score).toFixed(3)) : 1.0;

    // Detect genuine ambiguity:
    // 1. Conflicting season / episode / part numbers (e.g. Season 1 vs Season 2)
    // 2. Identical title strings pointing to different URLs
    // 3. Close scores (margin < 0.04) between different versions when neither is an official primary result
    const hasVariantConflict = Boolean(
      second &&
      /(?:season|episode|part|volume|vol|edition)\s*\d+/i.test(top.title) &&
      /(?:season|episode|part|volume|vol|edition)\s*\d+/i.test(second.title) &&
      top.title.toLowerCase() !== second.title.toLowerCase()
    );

    const isIdenticalTitleConflict = Boolean(
      second &&
      top.title.toLowerCase() === second.title.toLowerCase() &&
      top.url !== second.url &&
      scoreMargin <= 0.06
    );

    const isIndistinguishable =
      second &&
      top.score >= 0.40 &&
      second.score >= 0.40 &&
      Boolean(top.url && second.url && top.url !== second.url) &&
      (hasVariantConflict || isIdenticalTitleConflict || (scoreMargin < 0.04 && !top.scoreBreakdown?.metadataBonus));

    if (isIndistinguishable) {
      const clarificationOptions = [
        { title: top.title, url: top.url, description: top.snippet || top.visibleText.slice(0, 80) },
        { title: second!.title, url: second!.url, description: second!.snippet || second!.visibleText.slice(0, 80) },
      ];

      return {
        status: "ambiguous",
        candidates: ranked,
        deduplicatedCount: ranked.length - distinctCards,
        distinctResultsCount: distinctCards,
        ambiguityReason: `Multiple distinct results with similar relevance were found for '${options.query}': "${top.title}" vs "${second!.title}". Please clarify which result you would like to select.`,
        clarificationOptions,
        diagnostics: {
          query: options.query,
          totalElementsScanned: totalScanned,
          topScore: top.score,
          secondScore: second!.score,
          scoreMargin,
          selectionRationale: `Disambiguation required: Top results have indistinguishable relevance scores (${top.score} vs ${second!.score}, margin: ${scoreMargin}).`,
        },
      };
    }

    // Condition for Clear Winner:
    // - Exact title match OR
    // - Score >= 0.55 and margin >= 0.12 OR
    // - Only 1 result candidate found
    const isClearWinner =
      top.matchType === "exact" ||
      ranked.length === 1 ||
      (top.score >= 0.55 && scoreMargin >= 0.12) ||
      (top.score >= 0.70 && scoreMargin >= 0.08);

    if (isClearWinner) {
      return {
        status: "resolved",
        selectedCandidate: top,
        candidates: ranked,
        deduplicatedCount: ranked.length - distinctCards,
        distinctResultsCount: distinctCards,
        diagnostics: {
          query: options.query,
          totalElementsScanned: totalScanned,
          topScore: top.score,
          secondScore: second?.score || 0,
          scoreMargin,
          selectionRationale: `Selected highest-scoring result "${top.title}" (score: ${top.score}, margin: ${scoreMargin}): ${top.url}`,
        },
      };
    }


    // Default to the top candidate if no strong ambiguity was demonstrated
    return {
      status: "resolved",
      selectedCandidate: top,
      candidates: ranked,
      deduplicatedCount: ranked.length - distinctCards,
      distinctResultsCount: distinctCards,
      diagnostics: {
        query: options.query,
        totalElementsScanned: totalScanned,
        topScore: top.score,
        secondScore: second?.score || 0,
        scoreMargin,
        selectionRationale: `Selected top-ranked grounded candidate "${top.title}" (score: ${top.score}): ${top.url}`,
      },
    };
  }

  /**
   * Revalidates a candidate locator immediately before interaction.
   * If the element has become detached due to client hydration or dynamic re-render,
   * refreshes the locator against the active page DOM.
   */
  static async revalidateAndLocate(page: Page, candidate: SearchCandidate): Promise<Locator> {
    try {
      const isVis = await candidate.locator.isVisible({ timeout: 1500 }).catch(() => false);
      const isEn = await candidate.locator.isEnabled({ timeout: 1500 }).catch(() => false);

      if (isVis && isEn) {
        return candidate.locator;
      }
    } catch {
      // Element may be detached or stale
    }

    // Fallback: re-query in live DOM
    if (candidate.url) {
      try {
        const pathname = new URL(candidate.url).pathname;
        const fallback = page.locator(`a[href*="${pathname}"]`).first();
        if (await fallback.isVisible({ timeout: 2000 }).catch(() => false)) {
          return fallback;
        }
      } catch {
        // Fall through
      }
    }

    if (candidate.title) {
      const titleFallback = page.locator(`a:has-text("${candidate.title.slice(0, 35)}"), [title*="${candidate.title.slice(0, 35)}" i]`).first();
      if (await titleFallback.isVisible({ timeout: 2000 }).catch(() => false)) {
        return titleFallback;
      }
    }

    throw new AgentError(
      `Search result candidate "${candidate.title}" became detached or hidden from DOM before click.`,
      ErrorCode.ELEMENT_NOT_FOUND,
      true,
      { candidate }
    );
  }
}
