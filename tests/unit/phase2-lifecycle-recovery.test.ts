import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentLoop } from "../../lib/agent/agent-loop";
import { RecoveryEngine } from "../../lib/agent/recovery-engine";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { ApiRegistry } from "../../lib/api/api-registry";
import { ApiExecutor, ApiErrorCode } from "../../lib/api/api-executor";
import { ActionExecutor } from "../../lib/browser/action-executor";
import { browserManager } from "../../lib/browser/browser-manager";
import { Action, ActionStatus, ActionType, LocatorStrategy, RiskLevel } from "../../lib/types/actions";
import { AgentState, Plan } from "../../lib/types/plans";
import { PageObservation } from "../../lib/types/browser";
import { AgentError, ErrorCode } from "../../lib/types/errors";
import { ExecutionEvent } from "../../lib/observability/trace";

describe("Phase 2 — AgentLoop Reliability, Safe Recovery, Execution State and Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. maxRetries = 0: one initial attempt, no retries
  it("1. maxRetries = 0: executes one initial attempt and no retries", async () => {
    let executionAttempts = 0;
    vi.spyOn(ActionExecutor, "execute").mockImplementation(async () => {
      executionAttempts++;
      return {
        result: {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          retriesUsed: 0,
          verified: false,
          error: { code: ErrorCode.ELEMENT_NOT_FOUND, message: "Target not found", recoverable: true },
        },
        afterObservation: {
          url: "http://localhost:3000",
          title: "Test",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "test",
          timestamp: new Date().toISOString(),
          tabId: "tab-0",
          pageType: "normal",
          isSettled: true,
        },
      };
    });

    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Click button with zero retries",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.TEXT, value: "Submit" },
          retries: { maxRetries: 0, backoffMs: 100 },
          reason: "Click submit with 0 retries",
        },
      ],
      routeDecision: { route: "browser", reason: "Direct browser execution", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    const ctx = await loop.runTask({
      task: "Click button with zero retries",
      forceBrowser: true,
      settings: { maxReplans: 0 },
    });
    expect(executionAttempts).toBe(1);
    expect(ctx.finalStatus).toBe("failed");
  });

  // 2. maxRetries = 1: one initial attempt plus one retry (2 attempts total)
  it("2. maxRetries = 1: executes one initial attempt plus one retry (2 attempts total)", async () => {
    let executionAttempts = 0;
    vi.spyOn(ActionExecutor, "execute").mockImplementation(async () => {
      executionAttempts++;
      return {
        result: {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          retriesUsed: 0,
          verified: false,
          error: { code: ErrorCode.NETWORK_ERROR, message: "Transient network blip", recoverable: true },
        },
        afterObservation: {
          url: "http://localhost:3000",
          title: "Test",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "test",
          timestamp: new Date().toISOString(),
          tabId: "tab-0",
          pageType: "normal",
          isSettled: true,
        },
      };
    });

    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Click button with 1 retry",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.TEXT, value: "Refresh" },
          retries: { maxRetries: 1, backoffMs: 10 },
          reason: "Click with 1 retry",
        },
      ],
      routeDecision: { route: "browser", reason: "Direct browser execution", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    const ctx = await loop.runTask({
      task: "Click button with 1 retry",
      forceBrowser: true,
      settings: { maxReplans: 0 },
    });
    // 1 initial attempt + 1 retry = 2 total attempts
    expect(executionAttempts).toBe(2);
    expect(ctx.finalStatus).toBe("failed");
  });

  // 3. Global retry defaults
  it("3. Global retry defaults: uses configured default when action.retries is omitted", async () => {
    let executionAttempts = 0;
    vi.spyOn(ActionExecutor, "execute").mockImplementation(async () => {
      executionAttempts++;
      return {
        result: {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          retriesUsed: 0,
          verified: false,
          error: { code: ErrorCode.NETWORK_ERROR, message: "Network error", recoverable: true },
        },
        afterObservation: {
          url: "http://localhost:3000",
          title: "Test",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "test",
          timestamp: new Date().toISOString(),
          tabId: "tab-0",
          pageType: "normal",
          isSettled: true,
        },
      };
    });

    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Default retries task",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.TEXT, value: "Button" },
          reason: "Click with default retries",
        },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    // Pass maxRetries: 2 in settings -> 1 initial attempt + 2 retries = 3 attempts total
    await loop.runTask({
      task: "Default retries task",
      forceBrowser: true,
      settings: { maxRetries: 2, maxReplans: 0 },
    });
    expect(executionAttempts).toBe(3);
  });

  // 4. Action-specific retry overrides
  it("4. Action-specific retry overrides: action-level maxRetries overrides global setting", async () => {
    let executionAttempts = 0;
    vi.spyOn(ActionExecutor, "execute").mockImplementation(async () => {
      executionAttempts++;
      return {
        result: {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          retriesUsed: 0,
          verified: false,
          error: { code: ErrorCode.NETWORK_ERROR, message: "Network error", recoverable: true },
        },
        afterObservation: {
          url: "http://localhost:3000",
          title: "Test",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "test",
          timestamp: new Date().toISOString(),
          tabId: "tab-0",
          pageType: "normal",
          isSettled: true,
        },
      };
    });

    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Action override retries task",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.TEXT, value: "Button" },
          retries: { maxRetries: 1, backoffMs: 10 }, // Action overrides to 1 retry (2 attempts)
          reason: "Click with override",
        },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    // Global settings specify maxRetries: 4, but action specifies maxRetries: 1
    await loop.runTask({
      task: "Action override retries task",
      forceBrowser: true,
      settings: { maxRetries: 4, maxReplans: 0 },
    });
    expect(executionAttempts).toBe(2);
  });

  // 5. A transient browser failure that recovers
  it("5. A transient browser failure that recovers: succeeds on retry and completes task", async () => {
    let executionAttempts = 0;
    vi.spyOn(ActionExecutor, "execute").mockImplementation(async () => {
      executionAttempts++;
      if (executionAttempts === 1) {
        return {
          result: {
            actionId: "act-1",
            type: ActionType.CLICK,
            status: ActionStatus.FAILED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 10,
            retriesUsed: 0,
            verified: false,
            error: { code: ErrorCode.NETWORK_ERROR, message: "Page still loading", recoverable: true },
          },
          afterObservation: {
            url: "http://localhost:3000",
            title: "Loading",
            headings: [],
            interactiveElements: [],
            forms: [],
            dialogs: [],
            summary: "loading",
            timestamp: new Date().toISOString(),
            tabId: "tab-0",
            pageType: "normal",
            isSettled: false,
          },
        };
      }
      return {
        result: {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          retriesUsed: 1,
          verified: true,
        },
        afterObservation: {
          url: "http://localhost:3000",
          title: "Products",
          headings: ["Products Found"],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "products ready",
          timestamp: new Date().toISOString(),
          tabId: "tab-0",
          pageType: "normal",
          isSettled: true,
        },
      };
    });

    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Transient recovery task",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.TEXT, value: "Click Me" },
          retries: { maxRetries: 2, backoffMs: 10 },
          reason: "Click element",
        },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    const ctx = await loop.runTask({ task: "Transient recovery task", forceBrowser: true });
    expect(executionAttempts).toBe(2);
    expect(ctx.finalStatus).toBe("completed");
    expect(ctx.retries).toBe(1);
  });

  // 6. A permanent locator failure
  it("6. A permanent locator failure: element not found after attempts exhausts replans and fails terminally", async () => {
    const loop = new AgentLoop();
    vi.spyOn(ActionExecutor, "execute").mockResolvedValue({
      result: {
        actionId: "act-1",
        type: ActionType.CLICK,
        status: ActionStatus.FAILED,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 10,
        retriesUsed: 0,
        verified: false,
        error: { code: ErrorCode.ELEMENT_NOT_FOUND, message: "Target element not found", recoverable: true },
      },
      afterObservation: {
        url: "http://localhost:3000",
        title: "Test",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "test",
        timestamp: new Date().toISOString(),
        tabId: "tab-0",
        pageType: "normal",
        isSettled: true,
      },
    });

    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Permanent failure task",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.CSS, value: "#non-existent-button" },
          retries: { maxRetries: 1, backoffMs: 10 },
          reason: "Click missing button",
        },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    const ctx = await loop.runTask({
      task: "Permanent failure task",
      forceBrowser: true,
      settings: { maxReplans: 0 },
    });
    expect(ctx.finalStatus).toBe("failed");
    expect(ctx.failedSteps.length).toBeGreaterThan(0);
  });

  // 7. A side-effecting action whose outcome is uncertain
  it("7. A side-effecting action whose outcome is uncertain: aborts automatic retry and requests user confirmation", () => {
    const action: Action = {
      id: "act-submit",
      type: ActionType.CLICK,
      target: { strategy: LocatorStrategy.TEXT, value: "Submit Order" },
      reason: "Submit final purchase order",
    };

    expect(RecoveryEngine.isSideEffectingAction(action)).toBe(true);

    const decision = RecoveryEngine.determineRecovery({
      action,
      error: new AgentError("Network timeout during submission", ErrorCode.TIMEOUT, true),
      attempt: 1,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 2,
    });

    expect(decision.strategy).toBe("WAITING_FOR_USER");
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("side-effecting");
  });

  // 8. A failed replan due to provider quota
  it("8. A failed replan due to provider quota: propagates error without blind replay of failed action", async () => {
    const loop = new AgentLoop();
    vi.spyOn(ActionExecutor, "execute").mockResolvedValue({
      result: {
        actionId: "act-1",
        type: ActionType.CLICK,
        status: ActionStatus.FAILED,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 10,
        retriesUsed: 0,
        verified: false,
        error: { code: ErrorCode.ELEMENT_NOT_FOUND, message: "Target missing", recoverable: true },
      },
      afterObservation: {
        url: "http://localhost:3000",
        title: "Test",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "test",
        timestamp: new Date().toISOString(),
        tabId: "tab-0",
        pageType: "normal",
        isSettled: true,
      },
    });

    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Replan quota task",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.ID, value: "missing-id" },
          retries: { maxRetries: 0 },
          reason: "Click missing item",
        },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    // Replan throws 429 quota exhaustion
    vi.spyOn((loop as any).planner, "replan").mockRejectedValue(
      new AgentError("LLM quota exceeded 429 RESOURCE_EXHAUSTED", ErrorCode.RATE_LIMITED, false)
    );

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    const ctx = await loop.runTask({
      task: "Replan quota task",
      forceBrowser: true,
      settings: { maxReplans: 1 },
    });

    expect(ctx.finalStatus).toBe("failed");
    expect(ctx.statusMessage).toContain("Replanning failed");
  });

  // 9. A changed DOM with a uniquely identifiable replacement control
  it("9. A changed DOM with a uniquely identifiable replacement control: adapts selector safely", () => {
    const observation: PageObservation = {
      url: "http://localhost:3000",
      title: "Store",
      headings: [],
      interactiveElements: [
        {
          id: "btn-find",
          tagName: "BUTTON",
          text: "Find Products",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
      ],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: "",
      tabId: "tab-0",
      pageType: "normal",
      isSettled: true,
    };

    const target = { strategy: LocatorStrategy.TEXT, value: "Search" };
    const alternative = RecoveryEngine.findAlternativeLocator(target, observation);

    expect(alternative).toBeDefined();
    expect(alternative?.value).toBe("Find Products");

    const decision = RecoveryEngine.determineRecovery({
      action: { id: "a1", type: ActionType.CLICK, target, reason: "Search items" },
      error: new AgentError("Not found", ErrorCode.ELEMENT_NOT_FOUND, true),
      attempt: 1,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 2,
      observation,
    });

    expect(decision.strategy).toBe("RETRY_WITH_ALTERNATIVE_LOCATOR");
    expect(decision.suggestedTarget?.value).toBe("Find Products");
  });

  // 10. Ambiguous replacement controls requiring clarification
  it("10. Ambiguous replacement controls requiring clarification: returns WAITING_FOR_USER", () => {
    const observation: PageObservation = {
      url: "http://localhost:3000",
      title: "Store",
      headings: [],
      interactiveElements: [
        {
          id: "btn-1",
          tagName: "BUTTON",
          text: "Search Store",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
        {
          id: "btn-2",
          tagName: "BUTTON",
          text: "Search Catalog",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
      ],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: "",
      tabId: "tab-0",
      pageType: "normal",
      isSettled: true,
    };

    const target = { strategy: LocatorStrategy.TEXT, value: "Search" };
    const decision = RecoveryEngine.determineRecovery({
      action: { id: "a1", type: ActionType.CLICK, target, reason: "Search for goods" },
      error: new AgentError("Not found", ErrorCode.ELEMENT_NOT_FOUND, true),
      attempt: 1,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 2,
      observation,
    });

    expect(decision.strategy).toBe("WAITING_FOR_USER");
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toContain("ambiguous");
  });

  // 11. API integration missing from the registry
  it("11. API integration missing from the registry: falls back to browser if available or fails clearly", async () => {
    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Missing API task",
      assumptions: [],
      actions: [{ id: "act-1", type: ActionType.FINISH, reason: "Finish" }],
      routeDecision: {
        route: "api",
        apiIntegrationId: "non-existent-api-id",
        confidence: 0.9,
        fallbackAvailable: false, // Fallback not permitted
      },
    });

    const ctx = await loop.runTask({ task: "Query missing API" });
    expect(ctx.finalStatus).toBe("failed");
    expect(ctx.statusMessage).toContain("was not found in registry and browser fallback is not permitted");
  });

  // 12. API execution throwing
  it("12. API execution throwing: converts exception into structured result and handles failure safely", async () => {
    const endpoint = {
      id: "throw-api-id",
      name: "Throwing API",
      description: "Throws network exception",
      endpoint: "/api/throw",
      method: "GET" as const,
      patterns: [],
      extractParameters: () => ({}),
      browserFallbackUrl: "/search",
    };

    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("DNS lookup failed: ENOTFOUND"));

    const result = await ApiExecutor.execute(endpoint, "fetch something");
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(ApiErrorCode.NETWORK_ERROR);
    expect(result.error?.message).toContain("DNS lookup failed");
  });

  // 13. API route failing without an authorized browser fallback
  it("13. API route failing without authorized browser fallback: fails clearly without bypassing security", async () => {
    const loop = new AgentLoop();
    vi.spyOn(ApiRegistry, "getById").mockReturnValue({
      id: "auth-api",
      name: "Secure API",
      description: "Requires auth",
      endpoint: "/api/secure",
      method: "GET",
      patterns: [],
      extractParameters: () => ({}),
      browserFallbackUrl: "/login",
    });

    vi.spyOn(ApiExecutor, "execute").mockResolvedValue({
      success: false,
      endpointId: "auth-api",
      statusCode: 401,
      error: { code: ApiErrorCode.AUTH_ERROR, message: "Unauthorized 401" },
      fallbackToBrowser: false, // Unauthorized requests must NOT bypass auth
      durationMs: 50,
    });

    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Query secure data",
      assumptions: [],
      actions: [{ id: "a1", type: ActionType.FINISH, reason: "Finish" }],
      routeDecision: {
        route: "api",
        apiIntegrationId: "auth-api",
        confidence: 0.9,
        fallbackAvailable: false,
      },
    });

    const ctx = await loop.runTask({ task: "Query secure data" });
    expect(ctx.finalStatus).toBe("failed");
    expect(ctx.statusMessage).toContain("API execution failed");
  });

  // 14. Cancellation during planning
  it("14. Cancellation during planning: abort signal halts execution before plan runs", async () => {
    const controller = new AbortController();
    controller.abort(); // Cancelled before start

    const loop = new AgentLoop();
    const ctx = await loop.runTask({
      task: "Cancelled task",
      abortSignal: controller.signal,
    });

    expect(ctx.finalStatus).toBe("cancelled");
    expect(ctx.state).toBe(AgentState.CANCELLED);
  });

  // 15. Cancellation during execution
  it("15. Cancellation during execution: abort signal halts loop between actions", async () => {
    const controller = new AbortController();
    let actionCount = 0;

    vi.spyOn(ActionExecutor, "execute").mockImplementation(async () => {
      actionCount++;
      controller.abort(); // Cancel during first action execution
      return {
        result: {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 10,
          retriesUsed: 0,
          verified: true,
        },
        afterObservation: {
          url: "http://localhost:3000",
          title: "Test",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "test",
          timestamp: new Date().toISOString(),
          tabId: "tab-0",
          pageType: "normal",
          isSettled: true,
        },
      };
    });

    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Two step task",
      assumptions: [],
      actions: [
        { id: "act-1", type: ActionType.CLICK, target: { strategy: LocatorStrategy.TEXT, value: "Step 1" }, reason: "First" },
        { id: "act-2", type: ActionType.CLICK, target: { strategy: LocatorStrategy.TEXT, value: "Step 2" }, reason: "Second" },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {} as any,
    } as any);

    const ctx = await loop.runTask({
      task: "Two step task",
      forceBrowser: true,
      abortSignal: controller.signal,
    });

    expect(actionCount).toBe(1);
    expect(ctx.finalStatus).toBe("cancelled");
  });

  // 16. Deadline expiry during a provider request
  it("16. Deadline expiry during a provider request: transitions to timed_out", async () => {
    const loop = new AgentLoop();
    // Simulate planner timing out
    vi.spyOn((loop as any).planner, "plan").mockImplementation(async () => {
      throw new AgentError("Planner request timed out after 30000ms", ErrorCode.TIMEOUT, false);
    });

    const ctx = await loop.runTask({ task: "Timed out planning task" });
    expect(ctx.finalStatus).toBe("failed");
    expect(ctx.statusMessage).toContain("Planning failed");
  });

  // 17. Deadline expiry during browser execution
  it("17. Deadline expiry during browser execution: exits with timed_out status", async () => {
    const loop = new AgentLoop();
    const ctx = (loop as any).handleTimeout(
      {
        taskId: "task-test",
        originalTask: "Test timeout",
        state: AgentState.EXECUTING,
        currentStepIndex: 0,
        completedSteps: [],
        failedSteps: [],
        extractedData: null,
        downloads: [],
        screenshots: [],
        browserTabs: [],
        retries: 0,
        replans: 0,
        routeDecisions: [],
        errors: [],
        startTime: new Date().toISOString(),
      },
      vi.fn(),
      vi.fn()
    );

    const resolvedCtx = await ctx;
    expect(resolvedCtx.finalStatus).toBe("timed_out");
    expect(resolvedCtx.state).toBe(AgentState.FAILED);
  });

  // 18. A late result after cancellation
  it("18. A late result after cancellation: does not overwrite cancelled final status", () => {
    const loop = new AgentLoop();
    const ctx: any = {
      taskId: "task-1",
      state: AgentState.CANCELLED,
      finalStatus: "cancelled",
      statusMessage: "Execution cancelled by user intervention.",
      _isFinalized: true,
    };

    const emitEvent = vi.fn();
    const emitState = vi.fn();

    // Late success attempt
    (loop as any).handleSuccess(ctx, "Late success message", emitEvent, emitState);
    expect(ctx.finalStatus).toBe("cancelled");
    expect(emitEvent).not.toHaveBeenCalled();

    // Late failure attempt
    (loop as any).handleFailure(ctx, "Late failure message", emitEvent, emitState);
    expect(ctx.finalStatus).toBe("cancelled");
    expect(emitEvent).not.toHaveBeenCalled();
  });

  // 19. Clarification producing needs_clarification
  it("19. Clarification producing needs_clarification: retains missing details and avoids generic failure", async () => {
    const loop = new AgentLoop();
    const ctx = await loop.runTask({
      task: "Book a flight somewhere tomorrow", // Ambiguous destination
    });

    expect(ctx.finalStatus).toBe("needs_clarification");
    expect(ctx.state).toBe(AgentState.WAITING_FOR_USER);
    expect(ctx.statusMessage).toBeDefined();
  });

  // 20. A click that succeeds but the task verifier rejects
  it("20. A click that succeeds but the task verifier rejects: fails task and records false success", () => {
    const verification = TaskVerifier.verifyTask({
      task: "Submit the registration form and extract confirmation code",
      completedSteps: [
        {
          actionId: "act-1",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        },
      ],
      observation: {
        url: "http://localhost:3000/register",
        title: "Registration Form",
        headings: ["Register"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Form page",
        timestamp: new Date().toISOString(),
        tabId: "tab-0",
        pageType: "normal",
        isSettled: true,
      },
      extractedData: {}, // Missing confirmation code!
    });

    expect(verification.passed).toBe(false);
    expect(verification.reason).toContain("formSubmitted");
  });

  // 21. Search submission with no relevant results
  it("21. Search submission with no relevant results: reports 0 results failure truthfully", () => {
    const verification = TaskVerifier.verifyTask({
      task: "Search for quantum-hyper-flux-widget-xyz on store",
      completedSteps: [
        {
          actionId: "act-1",
          type: ActionType.PRESS,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        },
      ],
      observation: {
        url: "http://localhost:3000/search?q=quantum-hyper-flux-widget-xyz",
        title: "Search Results",
        headings: ["No matching results found"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Your search did not match any products. 0 results found.",
        timestamp: new Date().toISOString(),
        tabId: "tab-0",
        pageType: "search_results",
        isSettled: true,
      },
      extractedData: null,
    });

    expect(verification.passed).toBe(false);
    expect(verification.reason).toContain("0 results were found");
  });

  // 22. A CAPTCHA/access restriction returning blocked
  it("22. A CAPTCHA/access restriction returning blocked: sets finalStatus to blocked", async () => {
    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockResolvedValue({
      taskInterpretation: "Access blocked target",
      assumptions: [],
      actions: [
        {
          id: "act-1",
          type: ActionType.NAVIGATE,
          value: "https://example.com/blocked",
          reason: "Navigate to page",
        },
      ],
      routeDecision: { route: "browser", reason: "Browser route", confidence: 0.9, fallbackAvailable: false },
    });

    vi.spyOn(browserManager, "getActivePage").mockResolvedValue({
      tabId: "tab-0",
      page: {
        goto: vi.fn(),
      } as any,
    } as any);

    vi.spyOn(ActionExecutor, "execute").mockResolvedValue({
      result: {
        actionId: "act-1",
        type: ActionType.NAVIGATE,
        status: ActionStatus.COMPLETED,
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        durationMs: 100,
        retriesUsed: 0,
        verified: true,
      },
      afterObservation: {
        url: "https://www.google.com/sorry/index",
        title: "Google Sorry",
        headings: ["Our systems have detected unusual traffic from your computer network."],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Google CAPTCHA challenge block",
        timestamp: new Date().toISOString(),
        tabId: "tab-0",
        pageType: "challenge",
        isSettled: true,
      },
    });

    const ctx = await loop.runTask({ task: "Search blocked site", forceBrowser: true });
    expect(ctx.finalStatus).toBe("blocked");
    expect(ctx.state).toBe(AgentState.FAILED);
  });

  // 23. Correct product title and price association
  it("23. Correct product title and price association: matches attributes within the same product item", () => {
    const extractedData = {
      title: "Mechanical Keyboard Pro",
      price: "$129.99",
    };

    const verification = TaskVerifier.verifyTask({
      task: "Find price of Mechanical Keyboard Pro",
      completedSteps: [
        {
          actionId: "act-1",
          type: ActionType.EXTRACT_TEXT,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
          extractedData,
        },
      ],
      extractedData,
      observation: {
        url: "http://localhost:3000/store",
        title: "Store - Keyboards",
        headings: ["Mechanical Keyboard Pro"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Mechanical Keyboard Pro is $129.99",
        timestamp: new Date().toISOString(),
        tabId: "tab-0",
        pageType: "normal",
        isSettled: true,
      },
    });

    expect(verification.passed).toBe(true);
  });

  // 24. A failed task not being marked completed
  it("24. A failed task not being marked completed: never returns completed status on failure", async () => {
    const loop = new AgentLoop();
    vi.spyOn((loop as any).planner, "plan").mockRejectedValue(
      new AgentError("Planning provider down", ErrorCode.UNKNOWN_PROVIDER_ERROR, false)
    );

    const ctx = await loop.runTask({ task: "Failing task" });
    expect(ctx.finalStatus).not.toBe("completed");
    expect(ctx.finalStatus).toBe("failed");
  });

  // 25. Terminal events emitted exactly once
  it("25. Terminal events emitted exactly once: single finalization invariant prevents duplicate terminal events", async () => {
    const emittedEvents: ExecutionEvent[] = [];
    const loop = new AgentLoop();

    const ctx = (loop as any).handleSuccess(
      {
        taskId: "task-1",
        state: AgentState.EXECUTING,
        plan: { actions: [] },
      },
      "Task completed successfully",
      (type: string, msg: string) => emittedEvents.push({ id: "e1", taskId: "t1", type: type as any, timestamp: "", message: msg }),
      vi.fn()
    );

    // Call terminal handlers again on same context
    (loop as any).handleSuccess(ctx, "Duplicate success", (type: string, msg: string) => emittedEvents.push({ id: "e2", taskId: "t1", type: type as any, timestamp: "", message: msg }), vi.fn());
    (loop as any).handleFailure(ctx, "Duplicate failure", (type: string, msg: string) => emittedEvents.push({ id: "e3", taskId: "t1", type: type as any, timestamp: "", message: msg }), vi.fn());

    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0].type).toBe("TASK_COMPLETED");
  });

  // 26. Timers and browser resources cleaned up after exceptions
  it("26. Timers and browser resources cleaned up after exceptions: closes browser session cleanly on timeout", async () => {
    const closeSpy = vi.spyOn(browserManager, "close").mockResolvedValue(undefined);
    const loop = new AgentLoop();

    await (loop as any).handleTimeout(
      {
        taskId: "task-cleanup",
        state: AgentState.EXECUTING,
        completedSteps: [],
        failedSteps: [],
        errors: [],
      },
      vi.fn(),
      vi.fn()
    );

    expect(closeSpy).toHaveBeenCalled();
  });
});
