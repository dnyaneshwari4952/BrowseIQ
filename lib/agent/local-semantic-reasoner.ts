import { TaskIntent } from "../types/plans";

export interface RawProductItem {
  title?: string;
  name?: string;
  price?: string | number;
  [key: string]: unknown;
}

export class LocalSemanticReasoner {
  /**
   * Normalizes arbitrary price strings (e.g. "₹65,000", "$65,000.00", "65000") into numeric value
   */
  static parsePrice(priceStr?: unknown): number {
    if (typeof priceStr === "number") return priceStr;
    if (!priceStr || typeof priceStr !== "string") return 0;
    // Extract first valid numeric group (e.g. "65,000" or "65000.00")
    const match = priceStr.match(/[\d]+(?:,\d{3})*(?:\.\d+)?/);
    if (!match) return 0;
    const clean = match[0].replace(/,/g, "");
    return parseFloat(clean) || 0;
  }

  /**
   * Evaluates structured extracted data against high-level TaskIntent
   * (MIN, MAX, COUNT, FILTER, ORDINAL)
   */
  static evaluate(items: RawProductItem[], intent: TaskIntent): Record<string, unknown> {
    if (!items || items.length === 0) {
      return {
        results: [],
        total: 0,
        found: false,
        message: `No results found for entity: ${intent.entity || "query"}`,
      };
    }

    let candidateItems = [...items];
    let filterAppliedText: string | undefined = undefined;

    // Filter by entity if specified and items contain entity matches (Semantic Grounding)
    if (intent.entity && !["product", "products", "item", "items", "eligible", "matching"].includes(intent.entity)) {
      const entityLower = intent.entity.toLowerCase();
      const entityFiltered = candidateItems.filter((item) => {
        const titleLower = String(item.title || item.name || "").toLowerCase();
        const catLower = String(item.category || "").toLowerCase();
        // Generalized token matching across title and category
        const fullText = `${titleLower} ${catLower}`;
        if (fullText.includes(entityLower)) return true;

        const words = entityLower.split(/\s+/).filter((w) => w.length > 2);
        if (words.length > 0 && words.some((w) => fullText.includes(w) || fullText.includes(w.slice(0, -1)))) {
          return true;
        }

        // Standard category synonyms
        if (entityLower === "laptop" || entityLower === "notebook" || entityLower === "portable computer" || entityLower === "netbook") {
          return fullText.includes("laptop") || fullText.includes("notebook") || fullText.includes("netbook") || fullText.includes("ultrabook");
        }
        if (entityLower === "phone" || entityLower === "smartphone") {
          return fullText.includes("phone");
        }
        return false;
      });
      if (entityFiltered.length > 0) {
        candidateItems = entityFiltered;
      } else {
        return {
          results: [],
          total: 0,
          found: false,
          message: `No results found for entity: ${intent.entity}`,
        };
      }
    }

    // Apply window limit if requested (e.g. "compare the first three matching products")
    if (intent.windowLimit && intent.windowLimit > 0) {
      candidateItems = candidateItems.slice(0, intent.windowLimit);
    }

    // Apply Filter first if present (e.g. price < 70000 or price < 30000)
    if (intent.filter) {
      const { field, operator, value } = intent.filter;
      const numVal = typeof value === "number" ? value : parseFloat(String(value));

      candidateItems = candidateItems.filter((item) => {
        const itemVal = field === "price" ? this.parsePrice(item.price) : Number(item[field] || 0);
        switch (operator) {
          case "<":
            return itemVal < numVal;
          case "<=":
            return itemVal <= numVal;
          case ">":
            return itemVal > numVal;
          case ">=":
            return itemVal >= numVal;
          case "==":
            return itemVal === numVal;
          case "!=":
            return itemVal !== numVal;
          default:
            return true;
        }
      });
      filterAppliedText = `${field} ${operator} ${value}`;

      if (candidateItems.length === 0) {
        return {
          results: [],
          products: [],
          total: 0,
          count: 0,
          found: false,
          filterApplied: filterAppliedText,
          message: `No products found matching filter constraint (${filterAppliedText})`,
        };
      }
    }

    // 1. Comparison: MIN (e.g. "cheapest laptop" or "cheapest laptop under ₹70,000" or "second-cheapest item")
    if (intent.comparison?.operation === "MIN") {
      const validItems = candidateItems.filter((i) => this.parsePrice(i.price) > 0);
      if (validItems.length === 0) {
        return {
          results: [],
          found: false,
          priceUnavailable: true,
          total: candidateItems.length,
          message: "No products with valid pricing information were found to compare.",
          comparedCount: candidateItems.length,
          filterApplied: filterAppliedText,
        };
      }

      // If ordinal rank is specified with MIN (e.g. "second-cheapest", rank 2)
      if (intent.ordinal) {
        validItems.sort((a, b) => this.parsePrice(a.price) - this.parsePrice(b.price));
        let ordIdx = intent.ordinal.index;
        if (ordIdx === -1) ordIdx = validItems.length - 1;
        if (ordIdx >= validItems.length) {
          return {
            results: [],
            found: false,
            outOfRange: true,
            message: `Requested ordinal rank ${ordIdx + 1} (${intent.ordinal.target}) is out of range. Only ${validItems.length} products have valid pricing.`,
          };
        }
        const selected = validItems[ordIdx];
        const numPrice = this.parsePrice(selected.price);
        return {
          found: true,
          name: selected.title || selected.name,
          title: selected.title || selected.name,
          price: selected.price,
          rawPrice: numPrice,
          ordinalRank: intent.ordinal.target,
          comparedCount: candidateItems.length,
          filterApplied: filterAppliedText,
          provenance: {
            comparedCount: candidateItems.length,
            selectedTitle: selected.title || selected.name,
            selectedPrice: selected.price,
            rawNumericPrice: numPrice,
            entityFilter: intent.entity,
            timestamp: new Date().toISOString(),
          },
        };
      }

      let minItem = validItems[0];
      let minPrice = this.parsePrice(minItem.price);

      for (let i = 1; i < validItems.length; i++) {
        const p = this.parsePrice(validItems[i].price);
        if (p < minPrice) {
          minPrice = p;
          minItem = validItems[i];
        }
      }

      // Sort candidate options to report cheapest observed options (Phase 3 Requirement 7)
      const sortedValid = [...validItems].sort((a, b) => this.parsePrice(a.price) - this.parsePrice(b.price));
      const topOptions = sortedValid.slice(0, 5).map((item) => ({
        title: item.title || item.name,
        displayedPrice: item.price,
        numericPrice: this.parsePrice(item.price),
      }));

      return {
        found: true,
        name: minItem.title || minItem.name,
        title: minItem.title || minItem.name,
        price: minItem.price,
        rawPrice: minPrice,
        comparedCount: candidateItems.length,
        filterApplied: filterAppliedText,
        cheapestObserved: {
          title: minItem.title || minItem.name,
          displayedPrice: minItem.price,
          numericPrice: minPrice,
        },
        topOptions,
        pricingNotice: "Reported lowest displayed price observed on catalog listing. Final payable price may differ based on taxes, shipping, or seller checkout terms.",
        provenance: {
          comparedCount: candidateItems.length,
          selectedTitle: minItem.title || minItem.name,
          selectedPrice: minItem.price,
          rawNumericPrice: minPrice,
          entityFilter: intent.entity,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // 2. Comparison: MAX (e.g. "most expensive laptop")
    if (intent.comparison?.operation === "MAX") {
      const validItems = candidateItems.filter((i) => this.parsePrice(i.price) > 0);
      if (validItems.length === 0) {
        return {
          results: [],
          found: false,
          priceUnavailable: true,
          total: candidateItems.length,
          message: "No products with valid pricing information were found to compare.",
          comparedCount: candidateItems.length,
          filterApplied: filterAppliedText,
        };
      }

      let maxItem = validItems[0];
      let maxPrice = this.parsePrice(maxItem.price);

      for (let i = 1; i < validItems.length; i++) {
        const p = this.parsePrice(validItems[i].price);
        if (p > maxPrice) {
          maxPrice = p;
          maxItem = validItems[i];
        }
      }

      return {
        name: maxItem.title || maxItem.name,
        title: maxItem.title || maxItem.name,
        price: maxItem.price,
        rawPrice: maxPrice,
        comparedCount: candidateItems.length,
        filterApplied: filterAppliedText,
        provenance: {
          comparedCount: candidateItems.length,
          selectedTitle: maxItem.title || maxItem.name,
          selectedPrice: maxItem.price,
          rawNumericPrice: maxPrice,
          entityFilter: intent.entity,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // 3. Multi-item Window Selection (e.g. "show me the three most affordable matching products")
    if (intent.windowLimit && intent.windowLimit > 0 && candidateItems.length > 0) {
      const validItems = candidateItems.filter((i) => this.parsePrice(i.price) > 0);
      validItems.sort((a, b) => this.parsePrice(a.price) - this.parsePrice(b.price));
      const topN = validItems.slice(0, intent.windowLimit);
      return {
        results: topN,
        products: topN,
        total: topN.length,
        count: topN.length,
        found: true,
        filterApplied: filterAppliedText,
        provenance: {
          comparedCount: candidateItems.length,
          returnedCount: topN.length,
          windowLimit: intent.windowLimit,
          entityFilter: intent.entity,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // 4. Aggregation: COUNT (e.g. "how many laptop results" or "count products under ₹70,000")
    if (intent.aggregation === "COUNT") {
      return {
        count: candidateItems.length,
        total: candidateItems.length,
        filterApplied: filterAppliedText,
        message: `Found ${candidateItems.length} matching ${intent.entity || "product"} results.`,
        provenance: {
          comparedCount: candidateItems.length,
          entityFilter: intent.entity,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // 5. Ordinal: e.g. second result (index 1)
    if (intent.ordinal) {
      let idx = intent.ordinal.index;
      if (idx === -1) idx = candidateItems.length - 1; // last
      if (idx >= candidateItems.length) {
        return {
          results: [],
          found: false,
          outOfRange: true,
          message: `Requested ordinal index ${idx + 1} (${intent.ordinal.target}) is out of range. Page contains only ${candidateItems.length} items.`,
        };
      }
      const selected = candidateItems[idx];
      return {
        name: selected.title || selected.name,
        title: selected.title || selected.name,
        price: selected.price,
        ordinalSelected: intent.ordinal.target,
        index: idx,
        filterApplied: filterAppliedText,
        provenance: {
          comparedCount: candidateItems.length,
          selectedIndex: idx,
          selectedTitle: selected.title || selected.name,
          timestamp: new Date().toISOString(),
        },
      };
    }

    // 5. Filter only (when no MIN/MAX/COUNT/ORDINAL specified)
    if (filterAppliedText) {
      return {
        results: candidateItems,
        products: candidateItems,
        count: candidateItems.length,
        total: candidateItems.length,
        name: candidateItems[0]?.title || candidateItems[0]?.name,
        title: candidateItems[0]?.title || candidateItems[0]?.name,
        price: candidateItems[0]?.price,
        filterApplied: filterAppliedText,
      };
    }

    // Default: return first item or list
    const first = candidateItems[0];
    return {
      title: first?.title || first?.name,
      name: first?.title || first?.name,
      price: first?.price,
      total: candidateItems.length,
      results: candidateItems,
    };

  }
}
