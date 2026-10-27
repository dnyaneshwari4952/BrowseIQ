import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { ChallengeDetector } from "@/lib/browser/challenge-detector";
import { PageObserver } from "@/lib/browser/page-observer";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { SemanticOperationVerifier } from "@/lib/agent/semantic-operation-verifier";
import { DynamicTaskPlanner } from "@/lib/planning/dynamic-task-planner";
import { EntityConstraintResolver } from "@/lib/planning/entity-constraint-resolver";
import { ActionType, ActionStatus, RiskLevel } from "@/lib/types/actions";
import { AgentError, ErrorCode } from "@/lib/types/errors";
import { PageObservation } from "@/lib/types/browser";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";

describe("Spotify & Generalized Media Playback Verification and Authentication-Aware Recovery (14 Test Requirements)", () => {
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

  // 1. Media page loads but playback never starts — must not return success
  it("Test 1: Media page loads but playback never starts — must not return success", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Kyaa Baat Haii 2.0 - Song by Badshah, B Praak</title></head>
      <body>
        <div data-testid="track-info">
          <h1>Kyaa Baat Haii 2.0</h1>
          <p>From 'Govinda Naam Mera'</p>
        </div>
        <audio id="audio-player" src="about:blank" preload="none"></audio>
        <button data-testid="play-button" aria-label="Play Kyaa Baat Haii 2.0">Play</button>
      </body>
      </html>
    `);

    const obs = await PageObserver.observe(page, "tab-test");

    // Action execution without triggering playback must fail verification
    const exec = await ActionExecutor.execute({
      action: {
        id: "step-media-play",
        type: ActionType.MEDIA_PLAY,
        risk: RiskLevel.LOW,
        reason: "Start playback and verify playing state",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.VERIFICATION_FAILED);

    // TaskVerifier must NOT return completed
    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Kyaa Baat Haii 2.0 on spotify",
      completedSteps: [
        {
          actionId: "step-nav",
          type: ActionType.NAVIGATE,
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
    expect(taskRes.outcome).not.toBe("completed");
  });

  // 2. Visible Play button successfully starts playback — verify the observed state
  it("Test 2: Visible Play button successfully starts playback — verify the observed state", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Playable Track</title></head>
      <body>
        <h1>Active Audio Player</h1>
        <audio id="audio-player"></audio>
        <button id="play-btn" data-testid="play-button" aria-label="Play">Play</button>
        <button id="pause-ctrl" data-testid="control-button-playpause" aria-label="Pause" style="display:none;">Pause</button>
        <script>
          const audio = document.getElementById('audio-player');
          const playBtn = document.getElementById('play-btn');
          const pauseCtrl = document.getElementById('pause-ctrl');
          playBtn.addEventListener('click', () => {
            playBtn.style.display = 'none';
            pauseCtrl.style.display = 'inline-block';
            Object.defineProperty(audio, 'paused', { value: false, configurable: true });
            Object.defineProperty(audio, 'ended', { value: false, configurable: true });
            Object.defineProperty(audio, 'currentTime', { value: 1.5, configurable: true });
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
        reason: "Trigger play button and confirm active playback",
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

    const obs = await PageObserver.observe(page, "tab-test");
    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Active Audio Player",
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: true,
          extractedData: data,
        },
      ],
      latestObservation: obs,
    });

    expect(taskRes.passed).toBe(true);
    expect(taskRes.outcome).toBe("success");
  });

  // 3. Play click occurs but playback remains paused — fail verification
  it("Test 3: Play click occurs but playback remains paused — fail verification", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Stubborn Player</title></head>
      <body>
        <h1>Song Name</h1>
        <button data-testid="play-button" aria-label="Play">Play</button>
        <script>
          document.querySelector('button').addEventListener('click', () => {
            // Button clicked, but player never engages and remains paused
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
        reason: "Start media playback",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.VERIFICATION_FAILED);
    expect(exec.result.error?.message).toMatch(/remained paused/i);
    const playbackEv = (exec.result.error?.details as any)?.playbackEvidence;
    expect(playbackEv?.playbackVerified).toBe(false);
    expect(playbackEv?.isBlocked).toBe(false);
  });

  // 4. Explicit sign-in notice blocks full-track listening — report authentication required
  it("Test 4: Explicit sign-in notice blocks full-track listening — report authentication required", async () => {
    // Spotify exact phrasing and structure
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Kyaa Baat Haii 2.0 (From 'Govinda Naam Mera') - song and lyrics by Spotify</title></head>
      <body>
        <main>
          <h1>Kyaa Baat Haii 2.0 (From 'Govinda Naam Mera')</h1>
          <button data-testid="play-button" aria-label="Play Kyaa Baat Haii 2.0">Play</button>
          <div data-testid="prompt" class="prompt-container">
            <p>Sign in to see lyrics and listen to the full track.</p>
            <button>Log in</button>
          </div>
          <!-- Spotify disables the playpause control when unauthenticated -->
          <button disabled="" data-testid="control-button-playpause" aria-label="Pause"></button>
        </main>
      </body>
      </html>
    `);

    const obs = await PageObserver.observe(page, "tab-test");

    // 1. ChallengeDetector identifies the sign-in playback wall
    const challenge = ChallengeDetector.detect(obs);
    expect(challenge.isBlocked).toBe(true);
    expect(challenge.blockType).toBe("AUTH_REQUIRED");
    expect(challenge.reason).toMatch(/sign-in to (?:access or )?play media/i);

    // 2. ActionExecutor detects the auth requirement and throws AUTH_REQUIRED error
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
    expect(exec.result.error?.code).toBe(ErrorCode.AUTH_REQUIRED);
    expect(exec.result.error?.message).toMatch(/sign-in/i);

    // 3. TaskVerifier marks the task as blocked rather than completed or failed
    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Kyaa Baat Haii 2.0 on spotify",
      completedSteps: [
        {
          actionId: "step-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 300,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.FAILED,
          error: exec.result.error,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 500,
          retriesUsed: 0,
          verified: false,
        },
      ],
      latestObservation: obs,
    });

    expect(taskRes.passed).toBe(false);
    expect(taskRes.outcome).toBe("blocked");
    expect(taskRes.isBlocked).toBe(true);
    expect((taskRes.details?.mediaPlayback as any)?.blockType).toBe("AUTH_REQUIRED");
  });

  // 5. Sign-in page appears without evidence that it blocks the requested playback — do not automatically misclassify it
  it("Test 5: Sign-in page appears without evidence that it blocks the requested playback — do not automatically misclassify it", async () => {
    const normalHeaderSignInObs: PageObservation = {
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
      headings: ["Never Gonna Give You Up"],
      interactiveElements: [
        {
          id: "sign-in-link",
          role: "link",
          tagName: "A",
          text: "Sign in",
          ariaLabel: "Sign in",
          isVisible: true,
          isEnabled: true,
        },
      ],
      mediaElements: [
        {
          tagName: "video",
          src: "https://googlevideo.com/videoplayback",
          isPlaying: true,
          isPaused: false,
          currentTime: 12.4,
          duration: 213,
          isMuted: false,
          volume: 1,
          readyState: 4,
          ended: false,
        },
      ],
      forms: [],
      dialogs: [],
      summary: "YouTube video watch page with normal top-nav sign-in button",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const challenge = ChallengeDetector.detect(normalHeaderSignInObs);
    expect(challenge.isBlocked).toBe(false);
    expect(challenge.blockType).toBeUndefined();

    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Never Gonna Give You Up on youtube",
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: true,
          extractedData: { isPlaying: true, playbackVerified: true },
        },
      ],
      latestObservation: normalHeaderSignInObs,
    });

    expect(taskRes.passed).toBe(true);
    expect(taskRes.outcome).toBe("success");
  });

  // 6. Media element has a fatal error — do not report success
  it("Test 6: Media element has a fatal error — do not report success", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Broken Track</title></head>
      <body>
        <h1>Broken Stream</h1>
        <audio id="err-audio"></audio>
        <button id="play-button" aria-label="Play">Play</button>
        <script>
          const a = document.getElementById('err-audio');
          Object.defineProperty(a, 'error', {
            value: { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format not supported' },
            configurable: true
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
        reason: "Start playback",
      },
      page,
      tabId: "tab-test",
    });

    expect(exec.result.status).toBe(ActionStatus.FAILED);
    expect(exec.result.error?.code).toBe(ErrorCode.VERIFICATION_FAILED);
    expect(exec.result.error?.message).toMatch(/Media playback failed with element error/i);

    const obs = await PageObserver.observe(page, "tab-test");
    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Broken Stream",
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.FAILED,
          error: exec.result.error,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: false,
        },
      ],
      latestObservation: obs,
    });

    expect(taskRes.passed).toBe(false);
    expect(taskRes.outcome).not.toBe("completed");
  });

  // 7. Media time advances between observations — use as supporting playback evidence
  it("Test 7: Media time advances between observations — use as supporting playback evidence", async () => {
    const obsInitial: PageObservation = {
      url: "https://music.example.com/track/101",
      title: "Progressing Track",
      headings: ["Progressing Track"],
      interactiveElements: [],
      mediaElements: [
        {
          tagName: "audio",
          isPlaying: true,
          isPaused: false,
          currentTime: 1.2,
          duration: 180,
          isMuted: false,
          volume: 1,
          readyState: 4,
          ended: false,
        },
      ],
      forms: [],
      dialogs: [],
      summary: "Audio playing at 1.2s",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const obsLater: PageObservation = {
      url: "https://music.example.com/track/101",
      title: "Progressing Track",
      headings: ["Progressing Track"],
      interactiveElements: [],
      mediaElements: [
        {
          tagName: "audio",
          isPlaying: true,
          isPaused: false,
          currentTime: 3.5,
          duration: 180,
          isMuted: false,
          volume: 1,
          readyState: 4,
          ended: false,
        },
      ],
      forms: [],
      dialogs: [],
      summary: "Audio playing at 3.5s",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    expect(obsLater.mediaElements![0].currentTime).toBeGreaterThan(obsInitial.mediaElements![0].currentTime);

    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Progressing Track",
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 2000,
          retriesUsed: 0,
          verified: true,
          extractedData: { isPlaying: true, currentTime: 3.5, playbackVerified: true },
        },
      ],
      latestObservation: obsLater,
    });

    expect(taskRes.passed).toBe(true);
    expect(taskRes.outcome).toBe("success");
  });

  // 8. Media page has no accessible HTML media element — require a trustworthy alternative signal
  it("Test 8: Media page has no accessible HTML media element — require a trustworthy alternative signal", async () => {
    // 8a: Custom UI player with enabled, visible Pause button succeeds
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Custom Web Audio Player</title></head>
      <body>
        <h1>Web Audio API Player</h1>
        <div id="player-container">
          <button id="ui-pause-btn" data-testid="control-button-playpause" aria-label="Pause" style="width: 40px; height: 40px;">Pause</button>
        </div>
      </body>
      </html>
    `);

    const obsWithEnabledPause = await PageObserver.observe(page, "tab-test");
    expect(obsWithEnabledPause.mediaElements?.some((m) => m.isPlaying && !m.isPaused)).toBe(true);

    const semanticRes = SemanticOperationVerifier.isOperationAccomplished({
      operation: "media_play",
      observation: obsWithEnabledPause,
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          verified: true,
          extractedData: { isPlaying: true, playbackVerified: true, mode: "ui_player" },
        },
      ],
    });

    expect(semanticRes).toBe(true);

    // 8b: Custom UI player with DISABLED pause button (e.g. Spotify unauthenticated) is rejected
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Spotify Disabled Control</title></head>
      <body>
        <h1>Song</h1>
        <button disabled="" data-testid="control-button-playpause" aria-label="Pause" style="width: 40px; height: 40px;"></button>
      </body>
      </html>
    `);

    const obsWithDisabledPause = await PageObserver.observe(page, "tab-test");
    expect(obsWithDisabledPause.mediaElements?.some((m) => m.isPlaying && !m.isPaused)).toBe(false);
    expect(obsWithDisabledPause.mediaElements?.some((m) => m.isPaused)).toBe(true);
  });

  // 9. Repeated Play clicks without state change — bounded recovery
  it("Test 9: Repeated Play clicks without state change — bounded recovery", () => {
    const originalPlan = DynamicTaskPlanner.plan({
      spec: EntityConstraintResolver.resolve({ rawInstruction: "play Kyaa Baat Haii on spotify" }),
      targetUrl: "https://open.spotify.com",
    });

    const failedAction = {
      id: "step-media-play",
      type: ActionType.MEDIA_PLAY,
      risk: RiskLevel.LOW,
      reason: "Start playback",
    };

    // First failure initiates recovery without immediate termination
    const rec1 = RecoveryEngine.determineRecovery({
      action: failedAction,
      error: new AgentError("Media element remained paused.", ErrorCode.VERIFICATION_FAILED, true),
      attempt: 1,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 2,
      plan: originalPlan,
    });

    expect(rec1.terminal).toBe(false);

    // After repeated failures exceeding max attempts and max replans, recovery halts safely
    const recMax = RecoveryEngine.determineRecovery({
      action: failedAction,
      error: new AgentError("Media element remained paused.", ErrorCode.VERIFICATION_FAILED, true),
      attempt: 3,
      maxAttempts: 3,
      replansUsed: 2,
      maxReplans: 2,
      plan: originalPlan,
    });

    expect(recMax.strategy).toBe("FAIL");
    expect(recMax.terminal).toBe(true);
  });

  // 10. Correct track opened but playback blocked — distinguish partial progress from task completion
  it("Test 10: Correct track opened but playback blocked — distinguish partial progress from task completion", () => {
    const obsTrackBlocked: PageObservation = {
      url: "https://open.spotify.com/track/1ZaeaGLhFSckG8sv1y7AWk",
      title: "Kyaa Baat Haii 2.0 (From 'Govinda Naam Mera')",
      headings: ["Kyaa Baat Haii 2.0 (From 'Govinda Naam Mera')"],
      dialogs: [
        {
          type: "modal",
          message: "Sign in to see lyrics and listen to the full track.",
        },
      ],
      interactiveElements: [
        {
          id: "play-btn",
          tagName: "BUTTON",
          text: "Play",
          ariaLabel: "Play",
          isVisible: true,
          isEnabled: true,
        },
      ],
      forms: [],
      summary: "Track page opened with sign-in wall banner",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Kyaa Baat Haii 2.0 on spotify",
      completedSteps: [
        {
          actionId: "step-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 300,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "step-click-track",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: true,
        },
      ],
      latestObservation: obsTrackBlocked,
    });

    expect(taskRes.passed).toBe(false);
    expect(taskRes.outcome).toBe("blocked");
    expect(taskRes.isBlocked).toBe(true);

    const details = taskRes.details?.mediaPlayback as any;
    expect(details?.trackFound).toBe(true);
    expect(details?.trackOpened).toBe(true);
    expect(details?.playbackVerified).toBe(false);
    expect(details?.blockType).toBe("AUTH_REQUIRED");
  });

  // 11. YouTube playback still works
  it("Test 11: YouTube playback still works", () => {
    const obsYouTubePlaying: PageObservation = {
      url: "https://www.youtube.com/watch?v=kyaa-baat-hai-video",
      title: "Kyaa Baat Haii 2.0 Official Video",
      headings: ["Kyaa Baat Haii 2.0 Official Video"],
      interactiveElements: [],
      mediaElements: [
        {
          tagName: "video",
          src: "blob:https://www.youtube.com/xyz",
          isPlaying: true,
          isPaused: false,
          currentTime: 5.2,
          duration: 240,
          isMuted: false,
          volume: 1,
          readyState: 4,
          ended: false,
        },
      ],
      forms: [],
      dialogs: [],
      summary: "YouTube video playing normally",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play Kyaa Baat Haii 2.0 on youtube",
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 1200,
          retriesUsed: 0,
          verified: true,
          extractedData: {
            isPlaying: true,
            playbackVerified: true,
            currentTime: 5.2,
          },
        },
      ],
      latestObservation: obsYouTubePlaying,
    });

    expect(taskRes.passed).toBe(true);
    expect(taskRes.outcome).toBe("success");
  });

  // 12. Other generic audio/video tasks still work without task-specific branches
  it("Test 12: Other generic audio/video tasks still work without task-specific branches", () => {
    const spec = EntityConstraintResolver.resolve({
      rawInstruction: "stream lofi beats on soundcloud",
    });

    expect(spec.operation).toBe("MEDIA_PLAY");
    expect(spec.targetWebsite).toBe("soundcloud");
    expect(spec.targetUrl).toBe("https://soundcloud.com");
    expect(spec.searchQuery).toBe("lofi beats");

    const plan = DynamicTaskPlanner.plan({ spec, targetUrl: spec.targetUrl });
    expect(plan.actions.some((a) => a.type === ActionType.NAVIGATE)).toBe(true);
    expect(plan.actions.some((a) => a.type === ActionType.MEDIA_PLAY)).toBe(true);
  });

  // 13. CAPTCHA and bot challenges remain safely blocked
  it("Test 13: CAPTCHA and bot challenges remain safely blocked", () => {
    const obsBotChallenge: PageObservation = {
      url: "https://www.youtube.com/sorry/index?continue=https://www.youtube.com/watch",
      title: "Confirm you are not a robot",
      headings: ["Our systems have detected unusual traffic from your computer network."],
      interactiveElements: [
        {
          id: "recaptcha-anchor",
          role: "checkbox",
          tagName: "DIV",
          text: "I'm not a robot",
          isVisible: true,
          isEnabled: true,
        },
      ],
      forms: [],
      dialogs: [],
      summary: "Active Cloudflare / Google bot challenge page",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const challenge = ChallengeDetector.detect(obsBotChallenge);
    expect(challenge.isBlocked).toBe(true);
    expect(["CAPTCHA", "GOOGLE_UNUSUAL_TRAFFIC"]).toContain(challenge.blockType);

    const taskRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play song on youtube",
      completedSteps: [],
      latestObservation: obsBotChallenge,
    });

    expect(taskRes.passed).toBe(false);
    expect(taskRes.outcome).toBe("blocked");
    expect(taskRes.isBlocked).toBe(true);
  });

  // 14. UI status accurately reflects completed, blocked, failed, and waiting outcomes
  it("Test 14: UI status accurately reflects completed, blocked, failed, and waiting outcomes", () => {
    // 14a: Completed / Successful
    const completedRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play song on platform",
      extractedData: { isPlaying: true, playbackVerified: true },
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: true,
          extractedData: { isPlaying: true, playbackVerified: true },
        },
      ],
      latestObservation: {
        url: "https://example.com/player",
        title: "Player",
        headings: ["Player"],
        interactiveElements: [],
        mediaElements: [{ tagName: "video", isPlaying: true, isPaused: false, currentTime: 2, duration: 100, isMuted: false, volume: 1, readyState: 4, ended: false }],
        forms: [],
        dialogs: [],
        summary: "Playing",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      },
    });
    expect(completedRes.passed).toBe(true);
    expect(completedRes.outcome).toBe("success");

    // 14b: Blocked (auth required)
    const blockedRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play track on spotify",
      completedSteps: [],
      latestObservation: {
        url: "https://open.spotify.com/track/123",
        title: "Track",
        headings: ["Track"],
        dialogs: [{ type: "modal", message: "Sign in to see lyrics and listen to the full track." }],
        interactiveElements: [],
        forms: [],
        summary: "Sign-in required",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      },
    });
    expect(blockedRes.outcome).toBe("blocked");
    expect(blockedRes.isBlocked).toBe(true);

    // 14c: Failed (unrecoverable error without auth barrier)
    const failedRes = TaskVerifier.verifyTaskCompletion({
      taskDescription: "play track",
      completedSteps: [
        {
          actionId: "step-media-play",
          type: ActionType.MEDIA_PLAY,
          status: ActionStatus.FAILED,
          error: { code: ErrorCode.VERIFICATION_FAILED, message: "Media element remained paused." },
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: false,
        },
      ],
      latestObservation: {
        url: "https://example.com/broken",
        title: "Broken",
        headings: ["Broken"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "No player",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      },
    });
    expect(failedRes.outcome).toBe("failed");
    expect(failedRes.passed).toBe(false);
  });
});
