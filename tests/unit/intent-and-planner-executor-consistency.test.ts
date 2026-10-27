import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { VerificationSpecBuilder } from "../../lib/planning/verification-spec";
import { SearchResultResolver } from "../../lib/browser/search-result-resolver";
import { ActionExecutor } from "../../lib/browser/action-executor";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { RecoveryEngine } from "../../lib/agent/recovery-engine";
import { ActionType, ActionStatus, RiskLevel } from "../../lib/types/actions";
import { PageObservation } from "../../lib/types/browser";
import { AgentError, ErrorCode } from "../../lib/types/errors";

describe("Search Intent, Planner-Executor Consistency, and Verified Media Playback Regression Suite", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });

  // 1. Media intent never falls through to product-card locator strategies without evidence
  it("1. Media search task never injects product-card locator strategies into the action plan", () => {
    const instruction = "search kya baat hai on youtube";
    const spec = EntityConstraintResolver.resolve({ rawInstruction: instruction });

    expect(spec.resultType).toBe("media");
    expect(spec.actionIntent).toBe("search");
    expect(spec.targetWebsite).toBe("youtube");
    expect(spec.searchQuery).toContain("kya baat hai");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions.length).toBeGreaterThan(0);

    // Verify no action contains product card selectors
    for (const action of plan.actions) {
      const targetVal = action.target
        ? typeof action.target.value === "string"
          ? action.target.value
          : JSON.stringify(action.target.value)
        : "";
      expect(targetVal).not.toContain(".product-card");
      expect(targetVal).not.toContain(".result-card");
      expect(targetVal).not.toContain(".product-title");
      expect(targetVal).not.toContain(".product-price");
      expect(action.id).not.toBe("extract-title");
      expect(action.id).not.toBe("extract-price");
    }

    // Pure search verification spec only requires resultsExist
    const verSpec = VerificationSpecBuilder.build(spec);
    expect(verSpec.requiredOperations).toContain("search");
    expect(verSpec.verificationCriteria.map((c) => c.expectedKey)).not.toContain("titleExtracted");
    expect(verSpec.requiredOperations).not.toContain("media_play");
  });

  // 1b. Media play task creates media click and play actions without product-card selectors
  it("1b. Media play task generates media-play action and clean semantic result click without product selectors", () => {
    const instruction = "play kya baat hai song on youtube";
    const spec = EntityConstraintResolver.resolve({ rawInstruction: instruction });

    expect(spec.resultType).toBe("media");
    expect(spec.actionIntent).toBe("play");

    const plan = DynamicTaskPlanner.plan({ spec });
    const clickAction = plan.actions.find((a) => a.id.includes("click-result"));
    const playAction = plan.actions.find((a) => a.id.includes("media-play"));

    expect(clickAction).toBeDefined();
    expect(playAction).toBeDefined();

    const targetVal = String(clickAction?.target?.value || "");
    expect(targetVal).not.toContain(".product-card");
    expect(targetVal).not.toContain("/track/");
    expect(targetVal).not.toContain(".product-title");

    const verSpec = VerificationSpecBuilder.build(spec);
    expect(verSpec.requiredOperations).toContain("media");
  });

  // 2. Product comparison tasks still correctly identify product cards and prices
  it("2. Product comparison tasks correctly generate product-card extraction and price verification", () => {
    const instruction = "find the cheapest laptop under 500 on amazon";
    const spec = EntityConstraintResolver.resolve({ rawInstruction: instruction });

    expect(spec.resultType).toBe("product");
    expect(spec.actionIntent).toBe("compare");
    expect(spec.ordering?.direction).toBe("MIN");

    const plan = DynamicTaskPlanner.plan({ spec });
    const extractAction = plan.actions.find((a) => a.id.includes("extract"));
    expect(extractAction).toBeDefined();
    expect(extractAction?.reason).toContain("Extract product cards");

    const verSpec = VerificationSpecBuilder.build(spec);
    expect(verSpec.verificationCriteria.length).toBeGreaterThan(0);
  });

  // 3. Article and documentation searches use their own live result evidence
  it("3. Article tasks generate open/navigation intent without price scraping or product selectors", () => {
    const instruction = "search for Deep Residual Learning on wikipedia and open the article result";
    const spec = EntityConstraintResolver.resolve({ rawInstruction: instruction });

    expect(spec.resultType).toBe("article");
    expect(spec.actionIntent).toBe("open");

    const plan = DynamicTaskPlanner.plan({ spec });
    for (const action of plan.actions) {
      const targetVal = action.target
        ? typeof action.target.value === "string"
          ? action.target.value
          : JSON.stringify(action.target.value)
        : "";
      expect(targetVal).not.toContain(".product-card");
      expect(targetVal).not.toContain(".product-price");
    }

    const verSpec = VerificationSpecBuilder.build(spec);
    expect(verSpec.requiredOperations).toContain("navigate");
    expect(verSpec.requiredOperations).not.toContain("media_play");
  });

  // 4. The resolver does not build a composite CSS selector and treat it as a natural-language search query
  it("4. SearchResultResolver matches candidate elements based on natural language query, not CSS selector text", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="results">
          <div class="result-item">
            <a href="/watch?v=kya123" class="title-link">Kya Baat Haii 2.0 Official Video</a>
            <p>Harrdy Sandhu, B Praak, Jaani</p>
          </div>
          <div class="result-item">
            <a href="/watch?v=other456" class="title-link">Some Unrelated Music Track</a>
          </div>
        </div>
      </body>
      </html>
    `);

    const result = await SearchResultResolver.resolveSearchResult(page, {
      query: "kya baat hai",
      taskType: "media",
    });

    expect(result.status).toBe("resolved");
    expect(result.selectedCandidate).toBeDefined();
    expect(result.selectedCandidate?.title).toContain("Kya Baat Haii");
    expect(result.selectedCandidate?.url).toBe("/watch?v=kya123");
  });

  // 5. Duplicate thumbnail/title links are deduplicated
  it("5. Duplicate thumbnail and title controls pointing to the same result are deduplicated", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="video-item" id="item-kya">
          <!-- Thumbnail link -->
          <a href="/watch?v=dup123" class="thumbnail-link" aria-hidden="true">
            <img src="/thumb.jpg" alt="Kya Baat Hai" />
          </a>
          <!-- Title link -->
          <a href="/watch?v=dup123" class="title-link">
            <h3>Kya Baat Hai - Full Video</h3>
          </a>
        </div>
      </body>
      </html>
    `);

    const extraction = await SearchResultResolver.extractCandidates(page);
    // Candidates pointing to the same card/destination are normalized
    const matching = extraction.candidates.filter((c) => c.url === "/watch?v=dup123");
    // Should be exactly 1 candidate selected for the card/url
    expect(matching.length).toBe(1);
    expect(matching[0].title).toBe("Kya Baat Hai - Full Video");
  });

  // 6. Similar but distinct results are ranked or clarified appropriately
  it("6. Decisive ranking selects the best match; genuinely indistinguishable candidates return clarify", async () => {
    // Decisive case
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="card" id="c1">
          <a href="/watch?v=exact" class="title-link"><h3>Kya Baat Hai Official Video</h3></a>
        </div>
        <div class="card" id="c2">
          <a href="/watch?v=unrelated" class="title-link"><h3>Completely Unrelated Cooking Tutorial</h3></a>
        </div>
      </body>
      </html>
    `);

    const decisiveResult = await SearchResultResolver.resolveSearchResult(page, {
      query: "kya baat hai",
      taskType: "media",
    });
    expect(decisiveResult.status).toBe("resolved");
    expect(decisiveResult.selectedCandidate?.url).toBe("/watch?v=exact");

    // Indistinguishable case (exact duplicates on distinct cards with distinct URLs)
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="card" id="cardA">
          <a href="/watch?v=versionA" class="title-link"><h3>Kya Baat Hai</h3></a>
        </div>
        <div class="card" id="cardB">
          <a href="/watch?v=versionB" class="title-link"><h3>Kya Baat Hai</h3></a>
        </div>
      </body>
      </html>
    `);

    const ambiguousResult = await SearchResultResolver.resolveSearchResult(page, {
      query: "kya baat hai",
      taskType: "media",
    });
    expect(ambiguousResult.status).toBe("ambiguous");
    expect(ambiguousResult.ambiguityReason).toBeDefined();
  });

  // 7. A stale locator triggers fresh observation and re-resolution
  it("7. ActionExecutor re-resolves and clicks when search result candidate element is detached or re-rendered", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="container">
          <a id="target-link" href="/watch?v=rendered1">Kya Baat Hai Original</a>
        </div>
      </body>
      </html>
    `);

    let clicked = false;
    await page.exposeFunction("__onReRenderClick", () => {
      clicked = true;
    }).catch(() => {});

    await page.evaluate(() => {
      const link = document.querySelector("#target-link");
      link?.addEventListener("click", () => {
        (window as any).__onReRenderClick();
      });
    });

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: {
          strategy: "css",
          value: "a",
          isSearchResult: true,
          description: "Select matching media result",
        } as any,
        value: "kya baat hai",
        risk: RiskLevel.LOW,
        reason: "Open search result",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.COMPLETED);
    expect(clicked).toBe(true);
  });

  // 8. Recovery preserves task intent and does not repeat an ineffective action indefinitely
  it("8. RecoveryEngine preserves original task intent and limits retries without switching to product selectors", () => {
    const originalAction = {
      id: "step-click-result",
      type: ActionType.CLICK,
      target: {
        strategy: "css" as const,
        value: "a.nonexistent-media-link",
      },
      reason: "Click search result",
    };

    const mockObservation: PageObservation = {
      url: "https://www.youtube.com/results?search_query=kya+baat+hai",
      title: "YouTube",
      headings: [],
      forms: [],
      dialogs: [],
      interactiveElements: [],
      summary: "Results page",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const dummyPlan = {
      id: "plan-media",
      taskInterpretation: "play kya baat hai on youtube",
      actions: [originalAction],
      successCriteria: ["Media active"],
    };

    const err = new AgentError("Element not found", ErrorCode.ELEMENT_NOT_FOUND, true);

    const recovery1 = RecoveryEngine.determineRecovery({
      action: originalAction,
      error: err,
      attempt: 1,
      maxAttempts: 2,
      replansUsed: 0,
      maxReplans: 2,
      observation: mockObservation,
      plan: dummyPlan,
    });

    if (recovery1.alternativeActions && recovery1.alternativeActions.length > 0) {
      for (const alt of recovery1.alternativeActions) {
        const suggestedVal = String(alt.target?.value || "");
        expect(suggestedVal).not.toContain(".product-card");
        expect(suggestedVal).not.toContain(".product-price");
      }
    }

    // When attempts and replans are exhausted, abort safely
    const recoveryMax = RecoveryEngine.determineRecovery({
      action: originalAction,
      error: err,
      attempt: 2,
      maxAttempts: 2,
      replansUsed: 2,
      maxReplans: 2,
      observation: mockObservation,
      plan: dummyPlan,
    });

    expect(recoveryMax.strategy).toBe("FAIL");
    expect(recoveryMax.terminal).toBe(true);
  });

  // 9. A successful click with no resulting playback is not task success
  it("9. A successful click without subsequent playback does NOT satisfy media task verification", () => {
    const taskResult = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Kya Baat Hai song on youtube",
      planActions: [
        { id: "step-1", type: ActionType.NAVIGATE, risk: RiskLevel.LOW, reason: "Navigate" },
        { id: "step-2", type: ActionType.CLICK, risk: RiskLevel.LOW, reason: "Select result" },
        { id: "step-3", type: ActionType.MEDIA_PLAY, risk: RiskLevel.LOW, reason: "Start playback" },
      ],
      completedSteps: [
        { actionId: "step-1", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, retriesUsed: 0, verified: true },
        { actionId: "step-2", type: ActionType.CLICK, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, retriesUsed: 0, verified: true },
        {
          actionId: "step-3",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 10,
          retriesUsed: 0,
          verified: false,
          extractedData: { isPlaying: false, isPaused: true },
        },
      ],
      latestObservation: {
        url: "https://www.youtube.com/watch?v=123",
        title: "Kya Baat Hai",
        headings: ["Kya Baat Hai"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Paused video player",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
        mediaElements: [
          {
            id: "yt-player",
            tagName: "video",
            isPlaying: false,
            isPaused: true,
            isMuted: false,
            currentTime: 0,
            duration: 215,
            volume: 1,
            readyState: 2,
            ended: false,
          },
        ],
      },
      extractedData: { isPlaying: false, isPaused: true },
    });

    expect(taskResult.passed).toBe(false);
    expect(taskResult.failedChecks).toContain("mediaPlaybackActive");
  });

  // 10. A media task cannot pass without independent playback evidence
  it("10. A media task requires independent playback evidence (isPlaying: true, currentTime > 0)", () => {
    const taskResult = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Kya Baat Hai song on youtube",
      planActions: [
        { id: "step-1", type: ActionType.NAVIGATE, risk: RiskLevel.LOW, reason: "Navigate" },
        { id: "step-2", type: ActionType.CLICK, risk: RiskLevel.LOW, reason: "Select result" },
        { id: "step-3", type: ActionType.MEDIA_PLAY, risk: RiskLevel.LOW, reason: "Start playback" },
      ],
      completedSteps: [
        { actionId: "step-1", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, retriesUsed: 0, verified: true },
        { actionId: "step-2", type: ActionType.CLICK, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, retriesUsed: 0, verified: true },
        {
          actionId: "step-3",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 10,
          retriesUsed: 0,
          verified: true,
          extractedData: { isPlaying: true, isPaused: false, currentTime: 4.2 },
        },
      ],
      latestObservation: {
        url: "https://www.youtube.com/watch?v=123",
        title: "Kya Baat Hai",
        headings: ["Kya Baat Hai"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Active video player",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
        mediaElements: [
          {
            id: "yt-player",
            tagName: "video",
            isPlaying: true,
            isPaused: false,
            isMuted: false,
            currentTime: 4.2,
            duration: 215,
            volume: 1,
            readyState: 4,
            ended: false,
          },
        ],
      },
      extractedData: { isPlaying: true, isPaused: false, currentTime: 4.2 },
    });

    expect(taskResult.passed).toBe(true);
    expect(taskResult.outcome).toBe("success");
    expect(taskResult.failedChecks).toHaveLength(0);
  });

  // 11. Playwright-only mode does not make mandatory LLM calls
  it("11. DynamicTaskPlanner and VerificationSpecBuilder execute purely in deterministic Playwright-only mode", () => {
    const testCases = [
      "search kya baat hai on youtube",
      "play kya baat hai song on youtube",
      "find the cheapest laptop on amazon",
      "search for Deep Residual Learning on wikipedia and open the article result",
    ];

    for (const rawInstruction of testCases) {
      const spec = EntityConstraintResolver.resolve({ rawInstruction });
      expect(spec).toBeDefined();
      const plan = DynamicTaskPlanner.plan({ spec });
      expect(plan.actions.length).toBeGreaterThan(0);
      const verSpec = VerificationSpecBuilder.build(spec);
      expect(verSpec).toBeDefined();
    }
  });

  // 12. Authentication and CAPTCHA barriers remain safely handled
  it("12. ActionExecutor detects authentication barrier and halts with FAILED and AUTH_REQUIRED", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div role="alert" class="login-gate">
          Sign in to confirm you're not a bot or to listen to this video.
        </div>
      </body>
      </html>
    `);

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-media-play",
        type: ActionType.MEDIA_PLAY,
        target: { strategy: "css", value: "video" },
        risk: RiskLevel.LOW,
        reason: "Engage playback",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.AUTH_REQUIRED);
    expect(exec.result.error?.recoverable).toBe(false);
  });
});
