import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { LocalFileSecurityManager } from "../../lib/local/local-file-security-manager";
import { LocalFileResolver } from "../../lib/local/local-file-resolver";
import { SemanticDecomposer } from "../../lib/agent/semantic-decomposer";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { ActionType, ActionStatus } from "../../lib/types/actions";
import { TaskLifecycleState } from "../../lib/agent/task-lifecycle";

describe("Secure Local File Access and Audio Playback (Feature Tests)", () => {
  const sandboxDir = path.resolve(process.cwd(), "scratch", `audio-test-sandbox-${Date.now()}`);
  const outsideDir = path.resolve(process.cwd(), "scratch", `audio-test-outside-${Date.now()}`);

  beforeAll(() => {
    // Setup test sandbox directory
    if (!fs.existsSync(sandboxDir)) {
      fs.mkdirSync(sandboxDir, { recursive: true });
    }
    if (!fs.existsSync(outsideDir)) {
      fs.mkdirSync(outsideDir, { recursive: true });
    }

    // Create test audio files
    fs.writeFileSync(path.join(sandboxDir, "hey_sinamika.mp3"), "dummy mp3 audio content");
    fs.writeFileSync(path.join(sandboxDir, "Hey_Sinamika_Remix.wav"), "dummy wav audio content");
    fs.writeFileSync(path.join(sandboxDir, "Hey_Sinamika_Acoustic.flac"), "dummy flac audio content");
    fs.writeFileSync(path.join(sandboxDir, "another_track.aac"), "dummy aac audio content");
    fs.writeFileSync(path.join(sandboxDir, "podcast_sample.ogg"), "dummy ogg audio content");
    fs.writeFileSync(path.join(sandboxDir, "ambient_sound.m4a"), "dummy m4a audio content");

    // Create non-audio files
    fs.writeFileSync(path.join(sandboxDir, "document.pdf"), "dummy pdf content");
    fs.writeFileSync(path.join(sandboxDir, "notes.txt"), "dummy text content");
    fs.writeFileSync(path.join(sandboxDir, "installer.exe"), "dummy exe content");

    // Create outside file
    fs.writeFileSync(path.join(outsideDir, "secret_audio.mp3"), "forbidden outside content");

    // Create symlink escaping approved folder if symlink creation is permitted by OS
    try {
      const symlinkPath = path.join(sandboxDir, "escaped_symlink.mp3");
      fs.symlinkSync(path.join(outsideDir, "secret_audio.mp3"), symlinkPath, "file");
    } catch {
      // Symlink creation might require admin on Windows; if not permitted, tests handle it
    }
  });

  afterAll(() => {
    // Cleanup sandbox
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    } catch {}
    // Reset permission to default disabled
    LocalFileSecurityManager.disable();
  });

  // 1. Approved Downloads-folder access
  it("1. Resolves default Downloads directory safely using Node.js os APIs without hardcoding", () => {
    const defaultDownloads = LocalFileSecurityManager.getDefaultDownloadsDirectory();
    expect(defaultDownloads).toBe(path.join(os.homedir(), "Downloads"));
    expect(defaultDownloads.toLowerCase()).not.toContain("hardcoded_user");

    const status = LocalFileSecurityManager.getPermissionStatus();
    expect(status.defaultDirectory).toBe(defaultDownloads);
    expect(status.isReadOnly).toBe(true);
  });

  it("1b. Enables access to approved directory and validates permitted files", () => {
    LocalFileSecurityManager.enable(sandboxDir);
    expect(LocalFileSecurityManager.isEnabled()).toBe(true);
    expect(LocalFileSecurityManager.getApprovedDirectory()).toBe(path.resolve(sandboxDir));

    const check = LocalFileSecurityManager.validatePath("hey_sinamika.mp3");
    expect(check.permitted).toBe(true);
    expect(check.canonicalPath).toBe(fs.realpathSync(path.join(sandboxDir, "hey_sinamika.mp3")));
  });

  // 2. Permission disabled
  it("2. Blocks access and returns LOCAL_PERMISSION_REQUIRED when permission is disabled", () => {
    LocalFileSecurityManager.disable();
    expect(LocalFileSecurityManager.isEnabled()).toBe(false);

    const check = LocalFileSecurityManager.validatePath(path.join(sandboxDir, "hey_sinamika.mp3"));
    expect(check.permitted).toBe(false);
    expect(check.code).toBe("LOCAL_PERMISSION_REQUIRED");
    expect(check.reason).toContain("Local file access is disabled");

    // DynamicTaskPlanner handles disabled permission by requesting clarification
    const spec = EntityConstraintResolver.resolve({
      rawInstruction: "play hey sinamika from downloads folder from local storage",
    });
    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions[0].type).toBe(ActionType.REQUEST_CLARIFICATION);
    expect(plan.actions[0].reason).toContain("LOCAL_PERMISSION_REQUIRED");
  });

  // 3. Missing directory
  it("3. Handles missing approved directory gracefully without crash", () => {
    LocalFileSecurityManager.enable(path.join(sandboxDir, "non_existent_folder_xyz"));
    const check = LocalFileSecurityManager.validatePath("hey_sinamika.mp3");
    expect(check.permitted).toBe(false);
    expect(check.code).toBe("APPROVED_DIR_NOT_FOUND");

    const searchResult = LocalFileSecurityManager.searchAudioFiles("hey sinamika");
    expect(searchResult.found).toBe(false);
    expect(searchResult.candidates.length).toBe(0);
  });

  // 4. Exact and partial filename matching
  it("4. Accurately performs exact and partial filename matching with ranking and normalization", () => {
    LocalFileSecurityManager.enable(sandboxDir);

    // Exact match: "hey sinamika" -> "hey_sinamika.mp3"
    const exactSearch = LocalFileSecurityManager.searchAudioFiles("play hey sinamika from downloads folder");
    expect(exactSearch.found).toBe(true);
    expect(exactSearch.bestMatch).toBeDefined();
    expect(exactSearch.bestMatch?.filename).toBe("hey_sinamika.mp3");
    expect(exactSearch.bestMatch?.score).toBeGreaterThanOrEqual(95);

    // Partial match: "podcast sample" -> "podcast_sample.ogg"
    const partialSearch = LocalFileSecurityManager.searchAudioFiles("listen to podcast sample");
    expect(partialSearch.found).toBe(true);
    expect(partialSearch.bestMatch?.filename).toBe("podcast_sample.ogg");

    // FLAC and AAC audio files
    const flacSearch = LocalFileSecurityManager.searchAudioFiles("acoustic");
    expect(flacSearch.found).toBe(true);
    expect(flacSearch.bestMatch?.extension).toBe(".flac");

    const aacSearch = LocalFileSecurityManager.searchAudioFiles("another track");
    expect(aacSearch.found).toBe(true);
    expect(aacSearch.bestMatch?.extension).toBe(".aac");
  });

  // 5. Multiple matching songs
  it("5. Detects ambiguity when multiple close matching songs exist and requests user selection", () => {
    // Create two ambiguous tracks
    const ambigDir = path.join(sandboxDir, "ambiguous_tracks");
    if (!fs.existsSync(ambigDir)) fs.mkdirSync(ambigDir);
    fs.writeFileSync(path.join(ambigDir, "Kesariya_Original.mp3"), "audio");
    fs.writeFileSync(path.join(ambigDir, "Kesariya_Dance_Mix.mp3"), "audio");

    LocalFileSecurityManager.enable(ambigDir);
    const search = LocalFileSecurityManager.searchAudioFiles("kesariya");
    expect(search.found).toBe(true);
    expect(search.candidates.length).toBeGreaterThanOrEqual(2);
    expect(search.isAmbiguous).toBe(true);

    const spec = EntityConstraintResolver.resolve({
      rawInstruction: "play kesariya from downloads folder",
    });
    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions[0].type).toBe(ActionType.REQUEST_CLARIFICATION);
    expect(plan.actions[0].reason).toContain("FILE_SELECTION_REQUIRED");
  });

  // 6. Unsupported file types
  it("6. Strictly ignores non-audio extensions (.pdf, .txt, .exe) during search", () => {
    LocalFileSecurityManager.enable(sandboxDir);

    const pdfSearch = LocalFileSecurityManager.searchAudioFiles("document");
    expect(pdfSearch.found).toBe(false);

    const exeSearch = LocalFileSecurityManager.searchAudioFiles("installer");
    expect(exeSearch.found).toBe(false);
  });

  // 7. Path traversal attempts
  it("7. Blocks path traversal attempts (..) attempting to escape approved directory", () => {
    LocalFileSecurityManager.enable(sandboxDir);

    const traversal1 = LocalFileSecurityManager.validatePath("../outside/secret.txt");
    expect(traversal1.permitted).toBe(false);
    expect(traversal1.code).toBe("PATH_TRAVERSAL_DETECTED");

    const traversal2 = LocalFileSecurityManager.validatePath("..\\..\\Windows\\System32\\cmd.exe");
    expect(traversal2.permitted).toBe(false);
    expect(traversal2.code).toBe("PATH_TRAVERSAL_DETECTED");

    const traversal3 = LocalFileSecurityManager.validatePath("/etc/passwd");
    expect(traversal3.permitted).toBe(false);
  });

  // 8. Symlinks escaping the approved folder
  it("8. Rejects symlinks escaping the approved directory", () => {
    const symlinkPath = path.join(sandboxDir, "escaped_symlink.mp3");
    if (fs.existsSync(symlinkPath)) {
      LocalFileSecurityManager.enable(sandboxDir);
      const check = LocalFileSecurityManager.validatePath(symlinkPath);
      expect(check.permitted).toBe(false);
      expect(check.code).toBe("SYMLINK_ESCAPE_DETECTED");
      expect(check.reason).toContain("escapes approved directory");
    }
  });

  // 9. Playback failure
  it("9. Fails verification when playback progression is missing (currentTime == 0 or paused)", () => {
    const verification = TaskVerifier.verifyTask({
      task: "play hey sinamika from downloads folder from local storage",
      completedSteps: [
        {
          actionId: "step-1-nav-player",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
        },
        {
          actionId: "step-2-click-play",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
        },
        {
          actionId: "step-3-verify-progress",
          type: ActionType.EXTRACT_TEXT,
          status: ActionStatus.COMPLETED,
          extractedData: "STANDBY", // Not progressing
        },
      ],
      observation: {
        url: "http://localhost:3000/player/audio",
        title: "Browser Local Audio Player",
        mediaElements: [
          {
            type: "audio",
            isPlaying: false,
            isPaused: true,
            currentTime: 0,
            duration: 180,
          },
        ],
      } as any,
    });

    expect(verification.passed).toBe(false);
    expect(verification.failedChecks).toContain("mediaPlaybackActive");
  });

  it("9b. Passes verification when playback progression is confirmed (ACTIVE and currentTime > 0)", () => {
    const verification = TaskVerifier.verifyTask({
      task: "play hey sinamika from downloads folder from local storage",
      completedSteps: [
        {
          actionId: "step-1-nav-player",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
        },
        {
          actionId: "step-2-click-play",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
        },
        {
          actionId: "step-3-verify-progress",
          type: ActionType.EXTRACT_TEXT,
          status: ActionStatus.COMPLETED,
          extractedData: "ACTIVE", // Verified progression!
        },
      ],
      observation: {
        url: "http://localhost:3000/player/audio?path=test&title=Hey_Sinamika",
        title: "Browser Local Audio Player",
        mediaElements: [
          {
            type: "audio",
            isPlaying: true,
            isPaused: false,
            currentTime: 1.5,
            duration: 180,
          },
        ],
      } as any,
    });

    expect(verification.passed).toBe(true);
    expect(verification.outcome).toBe("success");
  });

  // 10. Replanning that preserves local-file intent
  it("10. Preserves local-file intent during replan without demanding a target website URL", () => {
    LocalFileSecurityManager.enable(sandboxDir);

    const spec = EntityConstraintResolver.resolve({
      rawInstruction: "play hey sinamika from downloads folder from local storage",
    });

    const initialPlan = DynamicTaskPlanner.plan({ spec });

    // Simulate failure at step 0 on about:blank
    const replanned = DynamicTaskPlanner.replan({
      currentPlan: initialPlan,
      failedStepIndex: 0,
      observation: {
        url: "about:blank",
        title: "",
      } as any,
      failureReason: "Precondition failed: about:blank",
    });

    // Replan must NOT request website clarification
    const hasWebsiteClarify = replanned.actions.some(
      (a) => a.type === ActionType.REQUEST_CLARIFICATION && a.reason?.toLowerCase().includes("website")
    );
    expect(hasWebsiteClarify).toBe(false);

    // Replan generates navigation to local audio player
    const navAction = replanned.actions.find((a) => a.type === ActionType.NAVIGATE);
    expect(navAction).toBeDefined();
    expect(String(navAction?.value)).toContain("/player/audio");
  });

  // 11. A local-file task that does not require a website URL
  it("11. Correctly classifies 'play hey sinamika from downloads folder from local storage' as a local-file task without requiring a website URL", () => {
    const rawTask = "play hey sinamika from downloads folder from local storage";

    // Intent decomposition
    const intent = SemanticDecomposer.decompose(rawTask);
    expect(intent.taskScope).toBe("local_file");
    expect(intent.intentType).toBe("LOCAL_MEDIA_PLAY");
    expect(intent.entity?.toLowerCase()).toBe("hey sinamika");

    // Constraint resolution
    const spec = EntityConstraintResolver.resolve({ rawInstruction: rawTask });
    expect(spec.isLocalFile).toBe(true);
    expect(spec.taskScope).toBe("local_file");
    expect(spec.operation).toBe("LOCAL_MEDIA_PLAY");
    expect(spec.targetUrl).toBeUndefined(); // No target website URL required
    expect(spec.isAmbiguous).toBe(false); // Valid task, NOT ambiguous
    expect(spec.confidence).toBeGreaterThanOrEqual(0.9);
  });
});
