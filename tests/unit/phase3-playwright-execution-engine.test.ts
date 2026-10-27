import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { LocatorEngine } from "@/lib/browser/locator-engine";
import { PageObserver } from "@/lib/browser/page-observer";
import { ActionVerifier } from "@/lib/agent/action-verifier";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { LocalFileResolver } from "@/lib/local/local-file-resolver";
import { Action, ActionType, ActionStatus, LocatorStrategy, RiskLevel } from "@/lib/types/actions";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { PageObservation } from "@/lib/types/browser";

describe("Phase 3 — Generalized Playwright Execution, Media, Recovery & Local Files Benchmark", () => {
  const testWorkspaceDir = path.resolve(process.cwd());
  const scratchDir = path.resolve(testWorkspaceDir, "scratch");

  beforeEach(() => {
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
  });

  // =========================================================================
  // 1. Generalized Locator Engine & Priority Hierarchy (Section 2)
  // =========================================================================
  describe("1. Generalized Locator Engine & Priority Hierarchy", () => {
    it("resolves accessible role + name with highest priority (Tier 1)", async () => {
      const mockPage = {
        getByRole: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          nth: vi.fn().mockReturnValue({
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          }),
          first: vi.fn().mockReturnValue({
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          }),
        }),
        locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      } as any;

      const res = await LocatorEngine.resolve(mockPage, {
        strategy: LocatorStrategy.ROLE,
        value: "Checkout Now",
        role: "button",
      });

      expect(res.strategyUsed).toBe(LocatorStrategy.ROLE);
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
      expect(mockPage.getByRole).toHaveBeenCalledWith("button", { name: "Checkout Now", exact: undefined });
    });

    it("resolves Tier 4 explicit accessible attributes (aria-label, title) when role is absent", async () => {
      const mockPage = {
        getByRole: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        locator: vi.fn().mockImplementation((selector: string) => {
          if (selector.includes("aria-label")) {
            return {
              count: vi.fn().mockResolvedValue(1),
              nth: vi.fn().mockReturnValue({
                isVisible: vi.fn().mockResolvedValue(true),
                isEnabled: vi.fn().mockResolvedValue(true),
              }),
              first: vi.fn().mockReturnValue({
                isVisible: vi.fn().mockResolvedValue(true),
                isEnabled: vi.fn().mockResolvedValue(true),
              }),
            };
          }
          return { count: vi.fn().mockResolvedValue(0) };
        }),
      } as any;

      const res = await LocatorEngine.resolve(mockPage, {
        strategy: LocatorStrategy.ACCESSIBLE_ATTR,
        value: "Close modal dialog",
      });

      expect(res.strategyUsed).toBe(LocatorStrategy.ACCESSIBLE_ATTR);
      expect(res.confidence).toBeGreaterThan(0.7);
    });

    it("rejects unindexed execution when multiple visible matches cause ambiguity (Section 2 Rule 4)", async () => {
      const mockAmbiguousLocator = {
        count: vi.fn().mockResolvedValue(2),
        nth: vi.fn().mockImplementation(() => ({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        })),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        }),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue(mockAmbiguousLocator),
        locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      } as any;

      await expect(
        LocatorEngine.resolve(mockPage, {
          strategy: LocatorStrategy.ROLE,
          value: "Delete",
          role: "button",
        })
      ).rejects.toThrowError(/ambiguous elements/i);
    });

    it("detects stale or detached locators via isLocatorFresh", async () => {
      const freshLocator = {
        count: vi.fn().mockResolvedValue(1),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
        }),
      } as any;

      const staleLocator = {
        count: vi.fn().mockRejectedValue(new Error("Target element detached from DOM")),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockRejectedValue(new Error("Node is detached")),
        }),
      } as any;

      expect(await LocatorEngine.isLocatorFresh(freshLocator)).toBe(true);
      expect(await LocatorEngine.isLocatorFresh(staleLocator)).toBe(false);
      expect(await LocatorEngine.isLocatorFresh(undefined)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Media Discovery and Playback Controls (Section 6)
  // =========================================================================
  describe("2. Media Discovery and Playback Controls", () => {
    it("executes ActionType.MEDIA_PLAY and verifies observable playing state", async () => {
      const fakeEl: any = {
        paused: false,
        ended: false,
        currentTime: 1.5,
        duration: 120,
        readyState: 4,
        error: null,
        isPlaying: true,
        muted: false,
        play: vi.fn().mockResolvedValue(undefined),
      };

      const mockVideo: any = {
        count: vi.fn().mockResolvedValue(1),
        first: vi.fn(),
        isVisible: vi.fn().mockResolvedValue(false),
        click: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (fn: any, ...args: any[]) => {
          if (typeof fn === "function") {
            try {
              const res = fn(fakeEl, ...args);
              if (res !== undefined) return res;
            } catch {
              // fallback
            }
          }
          return {
            isPlaying: true,
            isPaused: false,
            currentTime: 1.5,
            duration: 120,
            readyState: 4,
            error: null,
          };
        }),
        evaluateAll: vi.fn().mockImplementation(async (fn: any) => {
          if (typeof fn === "function") {
            return fn([fakeEl]);
          }
          return true;
        }),
      };
      mockVideo.first.mockReturnValue(mockVideo);

      const mockPage = {
        url: () => "http://localhost:3000/test-fixtures/media",
        title: async () => "Media Fixture",
        locator: vi.fn().mockReturnValue(mockVideo),
        getByRole: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(0),
          first: vi.fn().mockReturnValue({ isVisible: vi.fn().mockResolvedValue(false), click: vi.fn().mockResolvedValue(undefined) }),
        }),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (fn: any, arg?: any) => {
          if (typeof fn === "function") {
            const src = fn.toString();
            if (src.includes("video unavailable") || src.includes("sign in") || src.includes("ytp-play-button")) {
              return false;
            }
          }
          return {
            interactiveElements: [],
            headings: ["Media Fixture"],
            dialogs: [],
            forms: [],
            mediaElements: [
              {
                id: "fixture-video",
                tagName: "video",
                isPlaying: true,
                isPaused: false,
                isMuted: false,
                currentTime: 1.5,
                duration: 120,
                volume: 1,
                readyState: 4,
                ended: false,
                error: null,
              },
            ],
          };
        }),
      } as any;

      const action: Action = {
        id: "media-play-1",
        type: ActionType.MEDIA_PLAY,
        risk: RiskLevel.LOW,
        reason: "Start video playback",
      };

      const res = await ActionExecutor.execute({
        action,
        page: mockPage,
        tabId: "tab-1",
      });

      expect(res.result.status).toBe(ActionStatus.COMPLETED);
      expect(res.result.verified).toBe(true);
      expect((res.result.extractedData as any).isPlaying).toBe(true);
    });

    it("fails verification and reports error when media element is paused (click alone != playback)", () => {
      const action: Action = {
        id: "media-play-fail",
        type: ActionType.MEDIA_PLAY,
        risk: RiskLevel.LOW,
        reason: "Verify playback requirement",
      };

      const observation: PageObservation = {
        url: "http://localhost:3000/media",
        title: "Video Player",
        headings: [],
        interactiveElements: [],
        mediaElements: [
          {
            tagName: "video",
            isPlaying: false,
            isPaused: true, // Remains paused!
            isMuted: false,
            currentTime: 0,
            duration: 100,
            volume: 1,
            readyState: 2,
            ended: false,
            error: null,
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Media page",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = ActionVerifier.verifyAction({
        action,
        afterObservation: observation,
      });

      expect(verification.verified).toBe(false);
      expect(verification.reason).toContain("Media element remained paused");
    });

    it("detects and reports media errors (e.g. DRM, unsupported format, network error)", () => {
      const action: Action = {
        id: "media-play-err",
        type: ActionType.MEDIA_PLAY,
        risk: RiskLevel.LOW,
        reason: "Attempt playback on corrupted source",
      };

      const observation: PageObservation = {
        url: "http://localhost:3000/media",
        title: "Broken Player",
        headings: [],
        interactiveElements: [],
        mediaElements: [
          {
            tagName: "video",
            isPlaying: false,
            isPaused: true,
            isMuted: false,
            currentTime: 0,
            duration: 0,
            volume: 1,
            readyState: 0,
            ended: false,
            error: "MEDIA_ERR_SRC_NOT_SUPPORTED: Format not decodable",
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Broken media page",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = ActionVerifier.verifyAction({
        action,
        afterObservation: observation,
      });

      expect(verification.verified).toBe(false);
      expect(verification.reason).toContain("MEDIA_ERR_SRC_NOT_SUPPORTED");
    });

    it("verifies MEDIA_PAUSE and MEDIA_MUTE actions accurately", () => {
      const pauseAction: Action = {
        id: "media-pause-1",
        type: ActionType.MEDIA_PAUSE,
        risk: RiskLevel.LOW,
        reason: "Pause playback",
      };

      const pausedObservation: PageObservation = {
        url: "http://localhost:3000/media",
        title: "Media",
        headings: [],
        interactiveElements: [],
        mediaElements: [
          {
            tagName: "video",
            isPlaying: false,
            isPaused: true,
            isMuted: false,
            currentTime: 4.2,
            duration: 60,
            volume: 1,
            readyState: 4,
            ended: false,
          },
        ],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const pauseResult = ActionVerifier.verifyAction({
        action: pauseAction,
        afterObservation: pausedObservation,
      });
      expect(pauseResult.verified).toBe(true);

      const muteAction: Action = {
        id: "media-mute-1",
        type: ActionType.MEDIA_MUTE,
        risk: RiskLevel.LOW,
        reason: "Mute audio",
      };

      const mutedObservation: PageObservation = {
        ...pausedObservation,
        mediaElements: [
          {
            ...pausedObservation.mediaElements![0],
            isMuted: true,
          },
        ],
      };

      const muteResult = ActionVerifier.verifyAction({
        action: muteAction,
        afterObservation: mutedObservation,
      });
      expect(muteResult.verified).toBe(true);
    });
  });

  // =========================================================================
  // 3. Local Files, Discovery and Path Boundary Safety (Section 7)
  // =========================================================================
  describe("3. Local Files, Discovery and Path Boundary Safety", () => {
    const testFile = path.join(scratchDir, "sample_document.pdf");

    beforeEach(() => {
      fs.writeFileSync(testFile, "%PDF-1.4 Mock PDF Content For Testing");
    });

    afterEach(() => {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    });

    it("resolves authorized local file and generates valid localhost streaming URL", async () => {
      const resolved = await LocalFileResolver.resolveFile({
        pathOrName: testFile,
      });

      expect(resolved.filename).toBe("sample_document.pdf");
      expect(resolved.extension).toBe(".pdf");
      expect(resolved.mimeType).toBe("application/pdf");
      expect(resolved.browserUrl).toContain("http://localhost:3000/api/local-file?path=");
      expect(resolved.sizeBytes).toBeGreaterThan(0);
    });

    it("discovers local file by filename query within authorized search roots", async () => {
      const resolved = await LocalFileResolver.resolveFile({
        pathOrName: "sample_document.pdf",
        searchDirectory: scratchDir,
      });

      expect(resolved.filename).toBe("sample_document.pdf");
      expect(resolved.canonicalPath).toBe(fs.realpathSync(testFile));
    });

    it("rejects path traversal attempts escaping authorized roots (.. traversal)", () => {
      const traversalPath = path.join(testWorkspaceDir, "..", "..", "Windows", "System32", "cmd.exe");
      const check = LocalFileResolver.isPermittedPath(traversalPath);
      expect(check.permitted).toBe(false);
      expect(check.reason).toMatch(/outside authorized search roots/i);
    });

    it("rejects unauthorized sensitive files (e.g. /etc/passwd or root directories)", () => {
      const check = LocalFileResolver.isPermittedPath("C:\\Windows\\win.ini");
      expect(check.permitted).toBe(false);
    });

    it("rejects unsupported file formats not renderable by standard browsers (.exe, .dll, .bin)", async () => {
      const binFile = path.join(scratchDir, "binary_payload.bin");
      fs.writeFileSync(binFile, Buffer.from([0x00, 0x01, 0x02]));

      try {
        await expect(
          LocalFileResolver.resolveFile({ pathOrName: binFile })
        ).rejects.toThrowError(/not supported for direct browser rendering/i);
      } finally {
        if (fs.existsSync(binFile)) fs.unlinkSync(binFile);
      }
    });

    it("detects and rejects ambiguous duplicate filenames in different directories", async () => {
      const subDir = path.join(scratchDir, "subfolder");
      if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });
      const duplicateFile = path.join(subDir, "sample_document.pdf");
      fs.writeFileSync(duplicateFile, "%PDF-1.4 Duplicate Mock PDF");

      try {
        await expect(
          LocalFileResolver.resolveFile({
            pathOrName: "sample_document.pdf",
            searchDirectory: scratchDir,
          })
        ).rejects.toThrowError(/Multiple matching files found/i);
      } finally {
        if (fs.existsSync(duplicateFile)) fs.unlinkSync(duplicateFile);
        if (fs.existsSync(subDir)) fs.rmdirSync(subDir);
      }
    });

    it("throws clear error when local file does not exist (never hallucinates existence)", async () => {
      await expect(
        LocalFileResolver.resolveFile({
          pathOrName: "non_existent_novel_file_999.mp4",
          searchDirectory: scratchDir,
        })
      ).rejects.toThrowError(/was not found in authorized local search roots/i);
    });
  });

  // =========================================================================
  // 4. File Uploads and Downloads (Section 8)
  // =========================================================================
  describe("4. File Uploads and Downloads", () => {
    const uploadDoc = path.join(scratchDir, "test_invoice.pdf");

    beforeEach(() => {
      fs.writeFileSync(uploadDoc, "Invoice Content 2026");
    });

    afterEach(() => {
      if (fs.existsSync(uploadDoc)) fs.unlinkSync(uploadDoc);
    });

    it("executes ActionType.UPLOAD using Playwright setInputFiles and verifies file attachment", async () => {
      const mockSetInputFiles = vi.fn().mockResolvedValue(undefined);
      const mockFileInput = {
        count: vi.fn().mockResolvedValue(1),
        setInputFiles: mockSetInputFiles,
        first: vi.fn().mockReturnValue({ setInputFiles: mockSetInputFiles }),
      };

      const mockPage = {
        url: () => "http://localhost:3000/test-fixtures/upload",
        title: async () => "Upload Fixture",
        locator: vi.fn().mockReturnValue(mockFileInput),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({
          interactiveElements: [],
          headings: ["Upload Fixture"],
          forms: [],
          mediaElements: [],
        }),
      } as any;

      const action: Action = {
        id: "upload-step-1",
        type: ActionType.UPLOAD,
        value: uploadDoc,
        risk: RiskLevel.LOW,
        reason: "Upload test invoice PDF",
      };

      const res = await ActionExecutor.execute({
        action,
        page: mockPage,
        tabId: "tab-1",
      });

      expect(res.result.status).toBe(ActionStatus.COMPLETED);
      expect(res.result.verified).toBe(true);
      expect(mockSetInputFiles).toHaveBeenCalledWith(fs.realpathSync(uploadDoc), expect.any(Object));
      expect((res.result.extractedData as any).uploadedFile).toBe("test_invoice.pdf");
    });

    it("blocks upload of sensitive credentials/keys (.env, id_rsa) without confirmation", async () => {
      const sensitiveFile = path.join(scratchDir, ".env");
      fs.writeFileSync(sensitiveFile, "API_KEY=secret_key_123");

      const mockPage = {
        url: () => "http://localhost:3000",
        title: async () => "Site",
        locator: vi.fn().mockReturnValue({ setInputFiles: vi.fn() }),
      } as any;

      try {
        const action: Action = {
          id: "upload-sensitive",
          type: ActionType.UPLOAD,
          value: sensitiveFile,
          risk: RiskLevel.LOW,
          reason: "Upload configuration",
        };

        const res = await ActionExecutor.execute({
          action,
          page: mockPage,
          tabId: "tab-1",
        });

        expect(res.result.status).toBe(ActionStatus.FAILED);
        expect(res.result.error?.message).toMatch(/sensitive file.*requires explicit user confirmation/i);
      } finally {
        if (fs.existsSync(sensitiveFile)) fs.unlinkSync(sensitiveFile);
      }
    });

    it("verifies download artifact exists and is non-empty", () => {
      const action: Action = {
        id: "download-1",
        type: ActionType.DOWNLOAD,
        risk: RiskLevel.LOW,
        reason: "Download report",
      };

      const dummyObs: PageObservation = {
        url: "http://localhost:3000",
        title: "",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const successVerification = ActionVerifier.verifyAction({
        action,
        afterObservation: dummyObs,
        downloadedArtifact: {
          id: "dl-1",
          originalFilename: "report.pdf",
          savedPath: "/downloads/report.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 4096,
          downloadTime: new Date().toISOString(),
          verified: true,
        },
      });
      expect(successVerification.verified).toBe(true);

      const emptyFileVerification = ActionVerifier.verifyAction({
        action,
        afterObservation: dummyObs,
        downloadedArtifact: {
          id: "dl-2",
          originalFilename: "corrupted.pdf",
          savedPath: "/downloads/corrupted.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 0, // Corrupted / 0 bytes!
          downloadTime: new Date().toISOString(),
          verified: false,
        },
      });
      expect(emptyFileVerification.verified).toBe(false);
      expect(emptyFileVerification.reason).toMatch(/is empty \(0 bytes\)/i);
    });
  });

  // =========================================================================
  // 5. Dynamic Synchronization, SPAs and Stale Elements (Section 4 & 9)
  // =========================================================================
  describe("5. Dynamic Synchronization and Recovery Engine", () => {
    it("classifies CAPTCHA challenge and pauses execution for user assistance (Section 10)", () => {
      const action: Action = {
        id: "click-search",
        type: ActionType.CLICK,
        target: { strategy: "role", value: "Search" },
        reason: "Perform search",
      };

      const decision = RecoveryEngine.determineRecovery({
        action,
        error: new AgentError("Google /sorry/ Unusual traffic CAPTCHA detected", ErrorCode.CAPTCHA_DETECTED, false),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: {
          url: "https://www.google.com/sorry/index",
          title: "Sorry...",
          headings: ["Our systems have detected unusual traffic"],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
        },
      });

      expect(decision.strategy).toBe("WAITING_FOR_USER");
      expect(decision.terminal).toBe(false);
      expect(decision.reason).toContain("CAPTCHA detected");
    });

    it("prevents blind retries on side-effecting actions (form submit, purchase, upload) (Section 9)", () => {
      const submitAction: Action = {
        id: "submit-payment",
        type: ActionType.CLICK,
        target: { strategy: "role", value: "Pay and Place Order" },
        reason: "Finalize purchase",
      };

      const decision = RecoveryEngine.determineRecovery({
        action: submitAction,
        error: new Error("Network timeout after click"),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
      });

      expect(decision.strategy).toBe("WAITING_FOR_USER");
      expect(decision.requiresConfirmation).toBe(true);
      expect(decision.reason).toContain("side-effecting operation");
    });

    it("halts immediately without looping on terminal HTTP 404 (Section 4 & 9)", () => {
      const navAction: Action = {
        id: "nav-missing",
        type: ActionType.NAVIGATE,
        value: "http://localhost:3000/non-existent-page",
        reason: "Visit missing resource",
      };

      const decision = RecoveryEngine.determineRecovery({
        action: navAction,
        error: new AgentError("Page not found", ErrorCode.NAVIGATION_FAILED, false),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: {
          url: "http://localhost:3000/404",
          title: "404 - Page Not Found",
          headings: ["404: This page could not be found."],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "404 page",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
        },
      });

      expect(decision.strategy).toBe("FAIL");
      expect(decision.terminal).toBe(true);
      expect(decision.reason).toContain("HTTP 404 / Not Found");
    });

    it("discovers alternative semantic locator when primary locator fails and is unambiguous", () => {
      const failingTarget = { strategy: LocatorStrategy.ID, value: "search-button" };
      const action: Action = {
        id: "click-search-btn",
        type: ActionType.CLICK,
        target: failingTarget,
        reason: "Click search button",
      };

      const obsWithAlt: PageObservation = {
        url: "http://localhost:3000/search",
        title: "Search Catalog",
        headings: [],
        interactiveElements: [
          {
            id: "btn-search-new",
            role: "button",
            tagName: "BUTTON",
            text: "Search",
            name: "searchBtn",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [
              { strategy: LocatorStrategy.ROLE, value: "Search", confidence: 0.95 },
            ],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const decision = RecoveryEngine.determineRecovery({
        action,
        error: new AgentError("Target not found", ErrorCode.ELEMENT_NOT_FOUND, true),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: obsWithAlt,
      });

      expect(decision.strategy).toBe("RETRY_WITH_ALTERNATIVE_LOCATOR");
      expect(decision.suggestedTarget).toBeDefined();
      expect(decision.suggestedTarget?.value).toBe("Search");
    });
  });

  // =========================================================================
  // 6. Zero False-Success Guarantees (Section 1)
  // =========================================================================
  describe("6. Zero False-Success Guarantees", () => {
    it("fails navigation verification if final URL origin mismatches requested target", () => {
      const action: Action = {
        id: "nav-verify",
        type: ActionType.NAVIGATE,
        value: "https://example.com/products",
        reason: "Visit products",
      };

      const redirectedToMaliciousObs: PageObservation = {
        url: "https://phishing-site.com/login",
        title: "Phishing Login",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const res = ActionVerifier.verifyAction({
        action,
        afterObservation: redirectedToMaliciousObs,
      });

      expect(res.verified).toBe(false);
      expect(res.reason).toContain("expected origin 'https://example.com'");
    });

    it("fails text extraction verification if extracted value is empty", () => {
      const action: Action = {
        id: "extract-price",
        type: ActionType.EXTRACT_TEXT,
        target: { strategy: "css", value: ".price" },
        reason: "Extract product price",
      };

      const res = ActionVerifier.verifyAction({
        action,
        afterObservation: {
          url: "http://localhost:3000",
          title: "",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
        },
        extractedValue: "", // Empty string
      });

      expect(res.verified).toBe(false);
      expect(res.reason).toContain("Extracted value is empty");
    });
  });
});
