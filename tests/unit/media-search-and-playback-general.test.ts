import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { ActionExecutor } from "../../lib/browser/action-executor";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { RecoveryEngine } from "../../lib/agent/recovery-engine";
import { ActionType, ActionStatus, RiskLevel } from "../../lib/types/actions";
import { ErrorCode, AgentError } from "../../lib/types/errors";
import { PageObservation } from "../../lib/types/browser";

describe("Generic Search Result Selection and Media Playback Regression Suite", () => {
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

  // 1. Search result whose link uses /watch?v=... (YouTube style)
  it("1. Resolves and clicks a search result whose link uses /watch?v=... without /track/ assumption", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <ytd-video-renderer>
            <a id="video-title" href="/watch?v=abc123xyz" title="Kya Baat Haii 2.0 Full Video">
              Kya Baat Haii 2.0 Full Video
            </a>
          </ytd-video-renderer>
        </div>
      </body>
      </html>
    `);

    let clickedHref: string | null = null;
    await page.exposeFunction("__onResultClicked", (href: string) => {
      clickedHref = href;
    }).catch(() => {});

    await page.evaluate(() => {
      const link = document.querySelector("a#video-title");
      if (link) {
        link.addEventListener("click", () => {
          (window as any).__onResultClicked(link.getAttribute("href"));
          const playerDiv = document.createElement("div");
          playerDiv.id = "player-container";
          playerDiv.innerHTML = "<h1>Video Player Active</h1>";
          document.body.appendChild(playerDiv);
        });
      }
    });

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: {
          strategy: "css",
          value: `a[href*='watch']:has-text("kya baat hai"), a[href*='/track/']:has-text("kya baat hai"), a:has-text("kya baat hai")`,
        },
        value: "kya baat hai",
        risk: RiskLevel.LOW,
        reason: "Select and open matching media result for 'kya baat hai'",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.COMPLETED);
    expect(clickedHref).toBe("/watch?v=abc123xyz");
  });

  // 2. Result with a different URL structure (e.g. /video/12345 or /item/...)
  it("2. Resolves and clicks a result with an arbitrary URL structure (/video/...) without assuming /track/", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div class="search-feed">
          <div class="video-card">
            <a href="/video/87654321" title="India's Got Latent Episode 1">
              <h3>India's Got Latent Episode 1</h3>
            </a>
          </div>
        </div>
      </body>
      </html>
    `);

    let clickedHref: string | null = null;
    await page.exposeFunction("__onVideoClicked", (href: string) => {
      clickedHref = href;
    }).catch(() => {});

    await page.evaluate(() => {
      const a = document.querySelector("a[href='/video/87654321']");
      if (a) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          (window as any).__onVideoClicked(a.getAttribute("href"));
          const h = document.createElement("h2");
          h.textContent = "Video Player Loaded";
          document.body.appendChild(h);
        });
      }
    });

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: {
          strategy: "css",
          value: `a:has-text("India's Got Latent Episode 1")`,
        },
        value: "India's Got Latent Episode 1",
        risk: RiskLevel.LOW,
        reason: "Select and open matching media result for 'India's Got Latent Episode 1'",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.COMPLETED);
    expect(clickedHref).toBe("/video/87654321");
  });

  // 3. Multiple similar titles and ranking/selection
  it("3. Ranks and selects the primary music/video result above tutorials and reaction videos", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <!-- Tutorial result -->
          <div class="result-item">
            <a id="res-tutorial" href="/watch?v=tut123" title="Kya Baat Hai - Easy Guitar Lesson & Tutorial">
              Kya Baat Hai - Easy Guitar Lesson & Tutorial
            </a>
          </div>
          <!-- Exact music video result -->
          <div class="result-item">
            <a id="res-official" href="/watch?v=official123" title="Kya Baat Hai 2.0 (Official Video) - Harrdy Sandhu">
              Kya Baat Hai 2.0 (Official Video) - Harrdy Sandhu
            </a>
          </div>
          <!-- Reaction result -->
          <div class="result-item">
            <a id="res-reaction" href="/watch?v=react123" title="Musicians React to Kya Baat Hai Video">
              Musicians React to Kya Baat Hai Video
            </a>
          </div>
        </div>
      </body>
      </html>
    `);

    let selectedId: string | null = null;
    await page.exposeFunction("__onSelectionConfirmed", (id: string) => {
      selectedId = id;
    }).catch(() => {});

    await page.evaluate(() => {
      document.querySelectorAll("a").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          (window as any).__onSelectionConfirmed(el.id);
          const h = document.createElement("h2");
          h.textContent = "Selected Result: " + el.id;
          document.body.appendChild(h);
        });
      });
    });

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: { strategy: "css", value: "a:visible" },
        value: "Kya Baat Hai",
        risk: RiskLevel.LOW,
        reason: "Select and open matching media result for 'Kya Baat Hai'",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.COMPLETED);
    expect(selectedId).toBe("res-official");
  });

  // 4. Missing results and changed DOM after search
  it("4. Fails honestly with recoverable ELEMENT_NOT_FOUND when search yields zero matching results", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="results">
          <p>No matching videos found for your query.</p>
          <a href="/trending">Trending Videos</a>
        </div>
      </body>
      </html>
    `);

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: { strategy: "css", value: "a:visible" },
        value: "Nonexistent Song Title 987654321",
        risk: RiskLevel.LOW,
        reason: "Select and open matching media result for 'Nonexistent Song Title 987654321'",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
    expect(exec.result.error?.recoverable).toBe(true);
    expect(exec.result.error?.message).toContain("No matching search result found");
  });

  // 5. Stale or hidden duplicate locator
  it("5. Bypasses hidden duplicate candidate and clicks the visible, actionable result", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <!-- Hidden duplicate from offscreen drawer or mobile template -->
        <div style="display: none;">
          <a id="hidden-link" href="/watch?v=stale" title="Kya Baat Hai">
            Kya Baat Hai
          </a>
        </div>
        <!-- Visible desktop search result -->
        <div id="main-results">
          <a id="visible-link" href="/watch?v=active" title="Kya Baat Hai">
            Kya Baat Hai
          </a>
        </div>
      </body>
      </html>
    `);

    let clickedDuplicate: string | null = null;
    await page.exposeFunction("__onDuplicateConfirmed", (id: string) => {
      clickedDuplicate = id;
    }).catch(() => {});

    await page.evaluate(() => {
      document.querySelectorAll("a").forEach((el) => {
        el.addEventListener("click", (e) => {
          e.preventDefault();
          (window as any).__onDuplicateConfirmed(el.id);
          const h = document.createElement("h2");
          h.textContent = "Opened: " + el.id;
          document.body.appendChild(h);
        });
      });
    });

    const exec = await ActionExecutor.execute({
      action: {
        id: "step-click-result",
        type: ActionType.CLICK,
        target: { strategy: "css", value: "a:visible" },
        value: "Kya Baat Hai",
        risk: RiskLevel.LOW,
        reason: "Select and open matching media result for 'Kya Baat Hai'",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.COMPLETED);
    expect(clickedDuplicate).toBe("visible-link");
  });

  // 6. Clicking a result without successful playback fails verification
  it("6. TaskVerifier fails closed if search and click succeed but media playback does not start", () => {
    const plan = {
      id: "plan-media",
      taskInterpretation: "play video",
      actions: [
        { id: "step-1", type: ActionType.NAVIGATE, value: "https://www.youtube.com" },
        { id: "step-2", type: ActionType.FILL, value: "kya baat hai" },
        { id: "step-3", type: ActionType.CLICK, reason: "Select and open matching media result" },
        { id: "step-4", type: ActionType.MEDIA_PLAY, reason: "Start media playback" },
      ],
      successCriteria: ["Media active"],
    };

    const verif = TaskVerifier.verifyTask({
      task: "open youtube and play kya baat hai song",
      plan,
      targetUrl: "https://www.youtube.com",
      completedSteps: [
        { actionId: "step-1", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-2", type: ActionType.FILL, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        { actionId: "step-3", type: ActionType.CLICK, status: ActionStatus.COMPLETED, startTime: "", endTime: "", durationMs: 10, verified: true },
        // MEDIA_PLAY returned isPlaying: false
        {
          actionId: "step-4",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 10,
          extractedData: { isPlaying: false, isPaused: true },
          verified: false,
        },
      ],
      extractedData: { isPlaying: false, isPaused: true },
      downloads: [],
      observation: {
        url: "https://www.youtube.com/watch?v=123",
        title: "Kya Baat Hai",
        headings: ["Kya Baat Hai"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Paused video player",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      },
    });

    expect(verif.passed).toBe(false);
    expect(verif.failedChecks).toContain("mediaPlaybackActive");
  });

  // 7. Playback already running vs paused vs errored media
  describe("7. Media Playback State Handling", () => {
    it("7a. Detects already running playback without unnecessary interaction", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <body>
          <video id="player" autoplay></video>
        </body>
        </html>
      `);

      // Mock HTMLMediaElement properties
      await page.evaluate(() => {
        const v = document.getElementById("player") as any;
        Object.defineProperty(v, "paused", { value: false, configurable: true });
        Object.defineProperty(v, "ended", { value: false, configurable: true });
        Object.defineProperty(v, "currentTime", { value: 5.2, configurable: true });
        Object.defineProperty(v, "readyState", { value: 4, configurable: true });
      });

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-play",
          type: ActionType.MEDIA_PLAY,
          target: { strategy: "css", value: "video" },
          risk: RiskLevel.LOW,
          reason: "Start media playback",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.COMPLETED);
      expect((exec.result.extractedData as any).isPlaying).toBe(true);
    });

    it("7b. Clicks Play control and verifies engaged playback when media starts paused", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <body>
          <video id="player"></video>
          <button class="ytp-play-button" aria-label="Play">Play</button>
        </body>
        </html>
      `);

      await page.evaluate(() => {
        const v = document.getElementById("player") as any;
        let isPlaying = false;
        Object.defineProperty(v, "paused", { get: () => !isPlaying, configurable: true });
        Object.defineProperty(v, "ended", { value: false, configurable: true });
        Object.defineProperty(v, "currentTime", { get: () => isPlaying ? 1.0 : 0, configurable: true });
        Object.defineProperty(v, "readyState", { value: 4, configurable: true });

        const btn = document.querySelector("button.ytp-play-button");
        if (btn) {
          btn.addEventListener("click", () => {
            isPlaying = true;
            btn.setAttribute("aria-label", "Pause");
            btn.setAttribute("data-title-no-tooltip", "Pause");
          });
        }
      });

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-play",
          type: ActionType.MEDIA_PLAY,
          target: { strategy: "css", value: "video, button.ytp-play-button" },
          risk: RiskLevel.LOW,
          reason: "Start media playback",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.COMPLETED);
      expect((exec.result.extractedData as any).isPlaying).toBe(true);
    });

    it("7c. Fails honestly when media element reports a fatal decoding/network error", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <body>
          <video id="player"></video>
          <button class="ytp-play-button" aria-label="Play">Play</button>
        </body>
        </html>
      `);

      await page.evaluate(() => {
        const v = document.getElementById("player") as any;
        Object.defineProperty(v, "paused", { value: true, configurable: true });
        Object.defineProperty(v, "error", {
          value: { code: 4, message: "MEDIA_ERR_SRC_NOT_SUPPORTED: Format not supported" },
          configurable: true,
        });
      });

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-play",
          type: ActionType.MEDIA_PLAY,
          target: { strategy: "css", value: "video" },
          risk: RiskLevel.LOW,
          reason: "Start media playback",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.FAILED);
      expect(exec.result.error?.message).toContain("MEDIA_ERR_SRC_NOT_SUPPORTED");
      expect(exec.result.error?.recoverable).toBe(false);
    }, 10000);
  });

  // 8. Authentication or CAPTCHA barriers
  it("8. Halts safely as BLOCKED and reports AUTH_REQUIRED on sign-in barrier", async () => {
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
        id: "step-play",
        type: ActionType.MEDIA_PLAY,
        target: { strategy: "css", value: "video" },
        risk: RiskLevel.LOW,
        reason: "Start media playback",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.AUTH_REQUIRED);
    expect(exec.result.error?.recoverable).toBe(false);
  });

  // 9. Recovery without repeated invalid selectors
  it("9. Recovery engine proposes replan or alternative rather than repeating identical failing selector", () => {
    const plan = {
      id: "plan-recovery",
      taskInterpretation: "play video",
      actions: [
        {
          id: "step-click-result",
          type: ActionType.CLICK,
          target: { strategy: "css" as const, value: "a[href*='watch']" },
          reason: "Select result",
        },
      ],
      successCriteria: ["Video playing"],
    };

    const mockObservation: PageObservation = {
      url: "https://www.youtube.com/results?search_query=test",
      title: "YouTube",
      interactiveElements: [
        {
          id: "alt-link",
          role: "link",
          tagName: "A",
          href: "https://www.youtube.com/watch?v=alt123",
          text: "Alternative Matching Song",
          isVisible: true,
          isEnabled: true,
        },
      ],
      headings: [],
      forms: [],
      dialogs: [],
      summary: "Results page",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const err = new AgentError("Target element not found", ErrorCode.ELEMENT_NOT_FOUND, true);

    const decision = RecoveryEngine.determineRecovery({
      action: plan.actions[0],
      error: err,
      attempt: 2,
      maxAttempts: 2,
      replansUsed: 0,
      maxReplans: 2,
      observation: mockObservation,
      plan,
      failedTargets: new Set(["css:a[href*='watch']"]),
    });

    expect(["REPLAN", "RETRY_WITH_ALTERNATIVE_LOCATOR"]).toContain(decision.strategy);
    expect(decision.terminal).toBe(false);
  });

  // 10. Generic search and playback tasks without hardcoded task-specific logic
  it("10. Generates complete media workflow for generic tasks across different platforms", () => {
    // Wikipedia topic
    const wikiSpec = EntityConstraintResolver.resolve({
      rawInstruction: "open wikipedia and search for quantum computing",
    });
    expect(wikiSpec.targetUrl).toBe("https://www.wikipedia.org");
    const wikiPlan = DynamicTaskPlanner.plan({ spec: wikiSpec });
    expect(wikiPlan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(wikiPlan.actions.some((a) => a.type === ActionType.FILL)).toBe(true);

    // Vimeo / generic video task
    const vimeoSpec = EntityConstraintResolver.resolve({
      rawInstruction: "play nature documentary on vimeo",
    });
    expect(vimeoSpec.operation).toBe("MEDIA_PLAY");
    expect(vimeoSpec.targetWebsite).toBe("vimeo");
    expect(vimeoSpec.targetUrl).toBe("https://vimeo.com");

    const vimeoPlan = DynamicTaskPlanner.plan({ spec: vimeoSpec });
    expect(vimeoPlan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(vimeoPlan.actions[0].value).toBe("https://vimeo.com");
    expect(vimeoPlan.actions.some((a) => a.type === ActionType.FILL)).toBe(true);
    expect(vimeoPlan.actions.some((a) => a.type === ActionType.CLICK && a.id.includes("click-result"))).toBe(true);
    expect(vimeoPlan.actions.some((a) => a.type === ActionType.MEDIA_PLAY)).toBe(true);
  });
});
