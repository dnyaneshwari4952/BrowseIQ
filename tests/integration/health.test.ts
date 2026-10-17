import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("Health Check API Route", () => {
  it("returns healthy status with system telemetry", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.status).toBe("healthy");
    expect(json.timestamp).toBeDefined();
    expect(json.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(json.system).toBeDefined();
    expect(json.system.browserHeadless).toBe(true);
    expect(json.system.llmProvider).toBe("openai");
    expect(json.metrics).toBeDefined();
    expect(json.metrics.falseActionRate).toBe(0);
  });
});
