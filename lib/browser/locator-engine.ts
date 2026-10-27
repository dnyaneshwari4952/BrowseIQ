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
  reason?: string;
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
    const root = target.container ? page.locator(target.container) : page;

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

        // Check element visibility directly to safely eliminate hidden duplicates
        let visibleCount = 0;
        let firstVisibleIndex = -1;
        const countToCheck = Math.min(totalCount, 10);
        for (let i = 0; i < countToCheck; i++) {
          try {
            if (await locator.nth(i).isVisible()) {
              visibleCount++;
              if (firstVisibleIndex === -1) firstVisibleIndex = i;
            }
          } catch {
            // Detached or obscured
          }
        }

        const isVisible = visibleCount > 0;
        // If visible matches exist and hidden duplicates are present, scope to visible elements
        let effectiveLocator = locator;
        if (isVisible && visibleCount < totalCount && firstVisibleIndex !== -1) {
          if (visibleCount === 1) {
            effectiveLocator = locator.nth(firstVisibleIndex);
          } else {
            try {
              const visLoc = page.locator(`${selector}:visible`);
              if ((await visLoc.count()) > 0) {
                effectiveLocator = visLoc;
              } else {
                effectiveLocator = locator.nth(firstVisibleIndex);
              }
            } catch {
              effectiveLocator = locator.nth(firstVisibleIndex);
            }
          }
        }

        let enabled = true;
        try {
          enabled = await effectiveLocator.first().isEnabled({ timeout: Math.min(timeoutMs, 1000) });
        } catch {
          // Keep defaults
        }

        let score = baseScore;
        // Strongly favor explicitly requested strategy
        if (
          target.strategy &&
          (target.strategy === strategy || target.strategy.toLowerCase() === strategy.toLowerCase())
        ) {
          score += 50;
        }

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
      const loc = (root as any).getByRole(role as any, { name, exact: target.exact });
      await evaluateCandidate(LocatorStrategy.ROLE, `role=${role}[name="${name}"]`, loc, 100);
    }

    // 2. Associated Form Label
    if (target.strategy === LocatorStrategy.LABEL || target.value) {
      const loc = (root as any).getByLabel(target.value, { exact: target.exact });
      await evaluateCandidate(LocatorStrategy.LABEL, `label="${target.value}"`, loc, 90);
    }

    // 3. Placeholder Text (Regex case-insensitive without trailing dots)
    if (target.strategy === LocatorStrategy.PLACEHOLDER || target.value) {
      try {
        const cleanPlaceholder = target.value.replace(/\.+$/, "").trim();
        const loc = (root as any).getByPlaceholder(new RegExp(cleanPlaceholder, "i"));
        await evaluateCandidate(LocatorStrategy.PLACEHOLDER, `placeholder=~/${cleanPlaceholder}/i`, loc, 80);
      } catch {
        const loc = (root as any).getByPlaceholder(target.value, { exact: false });
        await evaluateCandidate(LocatorStrategy.PLACEHOLDER, `placeholder="${target.value}"`, loc, 80);
      }
    }

    // Contextual Search input fallback
    if (
      target.value?.toLowerCase().includes("search") ||
      target.value?.toLowerCase().includes("play") ||
      target.role === "searchbox"
    ) {
      const searchLoc = root.locator(
        'input[type="search"], input[data-testid*="search" i], input[role="searchbox"], input[placeholder*="play" i], input[placeholder*="search" i], input[name*="search" i], input[name="search_query"], input[name="q"], input[aria-label*="search" i], input[aria-label*="play" i], textarea[aria-label*="search" i]'
      );
      await evaluateCandidate(LocatorStrategy.CSS, 'input[search]', searchLoc, 78);
    }

    // 4. Explicit Accessible Attributes (aria-label, title) (Section 2, Tier 4)
    if (target.strategy === LocatorStrategy.ACCESSIBLE_ATTR || target.value) {
      const escaped = target.value.replace(/"/g, '\\"');
      const ariaLoc = root.locator(`[aria-label="${escaped}" i], [title="${escaped}" i]`);
      await evaluateCandidate(LocatorStrategy.ACCESSIBLE_ATTR, `[aria-label="${escaped}"]`, ariaLoc, 75);
    }

    // 5. Visible Text Content
    if (target.strategy === LocatorStrategy.TEXT || target.value) {
      const loc = (root as any).getByText(target.value, { exact: target.exact });
      await evaluateCandidate(LocatorStrategy.TEXT, `text="${target.value}"`, loc, 70);
    }

    // 5. Stable data-testid Attribute
    if (target.strategy === LocatorStrategy.TEST_ID || target.value) {
      const loc = (root as any).getByTestId(target.value);
      await evaluateCandidate(LocatorStrategy.TEST_ID, `data-testid="${target.value}"`, loc, 65);
    }

    // 6. Name Attribute
    if (target.strategy === LocatorStrategy.NAME || target.value) {
      const escaped = target.value.replace(/"/g, '\\"');
      const loc = root.locator(`[name="${escaped}"]`);
      await evaluateCandidate(LocatorStrategy.NAME, `[name="${escaped}"]`, loc, 60);
    }

    // 7. Stable ID (Reject auto-generated/dynamic IDs with random digits or synthetic prefix)
    if (target.strategy === LocatorStrategy.ID || target.value) {
      const val = target.value.startsWith("#") ? target.value.slice(1) : target.value;
      const isDynamic = /^[a-z0-9_-]*\d{6,}[a-z0-9_-]*$/i.test(val) || val.startsWith("elem-");
      if (!isDynamic) {
        const loc = root.locator(`#${val}`);
        await evaluateCandidate(LocatorStrategy.ID, `#${val}`, loc, 50);
      }
    }

    // 8. CSS Selector
    if (target.strategy === LocatorStrategy.CSS) {
      const loc = root.locator(target.value);
      await evaluateCandidate(LocatorStrategy.CSS, target.value, loc, 40);
    }

    // 9. XPath (Last resort)
    if (target.strategy === LocatorStrategy.XPATH || target.value.startsWith("//")) {
      const loc = root.locator(`xpath=${target.value}`);
      await evaluateCandidate(LocatorStrategy.XPATH, target.value, loc, 30);
    }

    // Progressive fallback query if priority evaluators found 0 candidates
    if (candidates.length === 0 && target.value) {
      try {
        const cleanVal = target.value.trim();
        const roleCandidate = (root as any).getByRole("button", { name: new RegExp(cleanVal, "i") });
        await evaluateCandidate(LocatorStrategy.ROLE, `role=button[name=~/${cleanVal}/i]`, roleCandidate, 85);
        if (candidates.length === 0) {
          const textCandidate = (root as any).getByText(new RegExp(cleanVal, "i"));
          await evaluateCandidate(LocatorStrategy.TEXT, `text=~/${cleanVal}/i`, textCandidate, 70);
        }
      } catch {
        // Fallback query
      }
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
          reason: `Resolved via unambiguous unique visible alternative strategy '${uniqueCandidate.strategy}'`,
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
          reason: `Resolved via visible candidate strategy '${visibleCandidate.strategy}' over hidden higher-priority matches`,
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
      reason: `Resolved via strategy '${best.strategy}' with ${best.visibleCount} visible match(es) (score ${best.score})`,
      allCandidates: candidates,
    };
  }

  /**
   * Validates whether a previously resolved locator is still attached, visible, and actionable.
   * If stale or detached, returns false, signaling that fresh page observations are required.
   */
  static async isLocatorFresh(locator?: Locator, timeoutMs = 1000): Promise<boolean> {
    if (!locator) return false;
    try {
      const count = await locator.count();
      if (count === 0) return false;
      return await locator.first().isVisible({ timeout: timeoutMs });
    } catch {
      return false;
    }
  }
}
