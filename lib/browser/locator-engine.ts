import { Page, Locator } from "playwright";
import { ElementTarget, LocatorStrategy } from "../types/actions";
import { ErrorCode, AgentError } from "../types/errors";

export interface ScoredCandidate {
  strategy: (typeof LocatorStrategy)[keyof typeof LocatorStrategy];
  selector: string;
  locator: Locator;
  score: number;
  matchCount: number;
  visibleCount: number;
  isVisible: boolean;
  isEnabled: boolean;
}

export interface LocatorResolutionResult {
  locator: Locator;
  strategyUsed: (typeof LocatorStrategy)[keyof typeof LocatorStrategy];
  confidence: number;
  allCandidates: ScoredCandidate[];
}

/**
 * Robust Semantic Locator Engine (Part 7)
 * Implements strict 9-tier priority fallback hierarchy and ambiguity detection.
 *
 * Priority:
 * 1. Role + Accessible Name (100)
 * 2. Label (90)
 * 3. Placeholder (80)
 * 4. Visible Text (70)
 * 5. data-testid (65)
 * 6. Name attribute (60)
 * 7. Stable ID (50)
 * 8. CSS Selector (40)
 * 9. XPath (30 - last resort)
 */
export class LocatorEngine {
  /**
   * Resolves a target element using the priority fallback hierarchy.
   */
  static async resolve(page: Page, target: ElementTarget, timeoutMs = 5000): Promise<LocatorResolutionResult> {
    const candidates: ScoredCandidate[] = [];

    // Helper to evaluate a locator candidate
    const evaluateCandidate = async (
      strategy: (typeof LocatorStrategy)[keyof typeof LocatorStrategy],
      selector: string,
      locator: Locator,
      baseScore: number
    ) => {
      try {
        const totalCount = await locator.count();
        if (totalCount === 0) return;

        // Filter for visible elements to eliminate hidden duplicates (e.g. <input type="hidden" name="q">)
        const visibleLocator = locator.filter({ visible: true });
        let visibleCount = 0;
        try {
          visibleCount = await visibleLocator.count();
        } catch {
          visibleCount = 0;
        }

        const isVisible = visibleCount > 0;
        // If visible matches exist, scope the candidate locator to visible elements.
        // Otherwise retain raw locator so downstream validator can diagnose ELEMENT_NOT_VISIBLE accurately.
        const effectiveLocator = isVisible ? visibleLocator : locator;

        let enabled = true;
        try {
          enabled = await effectiveLocator.first().isEnabled({ timeout: Math.min(timeoutMs, 1000) });
        } catch {
          // Keep defaults
        }

        let score = baseScore;
        // Boost unambiguous visible matches; penalize genuine visible ambiguity
        if (visibleCount === 1) {
          score += 15; // Strongly favor single visible element even if hidden DOM duplicates exist
        } else if (visibleCount > 1) {
          score -= 25; // Genuine ambiguity among visible elements
        } else if (totalCount === 1) {
          score += 5;
        } else {
          score -= 20;
        }

        if (isVisible) score += 10;
        if (enabled) score += 5;

        candidates.push({
          strategy,
          selector,
          locator: effectiveLocator,
          score,
          matchCount: totalCount,
          visibleCount,
          isVisible,
          isEnabled: enabled,
        });
      } catch {
        // Selector syntax error or detached
      }
    };

    // 1. Accessibility Role + Name
    if (target.role || target.strategy === LocatorStrategy.ROLE) {
      const role = target.role || "button";
      const name = target.name || target.value;
      const loc = page.getByRole(role as any, { name, exact: target.exact });
      await evaluateCandidate(LocatorStrategy.ROLE, `role=${role}[name="${name}"]`, loc, 100);
    }

    // 2. Associated Form Label
    if (target.strategy === LocatorStrategy.LABEL || target.value) {
      const loc = page.getByLabel(target.value, { exact: target.exact });
      await evaluateCandidate(LocatorStrategy.LABEL, `label="${target.value}"`, loc, 90);
    }

    // 3. Placeholder Text (Regex case-insensitive without trailing dots)
    if (target.strategy === LocatorStrategy.PLACEHOLDER || target.value) {
      try {
        const cleanPlaceholder = target.value.replace(/\.+$/, "").trim();
        const loc = page.getByPlaceholder(new RegExp(cleanPlaceholder, "i"));
        await evaluateCandidate(LocatorStrategy.PLACEHOLDER, `placeholder=~/${cleanPlaceholder}/i`, loc, 80);
      } catch {
        const loc = page.getByPlaceholder(target.value, { exact: false });
        await evaluateCandidate(LocatorStrategy.PLACEHOLDER, `placeholder="${target.value}"`, loc, 80);
      }
    }

    // Contextual Search input fallback
    if (target.value?.toLowerCase().includes("search") || target.role === "searchbox") {
      const searchLoc = page.locator(
        'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i]'
      );
      await evaluateCandidate(LocatorStrategy.CSS, 'input[search]', searchLoc, 78);
    }

    // 4. Visible Text Content
    if (target.strategy === LocatorStrategy.TEXT || target.value) {
      const loc = page.getByText(target.value, { exact: target.exact });
      await evaluateCandidate(LocatorStrategy.TEXT, `text="${target.value}"`, loc, 70);
    }

    // 5. Stable data-testid Attribute
    if (target.strategy === LocatorStrategy.TEST_ID || target.value) {
      const loc = page.getByTestId(target.value);
      await evaluateCandidate(LocatorStrategy.TEST_ID, `data-testid="${target.value}"`, loc, 65);
    }

    // 6. Name Attribute
    if (target.strategy === LocatorStrategy.NAME || target.value) {
      const escaped = target.value.replace(/"/g, '\\"');
      const loc = page.locator(`[name="${escaped}"]`);
      await evaluateCandidate(LocatorStrategy.NAME, `[name="${escaped}"]`, loc, 60);
    }

    // 7. Stable ID (Reject auto-generated/dynamic IDs with random digits)
    if (target.strategy === LocatorStrategy.ID || target.value) {
      const val = target.value.startsWith("#") ? target.value.slice(1) : target.value;
      const isDynamic = /^[a-z0-9_-]*\d{6,}[a-z0-9_-]*$/i.test(val);
      if (!isDynamic) {
        const loc = page.locator(`#${val}`);
        await evaluateCandidate(LocatorStrategy.ID, `#${val}`, loc, 50);
      }
    }

    // 8. CSS Selector
    if (target.strategy === LocatorStrategy.CSS) {
      const loc = page.locator(target.value);
      await evaluateCandidate(LocatorStrategy.CSS, target.value, loc, 40);
    }

    // 9. XPath (Last resort)
    if (target.strategy === LocatorStrategy.XPATH || target.value.startsWith("//")) {
      const loc = page.locator(`xpath=${target.value}`);
      await evaluateCandidate(LocatorStrategy.XPATH, target.value, loc, 30);
    }

    // If no candidate matched at all
    if (candidates.length === 0) {
      throw new AgentError(
        `Target element not found using any locator strategy: "${target.value}"`,
        ErrorCode.ELEMENT_NOT_FOUND,
        true,
        { target }
      );
    }

    // Sort candidates by score descending
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Ambiguity detection (Part 7 & 13):
    // Only throw ambiguity if multiple VISIBLE elements match and target.index is not specified.
    if (best.visibleCount > 1) {
      // Check if there are other candidates that are unique and visible
      const uniqueCandidate = candidates.find((c) => c.visibleCount === 1 && c.isVisible);
      if (uniqueCandidate) {
        const resolvedLoc = target.index !== undefined ? uniqueCandidate.locator.nth(target.index) : uniqueCandidate.locator.first();
        return {
          locator: resolvedLoc,
          strategyUsed: uniqueCandidate.strategy,
          confidence: Number((uniqueCandidate.score / 120).toFixed(2)),
          allCandidates: candidates,
        };
      }

      // Disallow unindexed ambiguity on interactive controls with multiple visible candidates
      if (target.index === undefined) {
        throw new AgentError(
          `Target "${target.value}" matches ${best.visibleCount} ambiguous elements. Disambiguation or container scoping required.`,
          ErrorCode.ELEMENT_AMBIGUOUS,
          true,
          { target, matchCount: best.visibleCount, strategy: best.strategy }
        );
      }
    } else if (best.visibleCount === 0 && best.matchCount > 1) {
      // If best candidate has only hidden elements, check if any other candidate is visible
      const visibleCandidate = candidates.find((c) => c.isVisible);
      if (visibleCandidate) {
        const resolvedLoc = target.index !== undefined ? visibleCandidate.locator.nth(target.index) : visibleCandidate.locator.first();
        return {
          locator: resolvedLoc,
          strategyUsed: visibleCandidate.strategy,
          confidence: Number((visibleCandidate.score / 120).toFixed(2)),
          allCandidates: candidates,
        };
      }
    }

    // If index was specified, scope to index; otherwise use the first matching (visible) element
    const resolvedLocator = target.index !== undefined ? best.locator.nth(target.index) : best.locator.first();

    return {
      locator: resolvedLocator,
      strategyUsed: best.strategy,
      confidence: Number(Math.min(1.0, best.score / 120).toFixed(2)),
      allCandidates: candidates,
    };
  }
}
