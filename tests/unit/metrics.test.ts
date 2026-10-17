import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "@/lib/observability/metrics";

describe("MetricsCollector", () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it("initializes with zeroed metrics", () => {
    const data = metrics.getMetrics();
    expect(data.totalTasks).toBe(0);
    expect(data.falseActionRate).toBe(0);
    expect(data.taskSuccessRate).toBe(0);
  });

  it("correctly calculates false-action rate per Section 33 formula", () => {
    metrics.recordTask({
      success: true,
      durationMs: 2500,
      plannedActions: 10,
      validatedActions: 8,
      rejectedActions: 2,
      executedActions: 8,
      incorrectlyExecutedActions: 1,
      retries: 1,
      replans: 0,
      route: "browser",
    });

    const data = metrics.getMetrics();
    expect(data.totalTasks).toBe(1);
    expect(data.successfulTasks).toBe(1);
    expect(data.taskSuccessRate).toBe(1.0);
    expect(data.totalPlannedActions).toBe(10);
    expect(data.totalRejectedActions).toBe(2);
    expect(data.incorrectlyExecutedActions).toBe(1);

    // False Action Rate = (2 rejected + 1 incorrect) / 10 planned = 3/10 = 0.3
    expect(data.falseActionRate).toBe(0.3);
  });
});
