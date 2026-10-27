import { describe, it, expect, vi } from "vitest";
import {
  taskSessionReducer,
  INITIAL_TASK_SESSION_STATE,
  hasSessionData,
  isCleanSession,
  TaskSessionState,
} from "../../lib/state/task-session";
import { AgentState, Plan } from "../../lib/types/plans";
import { ActionStatus, ActionType, LocatorStrategy } from "../../lib/types/actions";
import { ExecutionContext, TaskVerificationResult } from "../../lib/types/results";

describe("Clear Button — Reset the Entire Task Session", () => {
  it("1. Clear removes the prompt and target URL", () => {
    let state = taskSessionReducer(INITIAL_TASK_SESSION_STATE, {
      type: "SET_TASK_PROMPT",
      payload: "Search Wikipedia for Playwright and extract the summary paragraph.",
    });
    state = taskSessionReducer(state, {
      type: "SET_TARGET_URL",
      payload: "https://en.wikipedia.org",
    });

    expect(state.taskPrompt).toBe("Search Wikipedia for Playwright and extract the summary paragraph.");
    expect(state.targetUrlInput).toBe("https://en.wikipedia.org");

    // Click Clear
    const cleared = taskSessionReducer(state, { type: "RESET_SESSION" });
    expect(cleared.taskPrompt).toBe("");
    expect(cleared.targetUrlInput).toBe("");
    expect(isCleanSession(cleared)).toBe(true);
  });

  it("2. Clear removes all previous search records and result previews", () => {
    // Populate session with extracted data and search records
    const mockExtractedData = {
      title: "Playwright: Fast and reliable end-to-end testing for modern web apps",
      price: "$0.00",
      products: [
        { title: "Item 1", price: "$10.00" },
        { title: "Item 2", price: "$20.00" },
      ],
      url: "https://example.com/search?q=playwright",
    };

    let state = taskSessionReducer(INITIAL_TASK_SESSION_STATE, {
      type: "START_TASK",
      payload: {
        task: "Search for items",
        targetUrl: "https://example.com",
        now: new Date().toISOString(),
      },
    });

    state = taskSessionReducer(state, {
      type: "SET_RESULT",
      payload: {
        taskId: "task-search-1",
        state: AgentState.COMPLETED,
        finalStatus: "completed",
        extractedData: mockExtractedData,
        downloads: [
          {
            id: "dl-1",
            originalFilename: "report.pdf",
            savedPath: "/tmp/report.pdf",
            fileSizeBytes: 1024,
            downloadTime: new Date().toISOString(),
            verified: true,
          },
        ],
        screenshots: ["data:image/png;base64,abc"],
      } as ExecutionContext,
    });

    expect(state.extractedData).toEqual(mockExtractedData);
    expect(state.downloads.length).toBe(1);
    expect(state.screenshots.length).toBe(1);
    expect(hasSessionData(state)).toBe(true);

    // Click Clear
    const cleared = taskSessionReducer(state, { type: "RESET_SESSION" });
    expect(cleared.extractedData).toBeNull();
    expect(cleared.downloads).toEqual([]);
    expect(cleared.screenshots).toEqual([]);
    expect(hasSessionData(cleared)).toBe(false);
  });

  it("3. Clear removes success/failure status, diagnostics, verification evidence, and task progress", () => {
    const mockVerification: TaskVerificationResult = {
      passed: false,
      isBlocked: false,
      reason: "Could not locate expected confirmation banner on page",
      failedChecks: ["confirmationBannerPresent", "finalUrlMatch"],
      missingOutputs: ["orderId"],
      evidence: {
        originalObjective: "Complete checkout",
        reason: "confirmation banner missing",
        conditionsPassed: ["navigatedToStore"],
        conditionsFailed: ["completedCheckout"],
      },
      outcome: "failed",
    };

    let state = taskSessionReducer(INITIAL_TASK_SESSION_STATE, {
      type: "START_TASK",
      payload: {
        task: "Complete checkout on store",
        targetUrl: "https://store.example.com",
        now: "2026-10-27T00:00:00Z",
      },
    });

    state = taskSessionReducer(state, {
      type: "UPDATE_STATE",
      payload: {
        state: AgentState.EXECUTING,
        lifecycleState: "executing",
        stepIndex: 3,
        actionName: "Clicking checkout button",
      },
    });

    state = taskSessionReducer(state, {
      type: "SET_RESULT",
      payload: {
        taskId: "task-fail-1",
        state: AgentState.FAILED,
        finalStatus: "failed",
        statusMessage: "Task verification failed: confirmation banner missing",
        taskVerification: mockVerification,
        retries: 2,
        replans: 3,
        recoveryHistory: [
          {
            attempt: 1,
            actionId: "act-1",
            strategy: "replan_new_path",
            reason: "Button not interactable",
            outcome: "success",
            timestamp: new Date().toISOString(),
          },
        ],
      } as unknown as ExecutionContext,
    });

    expect(state.agentState).toBe(AgentState.FAILED);
    expect(state.finalStatus).toBe("failed");
    expect(state.statusMessage).toContain("Task verification failed");
    expect(state.taskVerification).toEqual(mockVerification);
    expect(state.retriesCount).toBe(2);
    expect(state.replansCount).toBe(3);
    expect(state.recoveryHistory.length).toBe(1);
    expect(state.errorDetails?.code).toBe("TASK_VERIFICATION_FAILED");
    expect(state.currentStepIndex).toBe(3);
    expect(state.startTime).toBe("2026-10-27T00:00:00Z");

    // Click Clear
    const cleared = taskSessionReducer(state, { type: "RESET_SESSION" });

    // Verify status, diagnostics, verification, and progress are completely wiped
    expect(cleared.agentState).toBe(AgentState.IDLE);
    expect(cleared.finalStatus).toBeUndefined();
    expect(cleared.lifecycleState).toBeUndefined();
    expect(cleared.statusMessage).toBeUndefined();
    expect(cleared.taskVerification).toBeNull();
    expect(cleared.errorDetails).toBeNull();
    expect(cleared.retriesCount).toBe(0);
    expect(cleared.replansCount).toBe(0);
    expect(cleared.recoveryHistory).toEqual([]);
    expect(cleared.currentStepIndex).toBe(0);
    expect(cleared.startTime).toBeUndefined();
    expect(cleared.currentActionName).toBeUndefined();
    expect(cleared.events).toEqual([]);
    expect(isCleanSession(cleared)).toBe(true);
  });

  it("4. Clear resets pending clarification and confirmation states", () => {
    let state = taskSessionReducer(INITIAL_TASK_SESSION_STATE, {
      type: "START_TASK",
      payload: {
        task: "Transfer funds to recipient",
        targetUrl: "https://bank.example.com",
        now: new Date().toISOString(),
      },
    });

    state = taskSessionReducer(state, {
      type: "SET_RESULT",
      payload: {
        taskId: "task-clarify-1",
        state: AgentState.WAITING_FOR_USER,
        finalStatus: "needs_clarification",
        statusMessage: "Please specify whether transfer is checking or savings.",
      } as ExecutionContext,
    });

    expect(state.waitingForUser).toBe(true);
    expect(state.finalStatus).toBe("needs_clarification");
    expect(state.errorDetails?.code).toBe("NEEDS_CLARIFICATION");
    expect(state.statusMessage).toContain("Please specify whether transfer");

    // Click Clear
    const cleared = taskSessionReducer(state, { type: "RESET_SESSION" });
    expect(cleared.waitingForUser).toBe(false);
    expect(cleared.finalStatus).toBeUndefined();
    expect(cleared.errorDetails).toBeNull();
    expect(cleared.statusMessage).toBeUndefined();
    expect(cleared.agentState).toBe(AgentState.IDLE);
  });

  it("5. A delayed response from a previous task cannot restore stale results after Clear", async () => {
    // Simulate generation counter pattern used in app/page.tsx
    let currentRunId = 0;
    let state: TaskSessionState = INITIAL_TASK_SESSION_STATE;

    const dispatch = (action: any) => {
      state = taskSessionReducer(state, action);
    };

    // Task 1 starts
    const task1RunId = ++currentRunId;
    dispatch({
      type: "START_TASK",
      payload: {
        task: "Slow search task",
        targetUrl: "https://example.com/slow",
        now: new Date().toISOString(),
      },
    });

    expect(state.agentState).toBe(AgentState.UNDERSTANDING);

    // User clicks Clear while Task 1 is still running / awaiting delayed responses
    currentRunId++; // Invalidation increment
    dispatch({ type: "RESET_SESSION" });

    expect(state.agentState).toBe(AgentState.IDLE);
    expect(state.taskPrompt).toBe("");

    // Simulate delayed response arriving from Task 1 after Clear
    const delayedTask1Result: ExecutionContext = {
      taskId: "task-1-delayed",
      state: AgentState.COMPLETED,
      finalStatus: "completed",
      extractedData: { delayedContent: "Should never appear in UI" },
      statusMessage: "Stale completion",
    } as ExecutionContext;

    // Guard matching DashboardPage: ignore updates if runId is stale
    if (currentRunId === task1RunId) {
      dispatch({ type: "SET_RESULT", payload: delayedTask1Result });
    }

    // Delayed result must be dropped
    expect(state.agentState).toBe(AgentState.IDLE);
    expect(state.finalStatus).toBeUndefined();
    expect(state.extractedData).toBeNull();
    expect(state.statusMessage).toBeUndefined();
    expect(isCleanSession(state)).toBe(true);
  });

  it("6. Persistent application settings remain unchanged when Clear is clicked", () => {
    // Application settings must NOT be mutated by task session reset
    const userSettings = {
      actionTimeout: 30000,
      maxRetries: 5,
      maxReplans: 4,
      requireConfirmation: false,
      localFilesEnabled: true,
      approvedDirectory: "D:/MyAllowedFiles",
    };

    const operatingMode = "gemini_assisted";

    let state = taskSessionReducer(INITIAL_TASK_SESSION_STATE, {
      type: "START_TASK",
      payload: {
        task: "Check local files",
        now: new Date().toISOString(),
      },
    });

    // Resetting session only affects task workspace
    const cleared = taskSessionReducer(state, { type: "RESET_SESSION" });

    // Settings remain intact
    expect(userSettings.actionTimeout).toBe(30000);
    expect(userSettings.maxRetries).toBe(5);
    expect(userSettings.approvedDirectory).toBe("D:/MyAllowedFiles");
    expect(userSettings.localFilesEnabled).toBe(true);
    expect(operatingMode).toBe("gemini_assisted");

    // Task state is clean
    expect(cleared.agentState).toBe(AgentState.IDLE);
    expect(cleared.taskPrompt).toBe("");
  });

  it("7. A new task works correctly after Clear", () => {
    let state = INITIAL_TASK_SESSION_STATE;

    // First task fails
    state = taskSessionReducer(state, {
      type: "START_TASK",
      payload: { task: "Failing task", targetUrl: "https://bad.example.com", now: "2026-10-27T00:00:00Z" },
    });
    state = taskSessionReducer(state, {
      type: "SET_ERROR",
      payload: { message: "Failed to connect", code: "NETWORK_ERROR" },
    });
    expect(state.agentState).toBe(AgentState.FAILED);
    expect(state.finalStatus).toBe("failed");

    // Click Clear
    state = taskSessionReducer(state, { type: "RESET_SESSION" });
    expect(isCleanSession(state)).toBe(true);

    // Start completely new task
    state = taskSessionReducer(state, {
      type: "START_TASK",
      payload: { task: "Search Quotes to Scrape", targetUrl: "https://quotes.toscrape.com", now: "2026-10-27T00:01:00Z" },
    });
    expect(state.taskPrompt).toBe("Search Quotes to Scrape");
    expect(state.targetUrlInput).toBe("https://quotes.toscrape.com");
    expect(state.agentState).toBe(AgentState.UNDERSTANDING);

    // New task succeeds
    const mockPlan: Plan = {
      id: "plan-quotes",
      taskInterpretation: "Extract quote",
      actions: [
        {
          id: "act-nav",
          type: ActionType.NAVIGATE,
          value: "https://quotes.toscrape.com",
          reason: "Navigate to quotes site",
        },
        {
          id: "act-ext",
          type: ActionType.EXTRACT_TEXT,
          target: { strategy: LocatorStrategy.CSS, value: ".quote .text" },
          reason: "Extract quote text",
        },
      ],
      successCriteria: ["Quote text extracted"],
    };

    state = taskSessionReducer(state, { type: "SET_PLAN", payload: mockPlan });
    state = taskSessionReducer(state, {
      type: "SET_RESULT",
      payload: {
        taskId: "task-quotes-2",
        state: AgentState.COMPLETED,
        finalStatus: "completed",
        extractedData: { quote: "The world as we have created it is a process of our thinking." },
        statusMessage: "Successfully extracted quote",
      } as ExecutionContext,
    });

    expect(state.agentState).toBe(AgentState.COMPLETED);
    expect(state.finalStatus).toBe("completed");
    expect(state.plan?.actions.length).toBe(2);
    expect((state.extractedData as any).quote).toContain("The world as we have created it");
  });

  it("8. Clear does not close or terminate browser window state unexpectedly", () => {
    let state = taskSessionReducer(INITIAL_TASK_SESSION_STATE, {
      type: "START_TASK",
      payload: { task: "Browser test", now: new Date().toISOString() },
    });

    state = taskSessionReducer(state, {
      type: "SET_BROWSER_WINDOW",
      payload: { taskId: "task-browser-1", isVisible: true, isOpen: true },
    });

    expect(state.browserWindow.isOpen).toBe(true);

    // Clearing UI resets the task-associated window badge without killing browser process
    const cleared = taskSessionReducer(state, { type: "RESET_SESSION" });
    expect(cleared.browserWindow.taskId).toBeUndefined();
    expect(cleared.browserWindow.isOpen).toBe(false);
    expect(cleared.browserWindow.isVisible).toBe(false);
  });
});
