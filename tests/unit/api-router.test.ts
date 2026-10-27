import { describe, it, expect } from "vitest";
import { ApiRouter } from "@/lib/api/api-router";
import { ApiRegistry } from "@/lib/api/api-registry";
import { ApiExecutor, ApiErrorCode } from "@/lib/api/api-executor";

describe("ApiRouter & Registry (Part 13 & 15)", () => {
  it("routes structured product queries to the API route", () => {
    const task = "Query product catalog API for laptops";
    const decision = ApiRouter.decideRoute(task);

    expect(decision.route).toBe("api");
    expect(decision.confidence).toBeGreaterThan(0.9);
    expect(decision.fallbackAvailable).toBe(true);
    expect(decision.apiIntegrationId).toBe("products-api");
  });

  it("routes explicit web interactions requiring browser UI to the browser route", () => {
    const task = "Click the submit button on the form";
    const decision = ApiRouter.decideRoute(task);

    expect(decision.route).toBe("browser");
    expect(decision.fallbackAvailable).toBe(false);
  });

  it("respects forceBrowser flag even when API is available", () => {
    const task = "Find product price for laptop";
    const decision = ApiRouter.decideRoute(task, { forceBrowser: true });

    expect(decision.route).toBe("browser");
  });

  it("extracts parameters correctly from task queries in registry", () => {
    const ep = ApiRegistry.getById("products-api")!;
    const params = ep.extractParameters("search for 'gaming laptop' on catalog");

    expect(params.q.toLowerCase()).toBe("gaming laptop");
  });

  it("CLASSIFY ERROR: correctly identifies AUTH_ERROR and disallows bypass fallback", () => {
    const authCode401 = ApiExecutor.classifyError(401, "Unauthorized");
    const authCode403 = ApiExecutor.classifyError(403, "Forbidden");
    const serverCode500 = ApiExecutor.classifyError(500, "Internal Server Error");
    const rateLimitCode429 = ApiExecutor.classifyError(429, "Too Many Requests");

    expect(authCode401).toBe(ApiErrorCode.AUTH_ERROR);
    expect(authCode403).toBe(ApiErrorCode.AUTH_ERROR);
    expect(serverCode500).toBe(ApiErrorCode.SERVER_ERROR);
    expect(rateLimitCode429).toBe(ApiErrorCode.RATE_LIMIT);
  });

  it("SCHEMA VALIDATION: products endpoint has defined responseSchema that validates arrays", () => {
    const ep = ApiRegistry.getById("products-api")!;
    expect(ep.responseSchema).toBeDefined();

    const validPayload = { products: [{ id: 1, title: "Laptop Pro", price: "₹75,000" }] };
    const invalidPayload = { products: "not-an-array" };

    expect(ep.responseSchema!.safeParse(validPayload).success).toBe(true);
    expect(ep.responseSchema!.safeParse(invalidPayload).success).toBe(false);
  });
});
