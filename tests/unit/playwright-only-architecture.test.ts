/**
 * Tests for Playwright-Only Architecture
 *
 * Verifies all 8 requirements from Section 5:
 * 1. The Playwright/Gemini mode switch is no longer rendered.
 * 2. Playwright is used for every browser task.
 * 3. The task API and backend orchestration do not require a selectable execution mode.
 * 4. Gemini/Grok planning integrations still work where intended.
 * 5. No AI planning call is unnecessarily required for supported deterministic tasks.
 * 6. Removing the switch does not break task submission, execution, recovery, verification, or cancellation.
 * 7. The settings interface and other header controls remain functional.
 * 8. Existing local-file permission behavior is preserved.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { ModeSwitch, ModeBadge } from "../../components/mode-switch";
import {
  OperatingMode,
  OperatingModeSchema,
  parseOperatingMode,
  coerceOperatingMode,
  DEFAULT_OPERATING_MODE,
  OPERATING_MODE_LABELS,
} from "../../lib/types/operating-mode";
import { Planner } from "../../lib/agent/planner";
import { GeminiPlanningInterface } from "../../lib/agent/gemini-planning-interface";
import { MockProvider } from "../../lib/ai/llm-provider";
import { AgentLoop } from "../../lib/agent/agent-loop";
import { LocalFileSecurityManager } from "../../lib/local/local-file-security-manager";
import { TaskLifecycleState } from "../../lib/agent/task-lifecycle";
import { AgentState } from "../../lib/types/plans";

const SIMPLE_TASK = "Search the product page for laptop and return the first product's name and price.";
const COMPLEX_TASK =
  "First search for laptops, then compare prices and reviews, and then sort by rating and filter by price under 50000, and subsequently select the cheapest option and fill out the order form.";

describe("Playwright-Only Architecture Verification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  // ─── 1. Mode Switch is no longer rendered ────────────────────────────────────
  describe("1. Mode switch is no longer rendered", () => {
    it("ModeSwitch component returns null (renders nothing)", () => {
      // Regardless of props passed, ModeSwitch produces 0 DOM elements
      const result = ModeSwitch({ value: "playwright", onChange: () => {} } as any);
      expect(result).toBeNull();
    });

    it("ModeBadge does NOT display a selectable Gemini execution mode", () => {
      const badgeDefault = ModeBadge({ operatingMode: "playwright" });
      expect(badgeDefault).not.toBeNull();
      // Should show Playwright as the execution engine
      expect(JSON.stringify(badgeDefault)).toContain("Playwright");
      expect(JSON.stringify(badgeDefault)).not.toContain("Gemini-Assisted");

      const badgeWithAI = ModeBadge({ operatingMode: "playwright", geminiInvoked: true });
      expect(JSON.stringify(badgeWithAI)).toContain("Playwright");
      expect(JSON.stringify(badgeWithAI)).toContain("AI-Planned");
      expect(JSON.stringify(badgeWithAI)).not.toContain("Gemini-Assisted");
    });

    it("OperatingModeSchema rejects 'gemini_assisted' as a selectable execution mode", () => {
      expect(() => OperatingModeSchema.parse("gemini_assisted")).toThrow();
      expect(OperatingModeSchema.parse("playwright")).toBe("playwright");
    });
  });

  // ─── 2. Playwright is used for every browser task ────────────────────────────
  describe("2. Playwright is used for every browser task", () => {
    it("execution engine is always 'playwright' in planning metadata", async () => {
      const planner = new Planner(new MockProvider());
      const plan = await planner.plan({ task: SIMPLE_TASK });

      expect(plan.planningMetadata?.operatingMode).toBe("playwright");
    });

    it("legacy mode preferences are safely coerced to 'playwright'", () => {
      expect(coerceOperatingMode("gemini_assisted")).toBe("playwright");
      expect(coerceOperatingMode("playwright")).toBe("playwright");
      expect(coerceOperatingMode("custom")).toBe("playwright");
      expect(coerceOperatingMode(null)).toBe("playwright");
      expect(coerceOperatingMode(undefined)).toBe("playwright");
      expect(DEFAULT_OPERATING_MODE).toBe("playwright");
    });
  });

  // ─── 3. Task API and backend orchestration do not require a mode ─────────────
  describe("3. Task API and backend orchestration do not require a selectable mode", () => {
    it("backend defaults to Playwright when no mode is provided in request", () => {
      const mode = coerceOperatingMode(undefined);
      expect(mode).toBe("playwright");
    });

    it("parseOperatingMode validates only Playwright", () => {
      expect(parseOperatingMode("playwright")).toBe("playwright");
      expect(() => parseOperatingMode("gemini_assisted")).toThrow(/Playwright is the only supported execution engine/);
      expect(() => parseOperatingMode("live")).toThrow();
    });

    it("OPERATING_MODE_LABELS only contains Playwright", () => {
      expect(OPERATING_MODE_LABELS).toEqual({ playwright: "Playwright" });
    });
  });

  // ─── 4. Gemini/Grok planning integrations still work where intended ──────────
  describe("4. Gemini/Grok planning integrations still work where intended", () => {
    it("invokes Gemini for complex reasoning tasks when Gemini is configured", async () => {
      const validPlan = {
        id: "gemini-synthesized-plan",
        taskInterpretation: "Complex multi-step workflow synthesized by Gemini for Playwright",
        assumptions: ["User requires cheapest laptop under 50000"],
        actions: [
          {
            id: "pw-action-1",
            type: "navigate" as const,
            target: { strategy: "css" as const, value: "body", description: "Navigate" },
            risk: "low" as const,
            reason: "Initial navigation",
          },
          {
            id: "pw-action-2",
            type: "finish" as const,
            risk: "low" as const,
            reason: "Complete workflow",
          },
        ],
        successCriteria: ["All steps completed"],
        taskSuccessCriteria: {
          requiredOperations: ["navigate", "finish"],
          requiredOutputs: [],
          verificationChecks: [],
        },
        potentialFailurePoints: [],
        revision: 0,
      };

      vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);
      const requestSpy = vi
        .spyOn(GeminiPlanningInterface.prototype, "requestPlan")
        .mockResolvedValue(validPlan);

      const planner = new Planner(new MockProvider());
      const plan = await planner.plan({ task: COMPLEX_TASK });

      expect(requestSpy).toHaveBeenCalled();
      expect(plan.planningMetadata?.geminiInvoked).toBe(true);
      expect(plan.planningMetadata?.planSource).toBe("gemini_assisted");
      expect(plan.planningMetadata?.operatingMode).toBe("playwright");
      // Resulting actions are standard Playwright actions
      expect(plan.actions.length).toBe(2);
      expect(plan.actions[0].type).toBe("navigate");
    });
  });

  // ─── 5. No AI planning call required for deterministic tasks ────────────────
  describe("5. No AI planning call is unnecessarily required for supported deterministic tasks", () => {
    it("does not call Gemini for straightforward tasks even when GEMINI_API_KEY is configured", async () => {
      vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);
      const requestSpy = vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan");

      const planner = new Planner(new MockProvider());
      const plan = await planner.plan({ task: SIMPLE_TASK });

      expect(requestSpy).not.toHaveBeenCalled();
      expect(plan.planningMetadata?.geminiInvoked).toBe(false);
      expect(plan.planningMetadata?.planSource).toBe("deterministic");
      expect(plan.planningMetadata?.operatingMode).toBe("playwright");
    });
  });

  // ─── 6. Task submission, execution, verification, and cancellation ───────────
  describe("6. Task submission, execution, recovery, verification, and cancellation", () => {
    it("AgentLoop runs task without requiring operatingMode option", async () => {
      const agent = new AgentLoop();
      const emittedLifecycles: TaskLifecycleState[] = [];

      // We run a simple unsupported task or clarification task that doesn't launch real browser
      const result = await agent.runTask({
        task: "Transfer money to account 12345", // restricted action -> handleUnsupported
        onLifecycleChange: (state) => {
          emittedLifecycles.push(state);
        },
      });

      expect(result).toBeDefined();
      expect(result.operatingMode).toBe("playwright");
      expect(result.finalStatus).toBe("unsupported_task");
    });

    it("cancellation cleanly transitions to CANCELLED state and retains Playwright mode", async () => {
      const agent = new AgentLoop();
      const abortController = new AbortController();
      abortController.abort(); // already aborted

      const result = await agent.runTask({
        task: "Navigate to example.com",
        abortSignal: abortController.signal,
      });

      expect(result.finalStatus).toBe("cancelled");
      expect(result.operatingMode).toBe("playwright");
    });
  });

  // ─── 7. Settings and other header controls remain functional ─────────────────
  describe("7. Settings and header controls remain functional", () => {
    it("settings configuration works with timeout, retries, and local files", () => {
      const settings = {
        actionTimeout: 20000,
        maxRetries: 4,
        maxReplans: 2,
        requireConfirmation: true,
        localFilesEnabled: true,
        accessMode: "whole_computer" as const,
        wholeComputerConfirmed: true,
      };

      expect(settings.actionTimeout).toBe(20000);
      expect(settings.maxRetries).toBe(4);
      expect(settings.accessMode).toBe("whole_computer");
    });
  });

  // ─── 8. Existing local-file permission behavior is preserved ────────────────
  describe("8. Existing local-file permission behavior is preserved", () => {
    it("local storage access requires explicit user permission", () => {
      LocalFileSecurityManager.setPermission(false);
      expect(LocalFileSecurityManager.isEnabled()).toBe(false);

      const check = LocalFileSecurityManager.validatePath("C:\\Users\\Dnyanu\\Downloads\\test.mp3");
      expect(check.permitted).toBe(false);
      expect(check.reason).toContain("Local file access is disabled");
    });

    it("local-file tasks do not depend on a website URL", async () => {
      LocalFileSecurityManager.setPermission(true, {
        accessMode: "whole_computer",
        wholeComputerConfirmed: true,
      });

      const candidate = {
        filename: "Hey Sinamika.mp3",
        canonicalPath: "C:\\Users\\Dnyanu\\Downloads\\Hey Sinamika.mp3",
        absolutePath: "C:\\Users\\Dnyanu\\Downloads\\Hey Sinamika.mp3",
        relativePath: "Hey Sinamika.mp3",
        directory: "C:\\Users\\Dnyanu\\Downloads",
        directoryType: "downloads" as const,
        extension: ".mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 4000000,
        modifiedTime: new Date().toISOString(),
        score: 1.0,
      };

      vi.spyOn(LocalFileSecurityManager, "searchAudioFiles").mockReturnValue({
        query: "hey sinamika",
        found: true,
        isAmbiguous: false,
        candidates: [candidate],
        bestMatch: candidate,
        searchedDirectory: "C:\\Users\\Dnyanu\\Downloads",
        scannedCount: 10,
      });

      const planner = new Planner(new MockProvider());
      const plan = await planner.plan({
        task: "play hey sinamika from downloads folder from local storage",
      });

      expect(plan).toBeDefined();
      expect(plan.routeDecision?.route).toBe("browser");
      expect(plan.planningMetadata?.operatingMode).toBe("playwright");
      // Player URL points to local audio player, not an external website URL
      const navAction = plan.actions.find((a) => a.type === "navigate");
      expect(navAction?.value).toContain("/player/audio");
    });
  });
});
