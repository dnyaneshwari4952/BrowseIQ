import { chromium } from "playwright";
import { LocalFileSecurityManager } from "../lib/local/local-file-security-manager";
import { SemanticDecomposer } from "../lib/agent/semantic-decomposer";
import { EntityConstraintResolver } from "../lib/planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "../lib/planning/dynamic-task-planner";
import { TaskVerifier } from "../lib/agent/task-verifier";
import { ActionType, ActionStatus } from "../lib/types/actions";

async function runLiveWindowsLocalFileTest() {
  console.log("============================================================");
  console.log("=== LIVE WINDOWS WHOLE-COMPUTER & LOCAL STORAGE VERIFICATION ===");
  console.log("============================================================\n");

  // Part A: Whole Computer Mode Verification
  console.log("--- PART A: WHOLE COMPUTER ACCESS MODE ---");

  // Enable whole computer access with confirmation
  LocalFileSecurityManager.enableWholeComputer(true);
  const statusA = LocalFileSecurityManager.getPermissionStatus();
  console.log("[A.1] Permission Enabled:", statusA.enabled);
  console.log("[A.1] Access Mode:", statusA.accessMode);
  console.log("[A.1] Whole Computer Confirmed:", statusA.wholeComputerConfirmed);
  console.log("[A.1] Accessible Drives:", LocalFileSecurityManager.getAccessibleDrives());
  console.log("[A.1] User Libraries:", statusA.userLibraryDirectories);

  // Natural language query across the computer
  const taskA = "find hey sinamika on my computer";
  console.log(`\n[A.2] Classifying: "${taskA}"`);
  const intentA = SemanticDecomposer.decompose(taskA);
  console.log("[A.2] Decomposed taskScope:", intentA.taskScope);
  console.log("[A.2] Decomposed intentType:", intentA.intentType);
  console.log("[A.2] Decomposed entity:", intentA.entity);

  if (intentA.taskScope !== "local_file" || intentA.intentType !== "LOCAL_MEDIA_PLAY") {
    throw new Error(`Expected local_file / LOCAL_MEDIA_PLAY, got ${intentA.taskScope} / ${intentA.intentType}`);
  }

  const specA = EntityConstraintResolver.resolve({ rawInstruction: taskA });
  console.log("[A.3] Target URL required:", specA.targetUrl ?? "(None - local file task)");

  const searchA = LocalFileSecurityManager.searchAudioFiles(taskA);
  console.log("\n[A.4] Audio Search across computer:");
  console.log("  Found:", searchA.found);
  console.log("  Matched Filename:", searchA.bestMatch?.filename);
  console.log("  Canonical Path:", searchA.bestMatch?.canonicalPath);
  console.log("  Match Score:", searchA.bestMatch?.score);
  console.log("  Scanned Count:", searchA.scannedCount);
  console.log("  Duration Ms:", searchA.durationMs);

  if (!searchA.found || !searchA.bestMatch) {
    throw new Error("Failed to discover Hey_Sinamika.wav on computer!");
  }

  const planA = DynamicTaskPlanner.plan({ spec: specA });
  console.log(`\n[A.5] Plan generated: ${planA.actions.length} action(s)`);
  const navActionA = planA.actions.find((a) => a.type === ActionType.NAVIGATE);
  const playerUrlA = String(navActionA?.value);
  console.log(`[A.5] Player URL: ${playerUrlA}`);

  // Part B: Visible Chromium Playback Verification
  console.log("\n--- PART B: VISIBLE CHROMIUM PLAYBACK VERIFICATION (headless: false) ---");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => console.log(`  [BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
  page.on("response", (res) => {
    if (res.url().includes("/api/local-file")) {
      console.log(`  [LOCAL AUDIO STREAM HTTP ${res.status()}] ${res.url()}`);
    }
  });

  try {
    console.log(`[B.1] Navigating to: ${playerUrlA}`);
    await page.goto(playerUrlA, { waitUntil: "domcontentloaded" });

    await page.waitForSelector("#audio-play-button", { timeout: 10000 });
    const displayedTitle = await page.textContent("#audio-title");
    console.log("[B.2] Rendered player title:", displayedTitle?.trim());

    console.log("[B.3] Triggering play via #audio-play-button...");
    await page.click("#audio-play-button");

    // Wait 2.5 seconds to let audio buffer and progress
    await page.waitForTimeout(2500);

    const audioDom = await page.evaluate(() => {
      const audio = (document.querySelector("#local-audio-player") || document.querySelector("audio")) as HTMLAudioElement;
      const progressEl = document.getElementById("playback-progressing");
      const statusEl = document.getElementById("playback-status");
      const currentTimeEl = document.getElementById("audio-current-time");
      return {
        paused: audio ? audio.paused : true,
        currentTime: audio ? audio.currentTime : 0,
        duration: audio ? audio.duration : 0,
        readyState: audio ? audio.readyState : 0,
        progressText: progressEl ? progressEl.textContent : "",
        statusText: statusEl ? statusEl.textContent : "",
        currentTimeText: currentTimeEl ? currentTimeEl.textContent : "",
      };
    });

    console.log("\n[B.4] Live Audio DOM State:");
    console.log("  currentTime:", audioDom.currentTime);
    console.log("  paused:", audioDom.paused);
    console.log("  readyState:", audioDom.readyState);
    console.log("  progressing:", audioDom.progressText);
    console.log("  status:", audioDom.statusText);

    if (audioDom.currentTime <= 0 || audioDom.paused) {
      throw new Error(`Playback verification failed: currentTime=${audioDom.currentTime}, paused=${audioDom.paused}`);
    }
    console.log("[B.5] Active audio playback progression CONFIRMED! (currentTime > 0, paused = false)");

    // TaskVerifier Check
    const verifyResult = TaskVerifier.verifyTask({
      task: taskA,
      completedSteps: [
        { actionId: "step-1-nav-player", type: ActionType.NAVIGATE, status: ActionStatus.COMPLETED },
        { actionId: "step-2-click-play", type: ActionType.CLICK, status: ActionStatus.COMPLETED },
        { actionId: "step-3-verify-progress", type: ActionType.EXTRACT_TEXT, status: ActionStatus.COMPLETED, extractedData: audioDom.progressText },
      ],
      observation: {
        url: playerUrlA,
        title: "Browser Local Audio Player",
        headings: ["Browser Local Audio Player"],
        interactiveElements: [{ id: "audio-play-button" } as any],
        mediaElements: [
          {
            tagName: "audio",
            type: "audio",
            isPlaying: !audioDom.paused,
            isPaused: audioDom.paused,
            currentTime: audioDom.currentTime,
            duration: audioDom.duration,
            volume: 1,
            readyState: audioDom.readyState,
            isMuted: false,
            ended: false,
          },
        ],
      } as any,
    });

    console.log("\n[B.6] TaskVerifier Verification Result:");
    console.log("  Passed:", verifyResult.passed);
    console.log("  Outcome:", verifyResult.outcome);
    console.log("  Reason:", verifyResult.reason);

    if (!verifyResult.passed) {
      throw new Error(`Verification failed: ${JSON.stringify(verifyResult)}`);
    }

    console.log("\n============================================================");
    console.log("=== ALL REAL WINDOWS LIVE CHECKS PASSED SUCCESSFULLY! ===");
    console.log("============================================================\n");
  } finally {
    await browser.close();
  }
}

runLiveWindowsLocalFileTest().catch((err) => {
  console.error("Live test failed:", err);
  process.exit(1);
});
