import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { Planner } from "@/lib/agent/planner";
import { DynamicTaskPlanner } from "@/lib/planning/dynamic-task-planner";
import { EntityConstraintResolver } from "@/lib/planning/entity-constraint-resolver";
import { PreExecutionValidator } from "@/lib/validation/pre-execution-validator";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { ActionVerifier } from "@/lib/agent/action-verifier";
import { SemanticOperationVerifier } from "@/lib/agent/semantic-operation-verifier";
import { ActionType, RiskLevel, ActionStatus } from "@/lib/types/actions";
import { PageObservation } from "@/lib/types/browser";
import { AgentError, ErrorCode } from "@/lib/types/errors";

describe("Regression Suite: Generalized Media Task Planning and Missing Navigation Prerequisites", () => {
  let browser: Browser | null = null;
  let page: Page | null = null;

  beforeEach(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterEach(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    page = null;
    browser = null;
  });

  it("1. Generates dependency-aware plan: navigate -> wait -> search -> select result -> mediaPlay for 'play sweetheart song on youtube'", async () => {
    const rawInstruction = "play sweetheart song on youtube";
    const spec = EntityConstraintResolver.resolve({ rawInstruction });

    expect(spec.operation).toBe("MEDIA_PLAY");
    expect(spec.targetUrl).toBe("https://www.youtube.com");
    expect(spec.targetEntity).toBe("sweetheart song");
    expect(spec.searchQuery).toBe("sweetheart song");

    const plan = DynamicTaskPlanner.plan({
      spec,
      targetUrl: spec.targetUrl,
    });

    const actionTypes = plan.actions.map((a) => a.type);
    expect(actionTypes).toContain(ActionType.NAVIGATE);
    expect(actionTypes).toContain(ActionType.FILL);
    expect(actionTypes).toContain(ActionType.CLICK);
    expect(actionTypes).toContain(ActionType.MEDIA_PLAY);
    expect(actionTypes).toContain(ActionType.FINISH);

    // Verify dependency ordering: NAVIGATE must precede FILL, which precedes result CLICK, which precedes MEDIA_PLAY
    const navIndex = plan.actions.findIndex((a) => a.type === ActionType.NAVIGATE);
    const fillIndex = plan.actions.findIndex((a) => a.type === ActionType.FILL);
    const clickResultIndex = plan.actions.findIndex((a) => a.type === ActionType.CLICK && a.id.includes("click-result"));
    const mediaPlayIndex = plan.actions.findIndex((a) => a.type === ActionType.MEDIA_PLAY);

    expect(navIndex).toBeLessThan(fillIndex);
    expect(fillIndex).toBeLessThan(clickResultIndex);
    expect(clickResultIndex).toBeLessThan(mediaPlayIndex);

    // Verify navigation target is YouTube
    const navAction = plan.actions[navIndex];
    expect(navAction.value).toBe("https://www.youtube.com");

    // Verify search query filled
    const fillAction = plan.actions[fillIndex];
    expect(fillAction.value).toBe("sweetheart song");
  });

  it("2. Reuses existing context when browser is already on a suitable media page without re-navigating", () => {
    const spec = EntityConstraintResolver.resolve({
      rawInstruction: "Play the current video",
      targetUrl: "https://www.youtube.com/watch?v=123",
    });

    const observation: PageObservation = {
      url: "https://www.youtube.com/watch?v=123",
      title: "Sweetheart Song - Music Video",
      headings: [],
      interactiveElements: [],
      mediaElements: [
        {
          tagName: "video",
          currentSrc: "https://example.com/video.mp4",
          isPlaying: false,
          isPaused: true,
          currentTime: 0,
          duration: 180,
          isMuted: false,
          volume: 1,
          readyState: 4,
          ended: false,
        },
      ],
      forms: [],
      dialogs: [],
      summary: "Video playback interface",
      timestamp: new Date().toISOString(),
      tabId: "tab-0",
    };

    const plan = DynamicTaskPlanner.plan({
      spec,
      targetUrl: "https://www.youtube.com/watch?v=123",
      observation,
    });

    // Should NOT add a duplicate navigation step because browser is already at target
    const navActions = plan.actions.filter((a) => a.type === ActionType.NAVIGATE);
    expect(navActions.length).toBe(0);

    // Should go directly to mediaPlay
    const mediaPlayAction = plan.actions.find((a) => a.type === ActionType.MEDIA_PLAY);
    expect(mediaPlayAction).toBeDefined();
  });

  it("3. PreExecutionValidator enforces precondition and rejects DOM interaction when target is missing on about:blank", async () => {
    if (!page) throw new Error("Page not initialized");
    await page.goto("about:blank");

    const blankObs: PageObservation = {
      url: "about:blank",
      title: "",
      headings: [],
      interactiveElements: [],
      mediaElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-0",
    };

    const action = {
      id: "media-play-fail",
      type: ActionType.MEDIA_PLAY,
      target: { strategy: "role" as const, value: "Play", role: "button" },
      risk: RiskLevel.LOW,
      reason: "Start media playback",
    };

    await expect(
      PreExecutionValidator.validate({
        action,
        page,
        currentObservation: blankObs,
      })
    ).rejects.toThrowError(/Precondition failed.*about:blank/i);
  });

  it("4. PreExecutionValidator rejects contextual media action on about:blank with zero media controls", async () => {
    if (!page) throw new Error("Page not initialized");
    await page.goto("about:blank");

    const blankObs: PageObservation = {
      url: "about:blank",
      title: "",
      headings: [],
      interactiveElements: [],
      mediaElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-0",
    };

    const action = {
      id: "media-play-contextual",
      type: ActionType.MEDIA_PLAY,
      risk: RiskLevel.LOW,
      reason: "Start contextual media playback",
    };

    await expect(
      PreExecutionValidator.validate({
        action,
        page,
        currentObservation: blankObs,
      })
    ).rejects.toThrowError(/Precondition failed.*No media controls or media resources found/i);
  });

  it("5. RecoveryEngine detects structural failure on about:blank and triggers REPLAN to repair missing prerequisite", () => {
    const action = {
      id: "media-play-step",
      type: ActionType.MEDIA_PLAY,
      target: { strategy: "role" as const, value: "Play", role: "button" },
      risk: RiskLevel.LOW,
      reason: "Start playback",
    };

    const observation: PageObservation = {
      url: "about:blank",
      title: "",
      headings: [],
      interactiveElements: [],
      mediaElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-0",
    };

    const err = new AgentError(
      "Precondition failed: Target does not exist on 'about:blank'",
      ErrorCode.VALIDATION_FAILED,
      true
    );

    const decision = RecoveryEngine.determineRecovery({
      action,
      error: err,
      attempt: 1,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 3,
      observation,
    });

    expect(decision.strategy).toBe("REPLAN");
    expect(decision.reason).toContain("Missing navigation prerequisite");
  });

  it("6. RecoveryEngine prevents infinite spinning and detects no-progress on about:blank", () => {
    const action = {
      id: "media-play-step",
      type: ActionType.MEDIA_PLAY,
      target: { strategy: "role" as const, value: "Play", role: "button" },
      risk: RiskLevel.LOW,
      reason: "Start playback",
    };

    const observation: PageObservation = {
      url: "about:blank",
      title: "",
      headings: [],
      interactiveElements: [],
      mediaElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-0",
    };

    const err = new AgentError(
      "Precondition failed: Target does not exist on 'about:blank'",
      ErrorCode.VALIDATION_FAILED,
      true
    );

    // When replans were already attempted and still stuck on about:blank with no navigation URL
    const decision = RecoveryEngine.determineRecovery({
      action,
      error: err,
      attempt: 2,
      maxAttempts: 3,
      replansUsed: 1,
      maxReplans: 3,
      observation,
    });

    expect(decision.strategy).toBe("WAITING_FOR_USER");
    expect(decision.reason).toContain("No-progress detected");
  });

  it("7. DynamicTaskPlanner.replan repairs missing navigation when browser failed on about:blank", () => {
    const currentPlan = {
      id: "plan-1",
      taskInterpretation: "play sweetheart song on youtube",
      actions: [
        {
          id: "step-1-nav",
          type: ActionType.NAVIGATE,
          value: "https://www.youtube.com",
          risk: RiskLevel.LOW,
          reason: "Navigate to target platform",
        },
        {
          id: "step-2-play",
          type: ActionType.MEDIA_PLAY,
          target: { strategy: "role" as const, value: "Play", role: "button" },
          risk: RiskLevel.LOW,
          reason: "Play media",
        },
      ],
      successCriteria: [],
      revision: 0,
    };

    const observation: PageObservation = {
      url: "about:blank",
      title: "",
      headings: [],
      interactiveElements: [],
      mediaElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-0",
    };

    const revised = DynamicTaskPlanner.replan({
      currentPlan,
      failedStepIndex: 1,
      observation,
      failureReason: "Precondition failed: Browser remained at about:blank",
    });

    // Replan must inject missing navigation and wait rather than blindly clicking Search on about:blank
    expect(revised.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(revised.actions[0].value).toBe("https://www.youtube.com");
    expect(revised.actions[1].type).toBe(ActionType.WAIT);
    expect(revised.actions.some((a) => a.type === ActionType.MEDIA_PLAY)).toBe(true);
  });

  it("8. ActionExecutor reports truthful failure and does NOT fake playback when play fails", async () => {
    if (!page) throw new Error("Page not initialized");
    // Render a page with audio that has autoplay blocked and stays paused
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <audio id="test-audio" controls style="display: block; width: 300px; height: 50px;" src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="></audio>
          <script>
            const a = document.getElementById('test-audio');
            // Override play to simulate blocked autoplay
            a.play = () => Promise.reject(new Error("NotAllowedError: play() failed because the user didn't interact with the document first."));
          </script>
        </body>
      </html>
    `);

    const action = {
      id: "play-test",
      type: ActionType.MEDIA_PLAY,
      target: { strategy: "id" as const, value: "test-audio" },
      risk: RiskLevel.LOW,
      reason: "Start playback",
    };

    const execResult = await ActionExecutor.execute({
      action,
      page,
      tabId: "tab-0",
    });

    // Verification should truthfully fail because playback could not be started
    expect(execResult.result.status).toBe(ActionStatus.FAILED);
    expect(execResult.result.error?.message).toMatch(/Media element remained paused|Media play blocked|NotAllowedError/i);
  });

  it("9. Verification rejects media task when playback never established", () => {
    const completedSteps = [
      {
        actionId: "play-step",
        type: ActionType.MEDIA_PLAY,
        status: ActionStatus.COMPLETED,
        extractedData: {
          isPlaying: false,
          isPaused: true,
          currentTime: 0,
          duration: 100,
        },
      },
    ];

    const isAccomplished = SemanticOperationVerifier.isOperationAccomplished({
      operation: "media_play",
      completedSteps,
      extractedData: {
        isPlaying: false,
        isPaused: true,
      },
    });

    expect(isAccomplished).toBe(false);
  });

  it("10. Verification succeeds when genuine playback evidence exists", () => {
    const completedSteps = [
      {
        actionId: "play-step",
        type: ActionType.MEDIA_PLAY,
        status: ActionStatus.COMPLETED,
        verified: true,
        extractedData: {
          isPlaying: true,
          isPaused: false,
          currentTime: 2.5,
          duration: 180,
        },
      },
    ];

    const isAccomplished = SemanticOperationVerifier.isOperationAccomplished({
      operation: "media_play",
      completedSteps,
      extractedData: {
        isPlaying: true,
        isPaused: false,
      },
    });

    expect(isAccomplished).toBe(true);
  });

  it("11. Generic website resolution works across unfamiliar platforms without special-casing", () => {
    const platforms = [
      { instruction: "play jazz music on soundcloud", expectedUrl: "https://soundcloud.com" },
      { instruction: "stream trailer on vimeo", expectedUrl: "https://vimeo.com" },
      { instruction: "listen to podcast on spotify", expectedUrl: "https://open.spotify.com" },
      { instruction: "watch news stream on twitch", expectedUrl: "https://www.twitch.tv" },
      { instruction: "read discussions on reddit", expectedUrl: "https://www.reddit.com" },
    ];

    for (const item of platforms) {
      const spec = EntityConstraintResolver.resolve({ rawInstruction: item.instruction });
      expect(spec.targetUrl).toBe(item.expectedUrl);
    }
  });

  it("12. Preserves generic planning for non-media tasks (shopping search, comparison, and forms)", () => {
    // Shopping search
    const searchSpec = EntityConstraintResolver.resolve({
      rawInstruction: "search for noise cancelling headphones on amazon",
    });
    expect(searchSpec.targetUrl).toBe("https://www.amazon.com");
    expect(searchSpec.targetEntity).toBe("headphones");
    const searchPlan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: searchSpec.targetUrl });
    expect(searchPlan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(searchPlan.actions.some((a) => a.type === ActionType.FILL)).toBe(true);

    // Form fill
    const formSpec = EntityConstraintResolver.resolve({
      rawInstruction: "Fill contact form with name 'Jane Doe' and email 'jane@example.com'",
    });
    const formPlan = DynamicTaskPlanner.plan({ spec: formSpec });
    expect(formPlan.actions.some((a) => a.type === ActionType.FILL && a.value === "Jane Doe")).toBe(true);
  });
});
