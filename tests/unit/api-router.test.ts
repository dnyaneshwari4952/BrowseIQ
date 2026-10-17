import { describe, it, expect } from "vitest";
import { ApiRouter } from "@/lib/api/api-router";
import { ApiRegistry } from "@/lib/api/api-registry";

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
});
