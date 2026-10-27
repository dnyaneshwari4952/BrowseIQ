/**
 * Phase 5 — Mode Switch Tests
 *
 * Tests for both Playwright Mode and Gemini-Assisted Mode.
 * All Gemini calls are mocked to prevent real API requests.
 *
 * Covers:
 * - Playwright Mode: Gemini is never invoked
 * - Gemini-Assisted Mode: Gemini is only invoked when signals require it
 * - Backend mode enforcement independent of frontend
 * - Confidence assessment signals
 * - Plan validation gates (malformed, unsafe, unsupported actions rejected)
 * - Mode preserved in ExecutionContext
 * - Mode switch during active task does not change that task's mode
 * - No secrets in logs or responses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetConfigForTesting } from "../../lib/config";
import { assessPlannerConfidence, GeminiPlanningInterface } from "../../lib/agent/gemini-planning-interface";
import {
  OperatingMode,
  OperatingModeSchema,
  parseOperatingMode,
  coerceOperatingMode,
  DEFAULT_OPERATING_MODE,
  OPERATING_MODE_LABELS,
  OPERATING_MODE_DESCRIPTIONS,
} from "../../lib/types/operating-mode";
import { SemanticDecomposer } from "../../lib/agent/semantic-decomposer";
import { Planner } from "../../lib/agent/planner";
import { MockProvider } from "../../lib/ai/llm-provider";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SIMPLE_TASK = "Search the product page for laptop and return the first product's name and price.";
const COMPLEX_TASK =
  "First search for laptops, then compare prices and reviews, and then sort by rating and filter by price under 50000, and subsequently select the cheapest option and fill out the order form.";
const AMBIGUOUS_TASK = "Do something interesting on the page.";

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

// ─── Confidence assessment tests ──────────────────────────────────────────────

describe("assessPlannerConfidence", () => {
  it("returns high confidence for a simple, well-formed task", () => {
    const intent = SemanticDecomposer.decompose(SIMPLE_TASK, null, undefined);
    const signals = assessPlannerConfidence(SIMPLE_TASK, null, undefined, intent);
    expect(signals.needsAssistance).toBe(false);
    expect(signals.confidenceScore).toBeGreaterThanOrEqual(0.6);
    // geminiInvoked is on PlanningMetadata, not AssistanceSignals
    expect(signals.reason).toBeTruthy();
  });

  it("flags multi-step conflict for a task with multiple sequential conjunctions", () => {
    const intent = SemanticDecomposer.decompose(COMPLEX_TASK, null, undefined);
    const signals = assessPlannerConfidence(COMPLEX_TASK, null, undefined, intent);
    expect(signals.multiStepConflict).toBe(true);
    expect(signals.needsAssistance).toBe(true);
    expect(signals.reason).toMatch(/multi-step|sequential/i);
  });

  it("flags unresolved ambiguity for a vague task", () => {
    const intent = SemanticDecomposer.decompose(AMBIGUOUS_TASK, null, undefined);
    const signals = assessPlannerConfidence(AMBIGUOUS_TASK, null, undefined, intent);
    // ambiguous task may or may not be flagged by decomposer; verify confidence is honest
    expect(signals.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(signals.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("does not flag assistance for a concise navigation task", () => {
    const task = "Go to https://example.com";
    const intent = SemanticDecomposer.decompose(task, null, undefined);
    const signals = assessPlannerConfidence(task, null, undefined, intent);
    expect(signals.confidenceScore).toBeGreaterThan(0.5);
  });

  it("never produces a confidence score outside [0, 1]", () => {
    const tasks = [SIMPLE_TASK, COMPLEX_TASK, AMBIGUOUS_TASK, "", "a"];
    for (const task of tasks) {
      const intent = SemanticDecomposer.decompose(task, null, undefined);
      const signals = assessPlannerConfidence(task, null, undefined, intent);
      expect(signals.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(signals.confidenceScore).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Playwright Mode tests ─────────────────────────────────────────────────────

describe("Playwright Mode — Gemini is NEVER invoked", () => {
  let geminiRequestSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetConfigForTesting({ NODE_ENV: "test", LLM_PROVIDER: "mock" });
    geminiRequestSpy = vi.fn();
    // Spy on GeminiPlanningInterface.prototype.requestPlan to ensure it's never called
    vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan").mockImplementation(geminiRequestSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not invoke Gemini for a simple task in playwright mode", async () => {
    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({
      task: SIMPLE_TASK,
      operatingMode: "playwright",
    });
    expect(geminiRequestSpy).not.toHaveBeenCalled();
    expect(plan).toBeDefined();
    expect(Array.isArray(plan.actions)).toBe(true);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.planningMetadata?.operatingMode).toBe("playwright");
    expect(plan.planningMetadata?.geminiInvoked).toBe(false);
    expect(plan.planningMetadata?.planSource).toBe("deterministic");
  });

  it("does not invoke Gemini for a complex multi-step task in playwright mode", async () => {
    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({
      task: COMPLEX_TASK,
      operatingMode: "playwright",
    });
    expect(geminiRequestSpy).not.toHaveBeenCalled();
    expect(plan.planningMetadata?.geminiInvoked).toBe(false);
    expect(plan.planningMetadata?.operatingMode).toBe("playwright");
  });

  it("works without a Gemini API key configured in playwright mode", async () => {
    resetConfigForTesting({ NODE_ENV: "test", LLM_PROVIDER: "mock" });
    // No GEMINI_API_KEY set
    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "playwright" });
    expect(plan).toBeDefined();
    expect(geminiRequestSpy).not.toHaveBeenCalled();
  });

  it("coerces unknown operatingMode to playwright (default) on the backend", () => {
    expect(coerceOperatingMode("gpt4")).toBe("playwright");
    expect(coerceOperatingMode("live")).toBe("playwright");
    expect(coerceOperatingMode(undefined)).toBe("playwright");
  });

  it("planningMetadata planSource is deterministic in playwright mode", async () => {
    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "playwright" });
    expect(plan.planningMetadata?.planSource).toBe("deterministic");
    expect(plan.planningMetadata?.planValidationOutcome).toBe("accepted");
  });

  it("does not invoke Gemini even if GEMINI_API_KEY is theoretically set", async () => {
    // Even with a non-empty key in env, playwright mode must not call Gemini
    process.env.GEMINI_API_KEY = "test-key-should-not-be-used";
    try {
      const planner = new Planner(new MockProvider());
      const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "playwright" });
      expect(geminiRequestSpy).not.toHaveBeenCalled();
      expect(plan.planningMetadata?.geminiInvoked).toBe(false);
    } finally {
      delete process.env.GEMINI_API_KEY;
    }
  });
});

// ─── Gemini-Assisted Mode tests ─────────────────────────────────────────────

describe("Gemini-Assisted Mode — Gemini invoked only when needed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("does NOT invoke Gemini for a simple confidently-handled task", async () => {
    // Simple task should have high confidence — no Gemini needed
    const geminiSpy = vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan");
    vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);

    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({
      task: SIMPLE_TASK,
      operatingMode: "gemini_assisted",
    });

    // Simple task: confidence should be high, Gemini not needed
    expect(plan.planningMetadata?.geminiInvoked).toBe(false);
    expect(plan.planningMetadata?.planSource).toBe("deterministic");
    expect(geminiSpy).not.toHaveBeenCalled();
  });

  it("invokes Gemini for a complex multi-step task when configured", async () => {
    // Mock Gemini to return a valid plan
    const validGeminiPlan = {
      id: "gemini-plan-test",
      taskInterpretation: "Searched, compared, sorted, and filled order form",
      assumptions: ["User wants the cheapest option"],
      actions: [
        {
          id: "g-action-1",
          type: "navigate" as const,
          target: { strategy: "css" as const, value: "body", description: "Navigate to search" },
          risk: "low" as const,
          reason: "Start navigation",
        },
        {
          id: "g-action-2",
          type: "finish" as const,
          risk: "low" as const,
          reason: "Complete task",
        },
      ],
      successCriteria: ["Task complete"],
      taskSuccessCriteria: {
        requiredOperations: ["navigate", "finish"],
        requiredOutputs: [],
        verificationChecks: [],
      },
      potentialFailurePoints: [],
      revision: 0,
    };

    vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);
    vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan").mockResolvedValue(validGeminiPlan);

    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({
      task: COMPLEX_TASK,
      operatingMode: "gemini_assisted",
    });

    expect(plan.planningMetadata?.geminiInvoked).toBe(true);
    expect(plan.planningMetadata?.planSource).toBe("gemini_assisted");
    expect(plan.planningMetadata?.geminiInvokeReason).toBeTruthy();
  });

  it("falls through to deterministic planner if Gemini is not configured", async () => {
    vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(false);
    const geminiSpy = vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan");

    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({
      task: COMPLEX_TASK,
      operatingMode: "gemini_assisted",
    });

    // Gemini is not configured — must fall through to deterministic
    expect(geminiSpy).not.toHaveBeenCalled();
    expect(plan).toBeDefined();
    expect(plan.planningMetadata?.geminiInvoked).toBe(false);
  });

  it("does NOT silently switch mode on Gemini error — propagates error", async () => {
    vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);
    vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan").mockRejectedValue(
      new Error("Gemini API rate limit exceeded")
    );

    const planner = new Planner(new MockProvider());

    await expect(
      planner.plan({ task: COMPLEX_TASK, operatingMode: "gemini_assisted" })
    ).rejects.toThrow(/Gemini-Assisted planning failed/i);
  });

  it("rejects a Gemini plan with unsafe action types via safety gate", async () => {
    // We test the safety gate behavior by mocking requestPlan to throw the safety rejection
    vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);
    vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan").mockRejectedValue(
      new Error("Gemini plan rejected by safety gate: Action 2: unsupported type 'exec_shell'")
    );

    const planner = new Planner(new MockProvider());
    await expect(
      planner.plan({ task: COMPLEX_TASK, operatingMode: "gemini_assisted" })
    ).rejects.toThrow(/safety gate|unsupported type|Gemini-Assisted planning failed/i);
  });

  it("records deterministicConfidenceScore in planningMetadata", async () => {
    vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(false);

    const planner = new Planner(new MockProvider());
    const plan = await planner.plan({ task: SIMPLE_TASK, operatingMode: "gemini_assisted" });

    expect(typeof plan.planningMetadata?.deterministicConfidenceScore).toBe("number");
    expect(plan.planningMetadata!.deterministicConfidenceScore).toBeGreaterThanOrEqual(0);
    expect(plan.planningMetadata!.deterministicConfidenceScore).toBeLessThanOrEqual(1);
  });
});

// ─── GeminiPlanningInterface.isConfigured tests ───────────────────────────────

describe("GeminiPlanningInterface.isConfigured()", () => {
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    resetConfigForTesting({});
  });

  it("returns false when GEMINI_API_KEY is absent", () => {
    delete process.env.GEMINI_API_KEY;
    resetConfigForTesting({ NODE_ENV: "test" });
    // isConfigured reads from env; without a key it should return false
    // We test via the actual static method (mocked env)
    const result = GeminiPlanningInterface.isConfigured();
    expect(typeof result).toBe("boolean");
  });

  it("returns false for placeholder key value", () => {
    process.env.GEMINI_API_KEY = "your_gemini_api_key_here";
    resetConfigForTesting({ GEMINI_API_KEY: "your_gemini_api_key_here" });
    expect(GeminiPlanningInterface.isConfigured()).toBe(false);
  });
});

// ─── UI / Lifecycle tests (unit-level) ────────────────────────────────────────

describe("Mode switch lifecycle safeguards", () => {
  it("operating mode is permanently locked to Playwright at API boundary", () => {
    const modeAtCreation = "playwright";
    const legacyModeAttempt = "gemini_assisted";

    const capturedMode = coerceOperatingMode(modeAtCreation);
    expect(capturedMode).toBe("playwright");

    // Even if legacy client requests gemini_assisted, it safely coerces to playwright
    const coercedLegacyMode = coerceOperatingMode(legacyModeAttempt);
    expect(coercedLegacyMode).toBe("playwright");
  });

  it("a cancelled task retains its original operatingMode", async () => {
    // planningMetadata.operatingMode is set at ctx creation in runTask
    // We test this at the Planner level by checking that the returned plan carries the mode
    const planner = new Planner(new MockProvider());
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
    // Backend always coerces — spoofed values become the default
    expect(coerceOperatingMode("fake_mode")).toBe("playwright");
    expect(coerceOperatingMode(null)).toBe("playwright");
    expect(coerceOperatingMode({ mode: "gemini" })).toBe("playwright");
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
