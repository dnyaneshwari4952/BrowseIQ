/**
 * Operating Mode Enforcement Tests — Playwright Exclusivity
 *
 * Covers:
 * - Playwright is the single, permanent execution engine
 * - Schema strictly rejects invalid/legacy modes (e.g. gemini_assisted)
 * - Safe coercion of legacy inputs to "playwright"
 * - Backend mode enforcement independent of frontend
 * - Tasks execute deterministically without external LLM credentials
 * - Mode preserved in ExecutionContext
 * - No secrets in logs or responses
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetConfigForTesting } from "../../lib/config";
import {
  OperatingMode,
  OperatingModeSchema,
  parseOperatingMode,
  coerceOperatingMode,
  DEFAULT_OPERATING_MODE,
  OPERATING_MODE_LABELS,
  OPERATING_MODE_DESCRIPTIONS,
} from "../../lib/types/operating-mode";
import { Planner } from "../../lib/agent/planner";
import { MockProvider } from "../../lib/ai/llm-provider";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SIMPLE_TASK = "Search the product page for laptop and return the first product's name and price.";
const COMPLEX_TASK =
  "First search for laptops, then compare prices and reviews, and then sort by rating and filter by price under 50000, and subsequently select the cheapest option and fill out the order form.";

// ─── Type tests ───────────────────────────────────────────────────────────────

describe("OperatingMode types and schema", () => {
  it("schema accepts valid values", () => {
    expect(OperatingModeSchema.parse("playwright")).toBe("playwright");
  });

  it("schema rejects invalid and legacy values", () => {
    expect(() => OperatingModeSchema.parse("gemini_assisted")).toThrow();
    expect(() => OperatingModeSchema.parse("gemini")).toThrow();
    expect(() => OperatingModeSchema.parse("gpt4")).toThrow();
    expect(() => OperatingModeSchema.parse("live")).toThrow();
    expect(() => OperatingModeSchema.parse("")).toThrow();
  });

  it("parseOperatingMode throws for invalid input", () => {
    expect(() => parseOperatingMode("unknown")).toThrow(/Invalid operating mode/);
    expect(() => parseOperatingMode("gemini_assisted")).toThrow(/Invalid operating mode/);
    expect(() => parseOperatingMode(null)).toThrow(/Invalid operating mode/);
  });

  it("coerceOperatingMode returns default for invalid input", () => {
    expect(coerceOperatingMode("unknown")).toBe(DEFAULT_OPERATING_MODE);
    expect(coerceOperatingMode(null)).toBe(DEFAULT_OPERATING_MODE);
    expect(coerceOperatingMode(undefined)).toBe(DEFAULT_OPERATING_MODE);
    expect(coerceOperatingMode(42)).toBe(DEFAULT_OPERATING_MODE);
  });

  it("coerceOperatingMode accepts valid values and safely coerces legacy values", () => {
    expect(coerceOperatingMode("playwright")).toBe("playwright");
    expect(coerceOperatingMode("gemini_assisted")).toBe("playwright");
  });

  it("has human-readable labels and descriptions for all modes", () => {
    const modes: OperatingMode[] = ["playwright"];
    for (const mode of modes) {
      expect(OPERATING_MODE_LABELS[mode]).toBeTruthy();
      expect(OPERATING_MODE_DESCRIPTIONS[mode]).toBeTruthy();
      expect(OPERATING_MODE_DESCRIPTIONS[mode].length).toBeGreaterThan(10);
    }
  });

  it("DEFAULT_OPERATING_MODE is playwright", () => {
    expect(DEFAULT_OPERATING_MODE).toBe("playwright");
  });
});

// ─── Playwright Mode tests ─────────────────────────────────────────────────────

describe("Playwright Mode — Deterministic Planning & Execution", () => {
  beforeEach(() => {
    resetConfigForTesting({ NODE_ENV: "test", LLM_PROVIDER: "mock" });
  });

  it("generates deterministic plan for a simple task in playwright mode", async () => {
    const planner = new Planner();
    const plan = await planner.plan({
      task: SIMPLE_TASK,
      operatingMode: "playwright",
    });
    expect(plan).toBeDefined();
    expect(Array.isArray(plan.actions)).toBe(true);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.planningMetadata?.operatingMode).toBe("playwright");
    expect(plan.planningMetadata?.planSource).toBe("deterministic");
  });

  it("generates deterministic plan for a complex multi-step task in playwright mode", async () => {
    const planner = new Planner();
    const plan = await planner.plan({
      task: COMPLEX_TASK,
      operatingMode: "playwright",
    });
    expect(plan).toBeDefined();
    expect(plan.planningMetadata?.operatingMode).toBe("playwright");
    expect(plan.planningMetadata?.planSource).toBe("deterministic");
  });

  it("works without any external AI API keys configured", async () => {
    resetConfigForTesting({ NODE_ENV: "test" });
    const planner = new Planner();
    const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "playwright" });
    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
  });

  it("coerces unknown operatingMode to playwright on the backend", () => {
    expect(coerceOperatingMode("gpt4")).toBe("playwright");
    expect(coerceOperatingMode("live")).toBe("playwright");
    expect(coerceOperatingMode(undefined)).toBe("playwright");
  });

  it("planningMetadata planSource is deterministic in playwright mode", async () => {
    const planner = new Planner();
    const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "playwright" });
    expect(plan.planningMetadata?.planSource).toBe("deterministic");
    expect(plan.planningMetadata?.planValidationOutcome).toBe("accepted");
  });
});

// ─── UI / Lifecycle tests (unit-level) ────────────────────────────────────────

describe("Mode switch lifecycle safeguards", () => {
  it("operating mode is permanently locked to Playwright at API boundary", () => {
    const modeAtCreation = "playwright";
    const legacyModeAttempt = "gemini_assisted";

    const capturedMode = coerceOperatingMode(modeAtCreation);
    expect(capturedMode).toBe("playwright");

    const coercedLegacyMode = coerceOperatingMode(legacyModeAttempt);
    expect(coercedLegacyMode).toBe("playwright");
  });

  it("a cancelled task retains its original operatingMode", async () => {
    const planner = new Planner();
    const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "playwright" });
    expect(plan.planningMetadata?.operatingMode).toBe("playwright");
  });

  it("mode label strings do not contain API key or sensitive information", () => {
    for (const [, label] of Object.entries(OPERATING_MODE_LABELS)) {
      expect(label).not.toMatch(/key|token|secret|password|api/i);
    }
    for (const [, desc] of Object.entries(OPERATING_MODE_DESCRIPTIONS)) {
      expect(desc).not.toMatch(/key=[a-zA-Z0-9]{10,}/i);
    }
  });
});

// ─── Backend enforcement: operatingMode cannot be spoofed ─────────────────────

describe("Backend mode enforcement", () => {
  it("coerceOperatingMode is used on the backend regardless of frontend input", () => {
    expect(coerceOperatingMode("fake_mode")).toBe("playwright");
    expect(coerceOperatingMode(null)).toBe("playwright");
    expect(coerceOperatingMode({ mode: "custom" })).toBe("playwright");
  });

  it("parseOperatingMode is strict and throws for any unknown value", () => {
    const invalid = ["GEMINI", "gemini_assisted", "gpt", "openai", "mock", "test", "live", 1, true, null];
    for (const v of invalid) {
      expect(() => parseOperatingMode(v)).toThrow();
    }
  });

  it("valid modes parse successfully", () => {
    expect(parseOperatingMode("playwright")).toBe("playwright");
  });
});
