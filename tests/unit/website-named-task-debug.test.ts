import { describe, it, expect } from "vitest";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { AgentLoop } from "../../lib/agent/agent-loop";
import { ActionType, ActionStatus } from "../../lib/types/actions";
import { AgentState } from "../../lib/types/plans";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { RecoveryEngine } from "../../lib/agent/recovery-engine";
import { AgentError, ErrorCode } from "../../lib/types/errors";
import { validateUrlString } from "../../lib/validation/url-policy";
import { PageObservation } from "../../lib/types/browser";

describe("Regression: Website-Named Tasks, about:blank Resolution, and Lifecycle Synchronization", () => {
  it("1. 'Open YouTube and play a specified video' resolves a valid initial destination and generates initial navigation", () => {
    const task = "open youtube and play episode 1 of india's got latent season 2";
    const resolution = EntityConstraintResolver.resolveTargetUrl(task);

    expect(resolution.urlClarificationNeeded).toBe(false);
    expect(resolution.targetUrl).toBe("https://www.youtube.com");
    expect(resolution.targetWebsite).toBe("youtube");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.targetUrl).toBe("https://www.youtube.com");
    expect(spec.operation).toBe("MEDIA_PLAY");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions.length).toBeGreaterThan(1);
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://www.youtube.com");
  });

  it("2. 'Open Wikipedia and search for a topic' resolves a valid initial destination and generates initial navigation", () => {
    const task = "open wikipedia and search for quantum computing";
    const resolution = EntityConstraintResolver.resolveTargetUrl(task);

    expect(resolution.urlClarificationNeeded).toBe(false);
    expect(resolution.targetUrl).toBe("https://www.wikipedia.org");
    expect(resolution.targetWebsite).toBe("wikipedia");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.targetUrl).toBe("https://www.wikipedia.org");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions.length).toBeGreaterThan(1);
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://www.wikipedia.org");
  });

  it("3. A task with an explicitly supplied target URL navigates correctly", () => {
    const task = "find pricing plans";
    const explicitUrl = "https://example.com/pricing";
    const resolution = EntityConstraintResolver.resolveTargetUrl(task, explicitUrl);

    expect(resolution.urlClarificationNeeded).toBe(false);
    expect(resolution.targetUrl).toBe("https://example.com/pricing");

    const spec = EntityConstraintResolver.resolve({
      rawInstruction: task,
      targetUrl: explicitUrl,
    });
    expect(spec.targetUrl).toBe("https://example.com/pricing");

    const plan = DynamicTaskPlanner.plan({ spec, targetUrl: explicitUrl });
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://example.com/pricing");
  });

  it("4. An ambiguous website name requests clarification when necessary", async () => {
    const ambiguousTask = "open portal and check notifications";
    const resolution = EntityConstraintResolver.resolveTargetUrl(ambiguousTask);

    expect(resolution.urlClarificationNeeded).toBe(true);
    expect(resolution.targetWebsite).toBe("portal");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: ambiguousTask });
    expect(spec.isAmbiguous).toBe(true);
    expect(spec.ambiguityReason).toContain("portal");

    const agent = new AgentLoop();
    const result = await agent.runTask({
      task: ambiguousTask,
      operatingMode: "playwright",
    });

    expect(result.finalStatus).toBe("needs_clarification");
    expect(result.state).toBe(AgentState.WAITING_FOR_USER);
    expect(result.statusMessage).toContain("portal");
  });

  it("5. An unsafe or disallowed URL is rejected by the safety policy", async () => {
    // 5a. Prohibited SSRF / Cloud metadata endpoint
    expect(() => {
      validateUrlString("http://169.254.169.254/latest/meta-data", "test");
    }).toThrowError(/metadata destination is prohibited/i);

    // 5b. Dangerous pseudo-protocol javascript:
    expect(() => {
      validateUrlString("javascript:alert(1)", "test");
    }).toThrowError(/Unsupported or dangerous URL scheme/i);

    // 5c. AgentLoop rejection without launching browser
    const agent = new AgentLoop();
    const result = await agent.runTask({
      task: "open http://169.254.169.254/latest/meta-data and extract keys",
      operatingMode: "playwright",
    });

    expect(result.finalStatus).toBe("failed");
    expect(result.state).toBe(AgentState.FAILED);
    expect(result.statusMessage).toMatch(/URL Safety Policy violation/i);
  });

  it("6. A navigation failure cannot result in false success", () => {
    const plan = {
      id: "test-plan",
      taskInterpretation: "Navigate to destination and search",
      actions: [
        {
          id: "step-1",
          type: ActionType.NAVIGATE,
          value: "https://example.com/missing",
          reason: "Navigate to destination",
        },
      ],
      successCriteria: ["Page loaded"],
    };

    const verification = TaskVerifier.verifyTask({
      task: "open https://example.com/missing and search",
      plan,
      targetUrl: "https://example.com/missing",
      completedSteps: [
        {
          actionId: "step-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 120,
          error: {
            code: ErrorCode.NAVIGATION_FAILED,
            message: "Navigation failed: HTTP 404 (Not Found)",
          },
          retriesUsed: 0,
          verified: false,
        },
      ],
      extractedData: null,
      downloads: [],
    });

    expect(verification.passed).toBe(false);
    expect(verification.outcome).not.toBe("success");
    expect(verification.outcome).toBe("failed");
  });

  it("7. Recovery does not repeat the same ineffective plan indefinitely at about:blank", () => {
    const plan = {
      id: "plan-unresolved",
      taskInterpretation: "play video",
      actions: [
        {
          id: "step-play",
          type: ActionType.MEDIA_PLAY,
          target: { strategy: "css" as const, value: "video" },
          reason: "Play media",
        },
      ],
      successCriteria: ["Media active"],
    };

    const mockObservation: PageObservation = {
      tabId: "tab-1",
      url: "about:blank",
      title: "",
      interactiveElements: [],
      headings: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
    };

    const mockError = new AgentError(
      "Precondition failed: Cannot execute 'mediaPlay' on 'about:blank'",
      ErrorCode.VALIDATION_FAILED,
      true
    );

    // First attempt at about:blank triggers a single REPLAN attempt
    const dec1 = RecoveryEngine.determineRecovery({
      action: plan.actions[0],
      error: mockError,
      attempt: 1,
      maxAttempts: 1,
      replansUsed: 0,
      maxReplans: 2,
      observation: mockObservation,
      plan,
      failedTargets: new Set(),
    });
    expect(dec1.strategy).toBe("REPLAN");

    // Second attempt at about:blank after replan without resolved URL detects no-progress and stops
    const dec2 = RecoveryEngine.determineRecovery({
      action: plan.actions[0],
      error: mockError,
      attempt: 1,
      maxAttempts: 1,
      replansUsed: 1,
      maxReplans: 2,
      observation: mockObservation,
      plan,
      failedTargets: new Set(),
    });
    expect(dec2.strategy).toBe("WAITING_FOR_USER");
    expect(dec2.reason).toContain("No-progress detected: Browser remained at 'about:blank'");

    // Exhausted replans transitions to FAIL
    const dec3 = RecoveryEngine.determineRecovery({
      action: plan.actions[0],
      error: mockError,
      attempt: 1,
      maxAttempts: 1,
      replansUsed: 2,
      maxReplans: 2,
      observation: mockObservation,
      plan,
      failedTargets: new Set(),
    });
    expect(dec3.strategy).toBe("FAIL");
    expect(dec3.terminal).toBe(true);
  });

  it("8. The UI leaves 'Running' when the task transitions to clarification, blocked, failed, cancelled, or completed", () => {
    // Helper replicating app/page.tsx isRunning logic
    function computeIsRunning(params: {
      agentState: AgentState;
      finalStatus?: string;
      lifecycleState?: string;
      waitingForUser?: boolean;
    }): boolean {
      const isTerminalOrAwaiting =
        Boolean(params.finalStatus) ||
        Boolean(params.waitingForUser) ||
        params.agentState === AgentState.IDLE ||
        params.agentState === AgentState.COMPLETED ||
        params.agentState === AgentState.FAILED ||
        params.agentState === AgentState.CANCELLED ||
        params.agentState === AgentState.WAITING_FOR_USER ||
        params.lifecycleState === "needs_clarification" ||
        params.lifecycleState === "waiting_for_user" ||
        params.lifecycleState === "blocked" ||
        params.lifecycleState === "cancelled" ||
        params.lifecycleState === "failed" ||
        params.lifecycleState === "timed_out" ||
        params.lifecycleState === "completed" ||
        params.lifecycleState === "success" ||
        params.lifecycleState === "partial_success";

      return !isTerminalOrAwaiting;
    }

    // Active executing state -> Running should be true
    expect(computeIsRunning({ agentState: AgentState.EXECUTING, lifecycleState: "executing" })).toBe(true);
    expect(computeIsRunning({ agentState: AgentState.PLANNING, lifecycleState: "planning" })).toBe(true);

    // Needs clarification -> Running MUST be false
    expect(computeIsRunning({
      agentState: AgentState.WAITING_FOR_USER,
      finalStatus: "needs_clarification",
      lifecycleState: "needs_clarification",
      waitingForUser: true,
    })).toBe(false);

    // Blocked -> Running MUST be false
    expect(computeIsRunning({
      agentState: AgentState.FAILED,
      finalStatus: "blocked",
      lifecycleState: "blocked",
    })).toBe(false);

    // Failed -> Running MUST be false
    expect(computeIsRunning({
      agentState: AgentState.FAILED,
      finalStatus: "failed",
      lifecycleState: "failed",
    })).toBe(false);

    // Cancelled -> Running MUST be false
    expect(computeIsRunning({
      agentState: AgentState.CANCELLED,
      finalStatus: "cancelled",
      lifecycleState: "cancelled",
    })).toBe(false);

    // Completed -> Running MUST be false
    expect(computeIsRunning({
      agentState: AgentState.COMPLETED,
      finalStatus: "completed",
      lifecycleState: "completed",
    })).toBe(false);

    // Timed out -> Running MUST be false
    expect(computeIsRunning({
      agentState: AgentState.FAILED,
      finalStatus: "timed_out",
      lifecycleState: "timed_out",
    })).toBe(false);
  });
});
