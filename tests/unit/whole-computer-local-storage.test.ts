import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { LocalFileSecurityManager } from "../../lib/local/local-file-security-manager";
import { SemanticDecomposer } from "../../lib/agent/semantic-decomposer";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { ActionType, ActionStatus } from "../../lib/types/actions";

describe("Whole-Computer Local Storage Access & Audio Playback Tests", () => {
  const baseTestDir = path.resolve(process.cwd(), "scratch", `wc-test-${Date.now()}`);
  const downloadsDir = path.join(baseTestDir, "Downloads");
  const documentsDir = path.join(baseTestDir, "Documents");
  const musicDir = path.join(baseTestDir, "Music");
  const sensitiveDir = path.join(baseTestDir, "AppData");
  const cycleDir = path.join(baseTestDir, "cycle_test");

  beforeAll(() => {
    // Create mock folder structure
    [downloadsDir, documentsDir, musicDir, sensitiveDir, cycleDir].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    // Populate mock audio files across directories
    fs.writeFileSync(path.join(downloadsDir, "Hey_Sinamika.wav"), "dummy wav audio");
    fs.writeFileSync(path.join(downloadsDir, "hey_sinamika_remix.mp3"), "dummy remix");
    fs.writeFileSync(path.join(musicDir, "classical_sonata.flac"), "dummy flac");
    fs.writeFileSync(path.join(musicDir, "pop_song.aac"), "dummy aac");
    fs.writeFileSync(path.join(documentsDir, "interview_recording.ogg"), "dummy ogg");
    fs.writeFileSync(path.join(documentsDir, "voice_memo.m4a"), "dummy m4a");

    // Populate sensitive files that must be excluded
    fs.writeFileSync(path.join(sensitiveDir, "secret_audio.mp3"), "forbidden secret audio");
    fs.writeFileSync(path.join(downloadsDir, "id_rsa"), "fake ssh private key");
    fs.writeFileSync(path.join(downloadsDir, ".env"), "API_KEY=super_secret");
    fs.writeFileSync(path.join(downloadsDir, "server.pem"), "fake certificate");

    // Attempt to create symlink loop if permitted on OS
    try {
      const loopLink = path.join(cycleDir, "loop_to_parent");
      if (!fs.existsSync(loopLink)) {
        fs.symlinkSync(cycleDir, loopLink, "junction");
      }
    } catch {
      // Junction/symlink creation might require Windows Developer Mode or privileges
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(baseTestDir, { recursive: true, force: true });
    } catch {}
    LocalFileSecurityManager.disable();
  });

  // 1. Whole-computer mode enabled and disabled
  describe("1. Whole-computer mode enabled and disabled", () => {
    it("rejects access when local storage permission is disabled", () => {
      LocalFileSecurityManager.disable();
      expect(LocalFileSecurityManager.isEnabled()).toBe(false);

      const check = LocalFileSecurityManager.validatePath(path.join(downloadsDir, "Hey_Sinamika.wav"));
      expect(check.permitted).toBe(false);
      expect(check.code).toBe("LOCAL_PERMISSION_REQUIRED");

      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play hey sinamika from local storage",
      });
      const plan = DynamicTaskPlanner.plan({ spec });
      expect(plan.actions[0].type).toBe(ActionType.REQUEST_CLARIFICATION);
      expect(plan.actions[0].reason).toContain("LOCAL_PERMISSION_REQUIRED");
    });

    it("requires explicit user confirmation before granting whole-computer access", () => {
      LocalFileSecurityManager.enable({
        accessMode: "whole_computer",
        wholeComputerConfirmed: false,
      });
      expect(LocalFileSecurityManager.isEnabled()).toBe(true);
      expect(LocalFileSecurityManager.getAccessMode()).toBe("whole_computer");
      expect(LocalFileSecurityManager.wholeComputerConfirmed).toBe(false);

      const check = LocalFileSecurityManager.validatePath(path.join(downloadsDir, "Hey_Sinamika.wav"));
      expect(check.permitted).toBe(false);
      expect(check.code).toBe("WHOLE_COMPUTER_CONFIRMATION_REQUIRED");

      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play hey sinamika on my computer",
      });
      const plan = DynamicTaskPlanner.plan({ spec });
      expect(plan.actions[0].type).toBe(ActionType.REQUEST_CLARIFICATION);
      expect(plan.actions[0].reason).toContain("WHOLE_COMPUTER_CONFIRMATION_REQUIRED");
    });

    it("grants access to authorized paths when whole-computer mode is confirmed", () => {
      LocalFileSecurityManager.enableWholeComputer(true);
      expect(LocalFileSecurityManager.isEnabled()).toBe(true);
      expect(LocalFileSecurityManager.getAccessMode()).toBe("whole_computer");
      expect(LocalFileSecurityManager.wholeComputerConfirmed).toBe(true);

      const check = LocalFileSecurityManager.validatePath(path.join(downloadsDir, "Hey_Sinamika.wav"));
      expect(check.permitted).toBe(true);
      expect(check.canonicalPath).toBe(fs.realpathSync(path.join(downloadsDir, "Hey_Sinamika.wav")));
    });
  });

  // 2. Searches across multiple authorized user folders
  describe("2. Searches across multiple authorized user folders", () => {
    it("discovers files in multiple approved directories in selected_folders mode", () => {
      LocalFileSecurityManager.enable({
        accessMode: "selected_folders",
        approvedDirectories: [downloadsDir, musicDir, documentsDir],
      });

      const resMusic = LocalFileSecurityManager.searchFiles({
        query: "classical sonata",
        locations: [downloadsDir, musicDir, documentsDir],
      });
      expect(resMusic.found).toBe(true);
      expect(resMusic.bestMatch?.filename).toBe("classical_sonata.flac");

      const resDoc = LocalFileSecurityManager.searchFiles({
        query: "interview recording",
        locations: [downloadsDir, musicDir, documentsDir],
      });
      expect(resDoc.found).toBe(true);
      expect(resDoc.bestMatch?.filename).toBe("interview_recording.ogg");
    });

    it("discovers audio files across libraries in whole-computer mode", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const res = LocalFileSecurityManager.searchFiles({
        query: "pop song",
        locations: [downloadsDir, musicDir, documentsDir],
      });
      expect(res.found).toBe(true);
      expect(res.bestMatch?.filename).toBe("pop_song.aac");
    });
  });

  // 3. Access-denied folders
  describe("3. Access-denied folders", () => {
    it("handles inaccessible or locked directories gracefully without crashing", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      // Create an inaccessible folder simulation by targeting a non-existent or restricted folder
      const fakeLockedDir = path.join(baseTestDir, "locked_system_folder");
      const res = LocalFileSecurityManager.searchFiles({
        query: "classical sonata",
        locations: [fakeLockedDir, musicDir], // One invalid, one valid
      });

      expect(res.found).toBe(true);
      expect(res.bestMatch?.filename).toBe("classical_sonata.flac");
    });

    it("survives readdirSync throwing permission errors gracefully", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      // Spy on readdirSync for a specific restricted test dir
      const originalReaddirSync = fs.readdirSync;
      const restrictedSubdir = path.join(baseTestDir, "restricted_perm_dir");
      if (!fs.existsSync(restrictedSubdir)) fs.mkdirSync(restrictedSubdir);

      const spy = vi.spyOn(fs, "readdirSync").mockImplementation(((p: any, opts: any) => {
        if (typeof p === "string" && p.includes("restricted_perm_dir")) {
          const err = new Error("EACCES: permission denied, scandir");
          (err as any).code = "EACCES";
          throw err;
        }
        return originalReaddirSync(p, opts);
      }) as any);

      try {
        const res = LocalFileSecurityManager.searchFiles({
          query: "classical sonata",
          locations: [restrictedSubdir, musicDir],
        });
        expect(res.found).toBe(true);
        expect(res.bestMatch?.filename).toBe("classical_sonata.flac");
      } finally {
        spy.mockRestore();
      }
    });
  });

  // 4. Excluded sensitive directories and files
  describe("4. Excluded sensitive directories and files", () => {
    it("strictly blocks system and sensitive directories from validatePath", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const winCheck = LocalFileSecurityManager.validatePath("C:\\Windows\\System32\\calc.exe");
      expect(winCheck.permitted).toBe(false);
      expect(winCheck.code).toBe("SENSITIVE_DIRECTORY_EXCLUDED");

      const progCheck = LocalFileSecurityManager.validatePath("C:\\Program Files\\app\\app.exe");
      expect(progCheck.permitted).toBe(false);
      expect(progCheck.code).toBe("SENSITIVE_DIRECTORY_EXCLUDED");

      const sshCheck = LocalFileSecurityManager.validatePath(path.join(downloadsDir, "id_rsa"));
      expect(sshCheck.permitted).toBe(false);
      expect(sshCheck.code).toBe("SENSITIVE_DIRECTORY_EXCLUDED");

      const envCheck = LocalFileSecurityManager.validatePath(path.join(downloadsDir, ".env"));
      expect(envCheck.permitted).toBe(false);
      expect(envCheck.code).toBe("SENSITIVE_DIRECTORY_EXCLUDED");

      const pemCheck = LocalFileSecurityManager.validatePath(path.join(downloadsDir, "server.pem"));
      expect(pemCheck.permitted).toBe(false);
      expect(pemCheck.code).toBe("SENSITIVE_DIRECTORY_EXCLUDED");
    });

    it("skips AppData and sensitive directories during recursive search", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const res = LocalFileSecurityManager.searchFiles({
        query: "secret audio",
        locations: [baseTestDir], // Includes sensitiveDir "AppData"
      });
      // The secret audio inside AppData must NOT be found
      expect(res.found).toBe(false);
      expect(res.candidates.length).toBe(0);
    });
  });

  // 5. Symbolic-link loops and escapes
  describe("5. Symbolic-link loops and escapes", () => {
    it("prevents infinite loops when directory links or junctions create cycles", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const loopLink = path.join(cycleDir, "loop_to_parent");
      if (fs.existsSync(loopLink)) {
        // Search should terminate safely without stack overflow
        const res = LocalFileSecurityManager.searchFiles({
          query: "nonexistent",
          locations: [cycleDir],
          maxDepth: 10,
        });
        expect(res.found).toBe(false);
      }
    });

    it("rejects path traversal attempting to escape approved directory", () => {
      LocalFileSecurityManager.enable({
        accessMode: "selected_folders",
        approvedDirectories: [downloadsDir],
      });

      const traversal = LocalFileSecurityManager.validatePath("../Music/classical_sonata.flac");
      expect(traversal.permitted).toBe(false);
      expect(traversal.code).toBe("PATH_TRAVERSAL_DETECTED");
    });
  });

  // 6. Large-directory cancellation and timeout limits
  describe("6. Large-directory cancellation and timeout limits", () => {
    it("stops search and flags timedOut when timeout is reached", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const res = LocalFileSecurityManager.searchFiles({
        query: "sonata",
        locations: [baseTestDir],
        timeoutMs: 0, // Instant timeout
      });
      expect(res.timedOut).toBe(true);
    });

    it("halts scanning when maxFiles limit is reached", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const res = LocalFileSecurityManager.searchFiles({
        query: "sonata",
        locations: [baseTestDir],
        maxFiles: 2,
      });
      expect(res.scannedCount).toBeLessThanOrEqual(5);
    });

    it("aborts scanning immediately when AbortSignal is triggered", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const controller = new AbortController();
      controller.abort(); // Pre-aborted

      const res = LocalFileSecurityManager.searchFiles({
        query: "sonata",
        locations: [baseTestDir],
        signal: controller.signal,
      });
      expect(res.scannedCount).toBe(0);
      expect(res.found).toBe(false);
    });
  });

  // 7. Duplicate matching files
  describe("7. Duplicate matching files", () => {
    it("deduplicates files found via multiple paths", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      // Search with both the folder and duplicate paths
      const res = LocalFileSecurityManager.searchFiles({
        query: "Hey Sinamika",
        locations: [downloadsDir, downloadsDir], // Repeated location
      });

      const matchingWavs = res.candidates.filter((c) => c.filename === "Hey_Sinamika.wav");
      expect(matchingWavs.length).toBe(1); // Exactly one, not duplicated
    });

    it("ranks exact filename match above partial/remix match", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const res = LocalFileSecurityManager.searchAudioFiles("Hey Sinamika", downloadsDir);
      expect(res.found).toBe(true);
      expect(res.bestMatch).toBeDefined();
      expect(res.bestMatch?.filename).toBe("Hey_Sinamika.wav");
      expect(res.bestMatch?.score).toBe(100);

      // Partial remix match must rank lower
      const remixCandidate = res.candidates.find((c) => c.filename.includes("remix"));
      expect(remixCandidate).toBeDefined();
      expect(remixCandidate!.score).toBeLessThan(100);
    });
  });

  // 8. Audio selection and verified playback
  describe("8. Audio selection and verified playback", () => {
    it("detects ambiguity and requires user selection when multiple close matches exist", () => {
      const ambigDir = path.join(baseTestDir, "ambig_album");
      if (!fs.existsSync(ambigDir)) fs.mkdirSync(ambigDir);
      fs.writeFileSync(path.join(ambigDir, "Track_Part1.mp3"), "audio1");
      fs.writeFileSync(path.join(ambigDir, "Track_Part2.mp3"), "audio2");

      LocalFileSecurityManager.enableWholeComputer(true);

      const search = LocalFileSecurityManager.searchAudioFiles("track", ambigDir);
      expect(search.found).toBe(true);
      expect(search.candidates.length).toBeGreaterThanOrEqual(2);
      expect(search.isAmbiguous).toBe(true);
    });

    it("passes TaskVerifier when active media playback progression is verified", () => {
      const verification = TaskVerifier.verifyTask({
        task: "find hey sinamika on my computer",
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
            extractedData: "ACTIVE",
          },
        ],
        observation: {
          url: "http://localhost:3000/player/audio?path=test&title=Hey_Sinamika",
          title: "Browser Local Audio Player",
          headings: ["Browser Local Audio Player"],
          interactiveElements: [{ id: "audio-play-button" } as any],
          mediaElements: [
            {
              type: "audio",
              isPlaying: true,
              isPaused: false,
              currentTime: 2.1,
              duration: 180,
            },
          ],
        } as any,
      });

      expect(verification.passed).toBe(true);
      expect(verification.outcome).toBe("success");
    });
  });

  // 9. No website URL being required for local-file tasks
  describe("9. No website URL being required for local-file tasks", () => {
    it("decomposes 'find hey sinamika on my computer' as local_file task", () => {
      const intent = SemanticDecomposer.decompose("find hey sinamika on my computer");
      expect(intent.taskScope).toBe("local_file");
      expect(intent.intentType).toBe("LOCAL_MEDIA_PLAY");
      expect(intent.entity?.toLowerCase()).toBe("hey sinamika");

      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "find hey sinamika on my computer",
      });
      expect(spec.isLocalFile).toBe(true);
      expect(spec.taskScope).toBe("local_file");
      expect(spec.targetUrl).toBeUndefined();
    });

    it("decomposes 'play hey sinamika from downloads folder from local storage' without website URL", () => {
      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play hey sinamika from downloads folder from local storage",
      });
      expect(spec.isLocalFile).toBe(true);
      expect(spec.taskScope).toBe("local_file");
      expect(spec.operation).toBe("LOCAL_MEDIA_PLAY");
      expect(spec.targetUrl).toBeUndefined();
    });

    it("plans direct player navigation without demanding website URL clarification", () => {
      LocalFileSecurityManager.enableWholeComputer(true);

      const spec = EntityConstraintResolver.resolve({
        rawInstruction: "play classical sonata on my computer",
      });

      const plan = DynamicTaskPlanner.plan({ spec });
      const navAction = plan.actions.find((a) => a.type === ActionType.NAVIGATE);
      expect(navAction).toBeDefined();
      expect(String(navAction?.value)).toContain("/player/audio");

      // Verify no clarification action demanding website
      const websiteClarify = plan.actions.find(
        (a) => a.type === ActionType.REQUEST_CLARIFICATION && a.reason?.toLowerCase().includes("website")
      );
      expect(websiteClarify).toBeUndefined();
    });
  });
});
