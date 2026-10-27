import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { ChallengeDetector } from "@/lib/browser/challenge-detector";
import { PageObserver } from "@/lib/browser/page-observer";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { ActionVerifier } from "@/lib/agent/action-verifier";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { SemanticDecomposer } from "@/lib/agent/semantic-decomposer";
import { EntityConstraintResolver } from "@/lib/planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "@/lib/planning/dynamic-task-planner";
import { ActionType, ActionStatus, RiskLevel } from "@/lib/types/actions";
import { ErrorCode } from "@/lib/types/errors";
import { PageObservation } from "@/lib/types/browser";
import { BrowserManager } from "@/lib/browser/browser-manager";

describe("Generic Media Search, Selection, Playback & Challenge Classification Regression Suite", () => {
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

  describe("1. Generic Media Task Decomposition & Workflow Synthesis", () => {
    it("decomposes media query into MEDIA_PLAY intent type without falling back to EXTRACT", () => {
      const intent = SemanticDecomposer.decompose("play Kya Baat Hai song on spotify");
      expect(intent.intentType).toBe("MEDIA_PLAY");
      expect(intent.query?.toLowerCase()).toContain("kya baat hai");
    });

    it("resolves target platform and media properties generically without hardcoding", () => {
      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play Kya Baat Hai song on spotify",
      });

      expect(spec.operation).toBe("MEDIA_PLAY");
      expect(spec.targetWebsite).toBe("spotify");
      expect(spec.targetUrl).toBe("https://open.spotify.com");
      expect(spec.searchQuery?.toLowerCase()).toContain("kya baat hai");
      expect(spec.mediaProperties?.action).toBe("play");
    });

    it("synthesizes complete ordered workflow: navigate -> search fill -> search submit -> wait results -> open match -> mediaPlay -> finish", () => {
      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play Kya Baat Hai song on spotify",
      });

      const plan = DynamicTaskPlanner.plan({
        spec,
        targetUrl: spec.targetUrl,
      });

      const actionTypes = plan.actions.map((a) => a.type);
      expect(actionTypes[0]).toBe(ActionType.NAVIGATE);
      expect(actionTypes).toContain(ActionType.FILL);
      expect(actionTypes).toContain(ActionType.CLICK);
      expect(actionTypes).toContain(ActionType.MEDIA_PLAY);
      expect(actionTypes[actionTypes.length - 1]).toBe(ActionType.FINISH);

      // Verify fill action targets search input with requested query
      const fillAction = plan.actions.find((a) => a.type === ActionType.FILL);
      expect(fillAction?.value?.toString().toLowerCase()).toContain("kya baat hai");

      // Verify specific result click action targets matching media link
      const clickAction = plan.actions.find((a) => a.type === ActionType.CLICK && a.id?.includes("click-result"));
      expect(clickAction).toBeDefined();
      expect(clickAction?.reason).toContain("Select and open matching media result");
    });

    it("reuses existing context without re-navigating when browser is already on a suitable media page", () => {
      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play Kya Baat Hai song on spotify",
      });

      const observationOnTrack: PageObservation = {
        url: "https://open.spotify.com/track/1ZaeaGLhFSckG8sv1y7AWk",
        title: "Kya Baat Ay - Song by Harrdy Sandhu | Spotify",
        headings: ["Kya Baat Ay"],
        interactiveElements: [
          {
            id: "play-btn",
            role: "button",
            tagName: "BUTTON",
            text: "Play",
            ariaLabel: "Play",
            isVisible: true,
            isEnabled: true,
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Track page for Kya Baat Ay",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const plan = DynamicTaskPlanner.plan({
        spec,
        targetUrl: "https://open.spotify.com",
        observation: observationOnTrack,
      });

      // Must NOT navigate again since browser is already on the target track page
      const navActions = plan.actions.filter((a) => a.type === ActionType.NAVIGATE);
      expect(navActions.length).toBe(0);
      expect(plan.actions.some((a) => a.type === ActionType.MEDIA_PLAY)).toBe(true);
    });
  });

  describe("2. Challenge & Access Restriction Detection Integrity (Eliminating False Positives)", () => {
    it("does NOT classify a normal page with hidden passive reCAPTCHA tokens as CAPTCHA", () => {
      // Recreates Spotify Web Player's exact structure where Google reCAPTCHA Enterprise is loaded in the background
      const normalObsWithPassiveToken: PageObservation = {
        url: "https://open.spotify.com/",
        title: "Spotify – Web Player: Music for everyone",
        headings: ["Spotify – Web Player: Music for everyone"],
        interactiveElements: [
          {
            id: "search-input",
            role: "combobox",
            tagName: "INPUT",
            type: "search",
            placeholder: "What do you want to play?",
            isVisible: true,
            isEnabled: true,
          },
          {
            // Hidden passive risk scoring token injected by reCAPTCHA v3 / Enterprise
            id: "g-recaptcha-response-100000",
            tagName: "TEXTAREA",
            name: "g-recaptcha-response",
            isVisible: false, // NOT VISIBLE
            isEnabled: true,
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Spotify Web Player homepage with search and track browse.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(normalObsWithPassiveToken);
      expect(result.isBlocked).toBe(false);
      expect(result.blockType).toBeUndefined();
    });

    it("does NOT classify a normal login screen as CAPTCHA", () => {
      const loginObs: PageObservation = {
        url: "https://accounts.spotify.com/en/login",
        title: "Log in to Spotify",
        headings: ["Log in to Spotify"],
        interactiveElements: [
          {
            id: "login-username",
            tagName: "INPUT",
            type: "text",
            placeholder: "Email or username",
            isVisible: true,
            isEnabled: true,
          },
          {
            id: "login-password",
            tagName: "INPUT",
            type: "password",
            placeholder: "Password",
            isVisible: true,
            isEnabled: true,
          },
          {
            id: "login-button",
            role: "button",
            tagName: "BUTTON",
            text: "Log In",
            isVisible: true,
            isEnabled: true,
          },
        ],
        forms: [{ action: "/api/login", inputs: ["username", "password"] }],
        dialogs: [],
        summary: "Ordinary login page",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(loginObs);
      expect(result.isBlocked).toBe(false);
    });

    it("does NOT classify a cookie-consent or privacy dialog as CAPTCHA", () => {
      const cookieObs: PageObservation = {
        url: "https://open.spotify.com/",
        title: "Spotify – Web Player",
        headings: ["Spotify – Web Player"],
        interactiveElements: [
          {
            id: "onetrust-accept-btn",
            role: "button",
            tagName: "BUTTON",
            text: "Accept all cookies",
            isVisible: true,
            isEnabled: true,
          },
        ],
        forms: [],
        dialogs: [
          {
            type: "modal",
            message: "This site uses cookies to personalize your experience.",
          },
        ],
        summary: "Page with cookie consent banner",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(cookieObs);
      expect(result.isBlocked).toBe(false);
    });

    it("does NOT classify a search query containing the word 'captcha' as a challenge", () => {
      const searchCaptchaObs: PageObservation = {
        url: "https://open.spotify.com/search/captcha%20soundtrack",
        title: "Spotify – Search",
        headings: ["Search Results"],
        interactiveElements: [
          {
            id: "search-input",
            tagName: "INPUT",
            type: "search",
            value: "captcha soundtrack",
            isVisible: true,
            isEnabled: true,
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Search results for query 'captcha soundtrack'",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(searchCaptchaObs);
      expect(result.isBlocked).toBe(false);
    });

    it("STILL correctly identifies a genuine visible CAPTCHA challenge as BLOCKED", () => {
      const genuineCaptchaObs: PageObservation = {
        url: "https://target-platform.com/security/captcha",
        title: "Security Verification - Please verify you are human",
        headings: ["Verify you are human"],
        interactiveElements: [
          {
            id: "recaptcha-anchor",
            tagName: "INPUT",
            type: "checkbox",
            text: "I'm not a robot",
            isVisible: true, // VISIBLE human challenge
            isEnabled: true,
          },
        ],
        forms: [{ action: "/security/verify", inputs: ["token"] }],
        dialogs: [],
        summary: "Security verification challenge page.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(genuineCaptchaObs);
      expect(result.isBlocked).toBe(true);
      expect(result.blockType).toBe("CAPTCHA");
      expect(result.reason).toContain("manual CAPTCHA verification");
    });
  });

  describe("3. Live DOM Observation & Modern Web Audio UI Playback State Detection", () => {
    it("detects active playback from UI player Pause control when <audio>/<video> tags are absent (e.g. Spotify)", async () => {
      // Create local HTML fixture with custom Web Audio player (no <audio> or <video> tags)
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Modern Web Audio Player Fixture</title></head>
        <body style="margin: 0; padding: 20px;">
          <header>
            <input type="search" placeholder="What do you want to play?" aria-label="Search" data-testid="search-input" />
            <button data-testid="search-icon" aria-label="Search" type="submit">Search</button>
          </header>
          <main>
            <div class="track-row">
              <a href="/track/kya-baat-hai">Kya Baat Hai</a>
              <span>Harrdy Sandhu</span>
            </div>
          </main>
          <!-- Bottom Player Bar with active playback indicated by Pause toggle -->
          <footer class="player-bar" style="position: fixed; bottom: 0; width: 100%; height: 60px; background: #282828;">
            <div data-testid="now-playing-widget">
              <span data-testid="context-item-info-title">Kya Baat Hai</span>
            </div>
            <button data-testid="control-button-playpause" aria-label="Pause" style="width: 32px; height: 32px;">Pause</button>
          </footer>
        </body>
        </html>
      `);

      const observation = await PageObserver.observe(page, "tab-test");

      // Verify that PageObserver inspected the UI player state and synthesized playback evidence
      expect(observation.mediaElements?.length).toBeGreaterThan(0);
      const media = observation.mediaElements![0];
      expect(media.isPlaying).toBe(true);
      expect(media.isPaused).toBe(false);
      expect(media.readyState).toBe(4);
    });

    it("ActionVerifier verifies media playback when UI player shows Pause state", () => {
      const verified = ActionVerifier.verifyAction({
        action: {
          id: "act-play",
          type: ActionType.MEDIA_PLAY,
          risk: RiskLevel.LOW,
          reason: "Start playback",
        },
        beforeObservation: {} as any,
        afterObservation: {
          mediaElements: [
            {
              id: "ui-player",
              tagName: "audio",
              isPlaying: true,
              isPaused: false,
              isMuted: false,
              currentTime: 1,
              duration: 0,
              volume: 1,
              readyState: 4,
              ended: false,
            },
          ],
        } as any,
        extractedValue: { isPlaying: true, isPaused: false, mode: "ui_player" },
      });

      expect(verified.verified).toBe(true);
      expect(verified.reason).toContain("Media playback successfully verified");
    });

    it("ActionVerifier honestly fails verification when media element or player remains paused", () => {
      const verified = ActionVerifier.verifyAction({
        action: {
          id: "act-play",
          type: ActionType.MEDIA_PLAY,
          risk: RiskLevel.LOW,
          reason: "Start playback",
        },
        beforeObservation: {} as any,
        afterObservation: {
          mediaElements: [
            {
              id: "ui-player",
              tagName: "audio",
              isPlaying: false,
              isPaused: true,
              isMuted: false,
              currentTime: 0,
              duration: 0,
              volume: 1,
              readyState: 2,
              ended: false,
            },
          ],
        } as any,
        extractedValue: { isPlaying: false, isPaused: true, error: "Media element remained paused" },
      });

      expect(verified.verified).toBe(false);
      expect(verified.reason).toContain("remained paused");
    });
  });

  describe("4. Specific Result Selection Grounded in Live DOM", () => {
    it("selects the best-matching result when multiple search results are present", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Search Results</title></head>
        <body>
          <div class="results">
            <div class="result-card"><a href="/track/unrelated">Completely Different Song</a></div>
            <div class="result-card"><a href="/track/kya-baat-ay">Kya Baat Ay - Harrdy Sandhu</a></div>
            <div class="result-card"><a href="/track/another">Unrelated Instrumental</a></div>
          </div>
        </body>
        </html>
      `);

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-click-result",
          type: ActionType.CLICK,
          target: {
            strategy: "css",
            value: `a[href*='/track/']:has-text("Kya Baat"), a:has-text("Kya Baat")`,
          },
          risk: RiskLevel.LOW,
          reason: "Select and open matching media result for 'Kya Baat'",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.COMPLETED);
      expect(exec.result.verified).toBe(true);
    });

    it("honestly fails with ELEMENT_NOT_FOUND when search yields zero matching results without inventing a track", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Search Results</title></head>
        <body>
          <div class="results">
            <div class="result-card"><a href="/track/unrelated-1">Unrelated Title Alpha</a></div>
            <div class="result-card"><a href="/track/unrelated-2">Unrelated Title Beta</a></div>
          </div>
        </body>
        </html>
      `);

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-click-result",
          type: ActionType.CLICK,
          target: {
            strategy: "css",
            value: `a[href*='/track/']:has-text("Nonexistent Track 12345"), a:has-text("Nonexistent Track 12345")`,
          },
          risk: RiskLevel.LOW,
          reason: "Select and open matching media result for 'Nonexistent Track 12345'",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.FAILED);
      expect(exec.result.error?.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
      expect(exec.result.error?.message).toMatch(/not found/i);
    });
  });

  describe("5. End-to-End Task Verification & Outcome Integrity", () => {
    it("TaskVerifier confirms media task success only when playback is verified active", () => {
      const taskResult = TaskVerifier.verifyTaskCompletion({
        taskDescription: "play Kya Baat Hai song on spotify",
        planActions: [
          {
            id: "step-nav",
            type: ActionType.NAVIGATE,
            risk: RiskLevel.LOW,
            reason: "Navigate to target",
          },
          {
            id: "step-play",
            type: ActionType.MEDIA_PLAY,
            risk: RiskLevel.LOW,
            reason: "Start playback",
          },
        ],
        completedSteps: [
          {
            actionId: "step-nav",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 400,
            retriesUsed: 0,
            verified: true,
          },
          {
            actionId: "step-play",
            type: ActionType.MEDIA_PLAY,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 300,
            retriesUsed: 0,
            verified: true,
            extractedData: { isPlaying: true, isPaused: false, mode: "ui_player" },
          },
        ],
        latestObservation: {
          url: "https://open.spotify.com/track/1ZaeaGLhFSckG8sv1y7AWk",
          title: "Kya Baat Ay - Song by Harrdy Sandhu | Spotify",
          headings: ["Kya Baat Ay"],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "Track playing",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
          mediaElements: [
            {
              id: "ui-player",
              tagName: "audio",
              isPlaying: true,
              isPaused: false,
              isMuted: false,
              currentTime: 1,
              duration: 0,
              volume: 1,
              readyState: 4,
              ended: false,
            },
          ],
        },
      });

      expect(taskResult.passed).toBe(true);
      expect(taskResult.outcome).toBe("success");
      expect(taskResult.isBlocked).toBeFalsy();
    });

    it("TaskVerifier rejects media task when playback is never established (prevents false success)", () => {
      const taskResult = TaskVerifier.verifyTaskCompletion({
        taskDescription: "play Kya Baat Hai song on spotify",
        planActions: [
          {
            id: "step-nav",
            type: ActionType.NAVIGATE,
            risk: RiskLevel.LOW,
            reason: "Navigate to target",
          },
          {
            id: "step-play",
            type: ActionType.MEDIA_PLAY,
            risk: RiskLevel.LOW,
            reason: "Start playback",
          },
        ],
        completedSteps: [
          {
            actionId: "step-nav",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 400,
            retriesUsed: 0,
            verified: true,
          },
          {
            actionId: "step-play",
            type: ActionType.MEDIA_PLAY,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 300,
            retriesUsed: 0,
            verified: true,
            extractedData: { isPlaying: false, isPaused: true }, // Remained paused
          },
        ],
        latestObservation: {
          url: "https://open.spotify.com/track/1ZaeaGLhFSckG8sv1y7AWk",
          title: "Kya Baat Ay - Song by Harrdy Sandhu | Spotify",
          headings: ["Kya Baat Ay"],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "Track paused",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
          mediaElements: [],
        },
      });

      expect(taskResult.passed).toBe(false);
    });
  });

  describe("6. Media Playback Control Execution, Authentication Restrictions & State Differentiation", () => {
    it("successfully establishes and verifies playback on a media page with a working Play control", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Music Player - Working Track</title></head>
        <body>
          <div class="track-header">
            <h1>Test Song</h1>
            <h2>Test Artist</h2>
          </div>
          <button id="main-play-btn" aria-label="Play" style="width: 50px; height: 50px;">Play</button>
          <script>
            const btn = document.getElementById('main-play-btn');
            btn.addEventListener('click', () => {
              btn.setAttribute('aria-label', 'Pause');
              btn.textContent = 'Pause';
            });
          </script>
        </body>
        </html>
      `);

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          risk: RiskLevel.LOW,
          reason: "Start media playback and verify playing state",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.COMPLETED);
      expect(exec.result.verified).toBe(true);
      const data = exec.result.extractedData as any;
      expect(data.isPlaying).toBe(true);
      expect(data.isPaused).toBe(false);
      expect(data.playbackVerified).toBe(true);
      expect(data.trackFound).toBe(true);
      expect(data.trackOpened).toBe(true);
    });

    it("halts safely as BLOCKED and reports AUTH_REQUIRED when media page has an authentication requirement banner", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Music Stream - Login Required</title></head>
        <body>
          <div class="track-info">
            <h1>Exclusive Track</h1>
            <p>Artist Name</p>
          </div>
          <div role="banner" class="auth-banner">
            <p>Signing in is required to listen to the full track</p>
            <button>Log in</button>
          </div>
          <button id="play-button" aria-label="Play" style="width: 50px; height: 50px;">Play</button>
        </body>
        </html>
      `);

      // 1. Action execution must record AUTH_REQUIRED failure
      const exec = await ActionExecutor.execute({
        action: {
          id: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          risk: RiskLevel.LOW,
          reason: "Start media playback and verify playing state",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.FAILED);
      expect(exec.result.error).toBeDefined();
      expect(exec.result.error!.code).toBe(ErrorCode.AUTH_REQUIRED);
      expect(exec.result.error!.message).toMatch(/sign-in to play media/i);
      const playbackEv = (exec.result.error!.details as any)?.playbackEvidence;
      expect(playbackEv?.isBlocked).toBe(true);
      expect(playbackEv?.blockType).toBe("AUTH_REQUIRED");

      // 2. ChallengeDetector must classify the page as blocked
      const obs = await PageObserver.observe(page, "tab-test");
      const detection = ChallengeDetector.detect(obs);
      expect(detection.isBlocked).toBe(true);
      expect(detection.blockType).toBe("AUTH_REQUIRED");
      expect(detection.reason).toMatch(/manual sign-in/i);

      // 3. TaskVerifier must classify the outcome as blocked
      const taskRes = TaskVerifier.verifyTaskCompletion({
        taskDescription: "play Exclusive Track on platform",
        completedSteps: [
          {
            actionId: "step-click-track",
            type: ActionType.CLICK,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 300,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: obs,
      });

      expect(taskRes.passed).toBe(false);
      expect(taskRes.outcome).toBe("blocked");
      expect(taskRes.isBlocked).toBe(true);
      expect((taskRes.details?.mediaPlayback as any)?.playbackBlocked).toBe(true);
      expect((taskRes.details?.mediaPlayback as any)?.blockType).toBe("AUTH_REQUIRED");
    });

    it("honestly fails with ELEMENT_NOT_FOUND when media page has no playback controls", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Empty Content Page</title></head>
        <body>
          <div class="content">
            <h1>No player here</h1>
            <p>Just ordinary text without audio, video or play buttons.</p>
          </div>
        </body>
        </html>
      `);

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          risk: RiskLevel.LOW,
          reason: "Start media playback and verify playing state",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.FAILED);
      expect(exec.result.error).toBeDefined();
      expect(exec.result.error!.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
      expect(exec.result.error!.message).toContain("No media element or Play control found");
    });

    it("honestly fails verification when clicking Play does not start playback and no auth banner is present", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
        <head><title>Unresponsive Player</title></head>
        <body>
          <h1>Broken Player</h1>
          <button id="inert-play-btn" aria-label="Play" style="width: 50px; height: 50px;">Play</button>
        </body>
        </html>
      `);

      const exec = await ActionExecutor.execute({
        action: {
          id: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          risk: RiskLevel.LOW,
          reason: "Start media playback and verify playing state",
        },
        page,
        tabId: "tab-test",
      });

      expect(exec.result.status).toBe(ActionStatus.FAILED);
      expect(exec.result.error).toBeDefined();
      expect(exec.result.error!.code).toBe(ErrorCode.VERIFICATION_FAILED);
      expect(exec.result.error!.message).toContain("Media element remained paused");
      const playbackEv = (exec.result.error!.details as any)?.playbackEvidence;
      expect(playbackEv?.playbackVerified).toBe(false);
      expect(playbackEv?.playbackAttempted).toBe(true);
      expect(playbackEv?.isBlocked).toBe(false);
    });
  });
});
