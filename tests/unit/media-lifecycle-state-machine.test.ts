import { describe, it, expect, vi } from "vitest";
import {
  TaskLifecycleState,
  MediaPlaybackStatus,
  MediaPlaybackManager,
  assertValidTaskTransition,
  validateTaskStateTransition,
  TERMINAL_STATES,
} from "../../lib/agent/task-lifecycle";
import { AgentLoop } from "../../lib/agent/agent-loop";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { AgentState } from "../../lib/types/plans";
import { ActionType, ActionStatus } from "../../lib/types/actions";
import { ErrorCode } from "../../lib/types/errors";
import { ExecutionContext } from "../../lib/types/results";

describe("BrowseIQ Media Playback Lifecycle & State Isolation (Section 2 & 3)", () => {
  const testTaskId = "task-youtube-media-101";
  const testExecutionId = "exec-test-active-001";

  // =========================================================================
  // 1. Normal Video Playback
  // =========================================================================
  it("1. Normal video playback: manages playback states independently without corrupting task lifecycle", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.IDLE);

    // Initial loading
    const loadResult = manager.processEvent({
      status: MediaPlaybackStatus.LOADING,
      taskId: testTaskId,
      executionId: testExecutionId,
    });
    expect(loadResult.accepted).toBe(true);
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.LOADING);

    // Playback starts and progresses
    const playResult = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      currentTime: 1.5,
      duration: 180,
    });
    expect(playResult.accepted).toBe(true);
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.PLAYING);
    expect(manager.getRecord().verified).toBe(true);

    // Task lifecycle progresses through standard legal states
    expect(() => {
      assertValidTaskTransition(TaskLifecycleState.ACTION_EXECUTING, TaskLifecycleState.ACTION_VERIFIED, testTaskId);
      assertValidTaskTransition(TaskLifecycleState.ACTION_VERIFIED, TaskLifecycleState.VERIFYING, testTaskId);
      assertValidTaskTransition(TaskLifecycleState.VERIFYING, TaskLifecycleState.FINAL_VERIFICATION, testTaskId);
      assertValidTaskTransition(TaskLifecycleState.FINAL_VERIFICATION, TaskLifecycleState.FINAL_REPORT, testTaskId);
      assertValidTaskTransition(TaskLifecycleState.FINAL_REPORT, TaskLifecycleState.SUCCESS, testTaskId);
    }).not.toThrow();
  });

  // =========================================================================
  // 2. Playback After Advertisements
  // =========================================================================
  it("2. Playback after advertisements: tracks preroll ads without reporting failure and verifies settled content playback", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);

    // Preroll Ad 1 begins playing
    const ad1Result = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      isAdPlaying: true,
      adCount: 1,
      currentTime: 0.5,
    });
    expect(ad1Result.accepted).toBe(true);
    expect(manager.getRecord().isAdPlaying).toBe(true);
    expect(manager.getRecord().adCount).toBe(1);

    // Preroll Ad 2 begins playing
    const ad2Result = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      isAdPlaying: true,
      adCount: 2,
      currentTime: 1.0,
    });
    expect(ad2Result.accepted).toBe(true);
    expect(manager.getRecord().adCount).toBe(2);

    // Main requested video starts playing after ads complete
    const mainVideoResult = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      isAdPlaying: false,
      currentTime: 2.5,
      duration: 320,
    });
    expect(mainVideoResult.accepted).toBe(true);
    expect(manager.getRecord().isAdPlaying).toBe(false);
    expect(manager.getRecord().verified).toBe(true);

    // Verifier checks that playback is considered active and verified
    const verification = TaskVerifier.verifyTask({
      task: "Play a video on YouTube",
      completedSteps: [
        {
          actionId: "step-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          extractedData: {
            isPlaying: true,
            isPaused: false,
            currentTime: 2.5,
            playbackVerified: true,
            isAdPlaying: false,
          },
        },
      ],
      mediaPlayback: manager.getRecord(),
    });

    expect(verification.passed).toBe(true);
    expect(verification.evidence?.conditionsPassed).toContain("mediaPlaybackActive");
  });

  // =========================================================================
  // 3. Delayed Playback Event
  // =========================================================================
  it("3. Delayed playback event: correctly processes delayed playback event before task finalization", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);
    const agent = new AgentLoop();

    const mockCtx: ExecutionContext = {
      taskId: testTaskId,
      executionId: testExecutionId,
      originalTask: "Play a video on YouTube",
      mode: "live",
      state: AgentState.EXECUTING,
      lifecycleState: TaskLifecycleState.ACTION_EXECUTING,
      currentStepIndex: 1,
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
      mediaPlayback: manager.getRecord(),
    };

    // Delayed playback event arrives
    const delayedResult = agent.handleMediaPlaybackEvent(
      mockCtx,
      {
        status: MediaPlaybackStatus.PLAYING,
        taskId: testTaskId,
        executionId: testExecutionId,
        currentTime: 3.2,
      },
      manager
    );

    expect(delayedResult.accepted).toBe(true);
    expect(delayedResult.ignored).toBe(false);
    expect(mockCtx.mediaPlayback?.status).toBe(MediaPlaybackStatus.PLAYING);
    expect(mockCtx.mediaPlayback?.currentTime).toBe(3.2);
  });

  // =========================================================================
  // 4. Duplicate playback_started Events
  // =========================================================================
  it("4. Duplicate playback_started events: handled idempotently without throwing or modifying active state", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);

    // First playback event
    const firstEvent = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      currentTime: 1.0,
    });
    expect(firstEvent.accepted).toBe(true);
    expect(firstEvent.ignored).toBe(false);

    // Duplicate identical playback event
    const duplicateEvent = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      currentTime: 1.0,
    });

    expect(duplicateEvent.accepted).toBe(true);
    expect(duplicateEvent.ignored).toBe(false);
    expect(duplicateEvent.reason).toContain("Duplicate event acknowledged idempotently");
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.PLAYING);
  });

  // =========================================================================
  // 5. Buffering Before Playback
  // =========================================================================
  it("5. Buffering before playback: buffers safely without failing and transitions to active playback", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);

    // Player enters buffering state
    const bufferResult = manager.processEvent({
      status: MediaPlaybackStatus.BUFFERING,
      taskId: testTaskId,
      executionId: testExecutionId,
      currentTime: 0,
    });
    expect(bufferResult.accepted).toBe(true);
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.BUFFERING);

    // Once sufficient buffer loads, video begins playing
    const playingResult = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      currentTime: 1.2,
      duration: 240,
    });
    expect(playingResult.accepted).toBe(true);
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.PLAYING);
    expect(manager.getRecord().verified).toBe(true);
  });

  // =========================================================================
  // 6. Playback Event After Task Completion
  // =========================================================================
  it("6. Playback event after task completion: safely dropped without throwing or reverting terminal completed state", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);
    const agent = new AgentLoop();

    const mockCtx: ExecutionContext = {
      taskId: testTaskId,
      executionId: testExecutionId,
      originalTask: "Play a video on YouTube",
      mode: "live",
      state: AgentState.COMPLETED,
      finalStatus: "completed",
      lifecycleState: TaskLifecycleState.SUCCESS,
      currentStepIndex: 2,
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
      mediaPlayback: manager.getRecord(),
    };

    // Mark task terminal in media manager
    manager.markTaskTerminal();
    expect(manager.isTaskTerminal()).toBe(true);

    // Late playback event arrives after completion
    const lateEventResult = agent.handleMediaPlaybackEvent(
      mockCtx,
      {
        status: MediaPlaybackStatus.PLAYING,
        taskId: testTaskId,
        executionId: testExecutionId,
        currentTime: 5.0,
      },
      manager
    );

    // Must be safely ignored/dropped
    expect(lateEventResult.accepted).toBe(false);
    expect(lateEventResult.ignored).toBe(true);
    expect(lateEventResult.reason).toContain("Task is already in terminal state");

    // Task state must not be modified or moved to FAILED
    expect(mockCtx.state).toBe(AgentState.COMPLETED);
    expect(mockCtx.finalStatus).toBe("completed");
    expect(mockCtx.lifecycleState).toBe(TaskLifecycleState.SUCCESS);
  });

  // =========================================================================
  // 7. Playback Event After Cancellation
  // =========================================================================
  it("7. Playback event after cancellation: safely ignored and cancelled status is preserved", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);
    const agent = new AgentLoop();

    const mockCtx: ExecutionContext = {
      taskId: testTaskId,
      executionId: testExecutionId,
      originalTask: "Play a video on YouTube",
      mode: "live",
      state: AgentState.CANCELLED,
      finalStatus: "cancelled",
      lifecycleState: TaskLifecycleState.CANCELLED,
      currentStepIndex: 1,
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
      mediaPlayback: manager.getRecord(),
    };

    manager.markTaskTerminal();

    const result = agent.handleMediaPlaybackEvent(
      mockCtx,
      {
        status: MediaPlaybackStatus.PLAYING,
        taskId: testTaskId,
        executionId: testExecutionId,
        currentTime: 10.0,
      },
      manager
    );

    expect(result.accepted).toBe(false);
    expect(result.ignored).toBe(true);
    expect(mockCtx.state).toBe(AgentState.CANCELLED);
    expect(mockCtx.finalStatus).toBe("cancelled");
  });

  // =========================================================================
  // 8. Stale Event From an Earlier Execution
  // =========================================================================
  it("8. Stale event from an earlier execution: rejected using executionId mismatch", () => {
    const activeExecutionId = "exec-run-2";
    const manager = new MediaPlaybackManager(testTaskId, activeExecutionId);

    // Stale event carries old executionId
    const staleResult = manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: "exec-run-1", // Mismatched!
      currentTime: 4.5,
    });

    expect(staleResult.accepted).toBe(false);
    expect(staleResult.ignored).toBe(true);
    expect(staleResult.reason).toContain("Stale executionId");
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.IDLE);
  });

  // =========================================================================
  // 9. Genuine Playback Failure
  // =========================================================================
  it("9. Genuine playback failure: correctly records error state and verifier reports failure", () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);

    const errorResult = manager.processEvent({
      status: MediaPlaybackStatus.ERROR,
      taskId: testTaskId,
      executionId: testExecutionId,
      error: "MediaError_4: MEDIA_ERR_SRC_NOT_SUPPORTED",
    });

    expect(errorResult.accepted).toBe(true);
    expect(manager.getStatus()).toBe(MediaPlaybackStatus.ERROR);
    expect(manager.getRecord().error).toBe("MediaError_4: MEDIA_ERR_SRC_NOT_SUPPORTED");

    // Task verifier confirms that playback failed
    const verification = TaskVerifier.verifyTask({
      task: "Play a video on YouTube",
      completedSteps: [
        {
          actionId: "step-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          extractedData: {
            isPlaying: false,
            isPaused: true,
            error: "MediaError_4: MEDIA_ERR_SRC_NOT_SUPPORTED",
            playbackVerified: false,
          },
        },
      ],
      mediaPlayback: manager.getRecord(),
    });

    expect(verification.passed).toBe(false);
    expect(verification.evidence?.conditionsFailed).toContain("mediaPlaybackActive");
  });

  // =========================================================================
  // 10. Correct Task Completion After Playback Verification
  // =========================================================================
  it("10. Correct task completion after playback verification: marked COMPLETED without transition failure", async () => {
    const manager = new MediaPlaybackManager(testTaskId, testExecutionId);

    // Playback active & verified
    manager.processEvent({
      status: MediaPlaybackStatus.PLAYING,
      taskId: testTaskId,
      executionId: testExecutionId,
      currentTime: 3.5,
      duration: 300,
    });

    // Legal forward progression through task lifecycle
    expect(validateTaskStateTransition(TaskLifecycleState.ACTION_EXECUTING, TaskLifecycleState.ACTION_VERIFIED)).toBe(true);
    expect(validateTaskStateTransition(TaskLifecycleState.ACTION_VERIFIED, TaskLifecycleState.FINAL_VERIFICATION)).toBe(true);
    expect(validateTaskStateTransition(TaskLifecycleState.FINAL_VERIFICATION, TaskLifecycleState.FINAL_REPORT)).toBe(true);
    expect(validateTaskStateTransition(TaskLifecycleState.FINAL_REPORT, TaskLifecycleState.SUCCESS)).toBe(true);
    expect(validateTaskStateTransition(TaskLifecycleState.FINAL_REPORT, TaskLifecycleState.COMPLETED)).toBe(true);

    // Verification check passes
    const verification = TaskVerifier.verifyTask({
      task: "Play a video on YouTube",
      completedSteps: [
        {
          actionId: "step-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
        {
          actionId: "step-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          extractedData: {
            isPlaying: true,
            isPaused: false,
            currentTime: 3.5,
            duration: 300,
            playbackVerified: true,
          },
        },
      ],
      mediaPlayback: manager.getRecord(),
    });

    expect(verification.passed).toBe(true);
    expect(verification.evidence?.conditionsPassed).toContain("mediaPlaybackActive");
  });
});
