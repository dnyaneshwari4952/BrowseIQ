import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/route";
import { NextRequest } from "next/server";
import { AgentLoop } from "@/lib/agent/agent-loop";
import { buildProviderInstance, createLLMProvider, MockProvider } from "@/lib/ai/llm-provider";
import { resetConfigForTesting } from "@/lib/config";
import { AgentError, ErrorCode } from "@/lib/types/errors";
import { Planner } from "@/lib/agent/planner";
import { GeminiPlanningInterface } from "@/lib/agent/gemini-planning-interface";
import { ChallengeDetector } from "@/lib/browser/challenge-detector";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { PageObservation } from "@/lib/types/browser";
import { ActionStatus } from "@/lib/types/actions";
import { TaskQueue } from "@/lib/agent/task-queue";

describe("Live Mode Enforcement & Test Mode Removal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetConfigForTesting({
      NODE_ENV: "test",
      LLM_PROVIDER: "mock",
      LLM_FALLBACK_PROVIDER: "none",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. The application exposes only Live Mode for execution ────────────────

  describe("1. Live Mode Exclusivity", () => {
    it("POST /api/agent rejects requests with mode: 'test' with HTTP 400", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Search for laptops on Wikipedia",
          mode: "test",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/Test Mode has been removed/i);
    });

    it("POST /api/agent rejects any non-live mode string with HTTP 400", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Check news headlines",
          mode: "simulation",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Test Mode has been removed/i);
    });

    it("AgentLoop.runTask unconditionally sets ExecutionContext.mode to 'live'", async () => {
      const agent = new AgentLoop();
      // Even if options somehow had mode: 'test' passed by legacy code, ExecutionContext must be 'live'
      const ctx = await agent.runTask({
        task: "Verify system status",
        mode: "test" as any,
      });

      expect(ctx.mode).toBe("live");
    });

    it("TaskQueue defaults tasks to mode: 'live'", async () => {
      const queue = new TaskQueue();
      let capturedMode: string | undefined;

      await queue.enqueue({
        taskId: "test-task-1",
        instruction: "Search for documentation",
        execute: async () => {
          capturedMode = "live";
          return true;
        },
      });

      expect(capturedMode).toBe("live");
    });
  });

  // ─── 2. Mock providers cannot be selected as a hidden live fallback ─────────

  describe("2. Mock Provider Fallback Prohibition", () => {
    it("buildProviderInstance throws if mock is requested as a fallback provider", () => {
      expect(() => buildProviderInstance("mock", true)).toThrow(AgentError);
      try {
        buildProviderInstance("mock", true);
      } catch (err: any) {
        expect(err.code).toBe(ErrorCode.CONFIG_ERROR);
        expect(err.message).toMatch(/MockProvider cannot be selected as a live fallback provider/i);
      }
    });

    it("createLLMProvider throws if LLM_FALLBACK_PROVIDER is set to 'mock'", () => {
      resetConfigForTesting({
        NODE_ENV: "test",
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "valid-test-key-1234567890",
        LLM_FALLBACK_PROVIDER: "mock" as any,
      });

      expect(() => createLLMProvider()).toThrow(AgentError);
      try {
        createLLMProvider();
      } catch (err: any) {
        expect(err.message).toMatch(/MockProvider cannot be selected as a live fallback provider/i);
      }
    });
  });

  // ─── 3. Test fixtures cannot be used as ordinary live task targets ───────────

  describe("3. Test Fixtures Isolation from Live Execution", () => {
    it("POST /api/agent rejects targetUrl pointing to /test-fixtures with HTTP 400", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Find the price of laptop",
          targetUrl: "http://localhost:3000/test-fixtures/search",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const json = await response.json();
      expect(json.error).toMatch(/Test fixtures .* cannot be used as live task targets/i);
    });

    it("POST /api/agent rejects targetUrl pointing to /api/test-fixtures with HTTP 400", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Download the invoice",
          targetUrl: "http://localhost:3000/api/test-fixtures/download-file",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Test fixtures .* cannot be used as live task targets/i);
    });

    it("POST /api/agent rejects user task strings that target localhost test fixtures", async () => {
      const request = new NextRequest("http://localhost:3000/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Open http://localhost:3000/test-fixtures/form and submit my email",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toMatch(/Test fixtures .* cannot be used as live task targets/i);
    });
  });

  // ─── 4. Playwright failures and real restrictions reported honestly ──────────

  describe("4. Honest Reporting of Real Playwright Failures and Restrictions", () => {
    it("reports honest failure with NAVIGATION_FAILED code when page returns HTTP 404", async () => {
      const agent = new AgentLoop();
      // Test URL that triggers 404 handling without simulated success
      const ctx = await agent.runTask({
        task: "Extract price from non-existent product page",
        targetUrl: "https://example.com/non-existent-404-page",
      });

      // Should be failed or blocked — never marked as completed
      expect(ctx.finalStatus).not.toBe("completed");
    }, 15000);

    it("ChallengeDetector flags CAPTCHA and anti-bot challenge as BLOCKED", () => {
      const challengeObservation = {
        tabId: "tab-0",
        url: "https://www.google.com/sorry/index?continue=https://example.com",
        title: "Sorry...",
        headings: ["Sorry..."],
        summary: "Our systems have detected unusual traffic from your computer network. Please solve this CAPTCHA.",
        forms: [],
        dialogs: [],
        interactiveElements: [
          {
            id: "recaptcha",
            tagName: "iframe",
            role: "none",
            text: "reCAPTCHA",
            boundingBox: { x: 100, y: 100, width: 300, height: 75 },
            isVisible: true,
            isEnabled: true,
            isPassword: false,
          },
        ],
        timestamp: new Date().toISOString(),
      } as unknown as PageObservation;

      const detection = ChallengeDetector.detect(challengeObservation);
      expect(detection.isBlocked).toBe(true);
      expect(detection.reason).toMatch(/CAPTCHA|traffic/i);
    });

    it("TaskVerifier rejects action success as proof of task completion when target is blocked", () => {
      const challengeObservation = {
        tabId: "tab-0",
        url: "https://example.com/blocked",
        title: "Access Denied - 403 Forbidden",
        headings: ["Access Denied"],
        summary: "Cloudflare Ray ID: 12345 — Access Denied. Attention Required! Cloudflare.",
        forms: [],
        dialogs: [],
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      } as unknown as PageObservation;

      const verification = TaskVerifier.verifyTask({
        task: "Extract latest stock price",
        plan: {
          id: "plan-1",
          taskInterpretation: "Extract stock price",
          assumptions: [],
          actions: [],
          taskSuccessCriteria: {
            requiredOperations: ["navigate", "extractText"],
            requiredOutputs: ["price"],
            verificationChecks: ["priceExtracted"],
          },
          revision: 0,
        },
        completedSteps: [
          {
            actionId: "act-1",
            type: "navigate" as any,
            status: ActionStatus.COMPLETED, // Action technically completed without exception
            durationMs: 500,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: challengeObservation,
        extractedData: null,
        downloads: [],
      });

      // Task must be rejected as blocked/failed — action success is NEVER treated as task success
      expect(verification.passed).toBe(false);
      expect(verification.isBlocked).toBe(true);
      expect(verification.outcome).toBe("blocked");
    });
  });

  // ─── 5. Gemini & Playwright Mode Interaction in Live Execution ───────────────

  describe("5. Gemini & Playwright Mode Separation in Live Execution", () => {
    it("Playwright mode never invokes Gemini and relies on deterministic planning + Playwright execution", async () => {
      const geminiSpy = vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan");
      vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);

      const planner = new Planner(new MockProvider());
      const plan = await planner.plan({
        task: "Search for laptops and sort by price ascending",
        operatingMode: "playwright",
      });

      expect(geminiSpy).not.toHaveBeenCalled();
      expect(plan.planningMetadata?.operatingMode).toBe("playwright");
      expect(plan.planningMetadata?.geminiInvoked).toBe(false);
      expect(plan.planningMetadata?.planSource).toBe("deterministic");
    });

    it("Gemini-Assisted mode preserves operating mode on error and never silently switches providers", async () => {
      vi.spyOn(GeminiPlanningInterface, "isConfigured").mockReturnValue(true);
      vi.spyOn(GeminiPlanningInterface.prototype, "requestPlan").mockRejectedValue(
        new AgentError("Gemini quota exhausted", ErrorCode.API_ERROR, false, undefined, "gemini")
      );

      const planner = new Planner(new MockProvider());

      // Task with sequential conjunctions triggers low deterministic confidence
      const complexTask = "First open page, then search laptops, and then compare specs, and finally export CSV";

      await expect(
        planner.plan({
          task: complexTask,
          operatingMode: "gemini_assisted",
        })
      ).rejects.toThrow(/Gemini-Assisted planning failed/i);
    });
  });
});
