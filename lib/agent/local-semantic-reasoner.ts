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
    const clean = priceStr.replace(/[^0-9.]/g, "");
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

    // 1. Comparison: MIN (e.g. "cheapest laptop" or "cheapest laptop under ₹70,000")
    if (intent.comparison?.operation === "MIN") {
      let minItem = candidateItems[0];
      let minPrice = this.parsePrice(minItem.price);

      for (let i = 1; i < candidateItems.length; i++) {
        const p = this.parsePrice(candidateItems[i].price);
        if (p > 0 && (p < minPrice || minPrice === 0)) {
          minPrice = p;
          minItem = candidateItems[i];
        }
      }

      return {
        name: minItem.title || minItem.name,
        title: minItem.title || minItem.name,
        price: minItem.price,
        rawPrice: minPrice,
        comparedCount: candidateItems.length,
        filterApplied: filterAppliedText,
      };
    }

    // 2. Comparison: MAX (e.g. "most expensive laptop")
    if (intent.comparison?.operation === "MAX") {
      let maxItem = candidateItems[0];
      let maxPrice = this.parsePrice(maxItem.price);

      for (let i = 1; i < candidateItems.length; i++) {
        const p = this.parsePrice(candidateItems[i].price);
        if (p > maxPrice) {
          maxPrice = p;
          maxItem = candidateItems[i];
        }
      }

      return {
        name: maxItem.title || maxItem.name,
        title: maxItem.title || maxItem.name,
        price: maxItem.price,
        rawPrice: maxPrice,
        comparedCount: candidateItems.length,
        filterApplied: filterAppliedText,
      };
    }

    // 3. Aggregation: COUNT (e.g. "how many laptop results" or "count products under ₹70,000")
    if (intent.aggregation === "COUNT") {
      return {
        count: candidateItems.length,
        total: candidateItems.length,
        filterApplied: filterAppliedText,
        message: `Found ${candidateItems.length} matching ${intent.entity || "product"} results.`,
      };
    }

    // 4. Ordinal: e.g. second result (index 1)
    if (intent.ordinal) {
      let idx = intent.ordinal.index;
      if (idx === -1) idx = candidateItems.length - 1; // last
      const selected = candidateItems[idx] || candidateItems[0];
      return {
        name: selected.title || selected.name,
        title: selected.title || selected.name,
        price: selected.price,
        ordinalSelected: intent.ordinal.target,
        index: idx,
        filterApplied: filterAppliedText,
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
