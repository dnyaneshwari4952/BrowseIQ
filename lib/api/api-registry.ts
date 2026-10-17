import { z } from "zod";

export interface ApiEndpointDefinition {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  patterns: RegExp[];
  browserFallbackUrl: string;
  extractParameters: (taskText: string) => Record<string, string>;
}

export class ApiRegistry {
  private static endpoints: ApiEndpointDefinition[] = [
    {
      id: "dummyjson-products-api",
      name: "DummyJSON Products REST API (External Integration)",
      description: "External live public REST API for querying real-world catalog products and prices",
      endpoint: "https://dummyjson.com/products/search",
      method: "GET",
      patterns: [
        /\b(?:external|remote|public|dummyjson|live|rest)\b.*\b(?:api|endpoint|catalog|products?)\b/i,
        /\b(?:query|call|fetch)\b.*\b(?:dummyjson|external api)\b/i,
      ],
      browserFallbackUrl: "/test-fixtures/search",
      extractParameters: (taskText: string) => {
        const queryMatch =
          taskText.match(/['"]([^'"]+)['"]/i) ||
          taskText.match(/\b(?:for|named|called)\s+([a-zA-Z0-9_-]+)/i) ||
          taskText.match(/\b(laptop|phone|smartphone|mouse|keyboard|watch)\b/i);
        return {
          q: queryMatch ? queryMatch[1].trim() : "laptop",
        };
      },
    },
    {
      id: "products-api",
      name: "Product Catalog Search API (Local)",
      description: "Direct structured catalog search for products, electronics, laptops, and pricing",
      endpoint: "/api/products",
      method: "GET",
      patterns: [
        /\b(?:search|find|get|query|look up)\b.*\b(?:product|laptop|computer|mouse|keyboard|item|price)\b/i,
        /\b(?:products?|laptops?)\s+(?:catalog|api|list)\b/i,
      ],
      browserFallbackUrl: "/test-fixtures/search",
      extractParameters: (taskText: string) => {
        const queryMatch =
          taskText.match(/['"]([^'"]+)['"]/i) ||
          taskText.match(/\b(?:for|named|called)\s+([a-zA-Z0-9_-]+)/i) ||
          taskText.match(/\b(laptop|mouse|keyboard|electronics)\b/i);
        return {
          q: queryMatch ? queryMatch[1].trim() : "laptop",
        };
      },
    },
    {
      id: "invoice-download-api",
      name: "Invoice Download Service",
      description: "Direct invoice PDF document download",
      endpoint: "/api/test-fixtures/download-file",
      method: "GET",
      patterns: [/\b(?:download|fetch)\b.*\b(?:invoice|pdf|receipt|document)\b/i],
      browserFallbackUrl: "/test-fixtures/download",
      extractParameters: () => ({}),
    },
  ];

  static getAll(): ApiEndpointDefinition[] {
    return [...this.endpoints];
  }

  static findMatchingEndpoint(taskText: string): ApiEndpointDefinition | null {
    for (const ep of this.endpoints) {
      for (const pattern of ep.patterns) {
        if (pattern.test(taskText)) {
          return ep;
        }
      }
    }
    return null;
  }

  static getById(id: string): ApiEndpointDefinition | undefined {
    return this.endpoints.find((ep) => ep.id === id);
  }
}

