import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent/route";
import { BrowserManager, detectDisplayEnvironment } from "@/lib/browser/browser-manager";
import { AgentLoop } from "@/lib/agent/agent-loop";
import { getConfig, resetConfigForTesting } from "@/lib/config";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { AgentState } from "@/lib/types/plans";

/**
 * Creates an isolated mock Playwright Browser for unit test execution,
 * ensuring tests do not spawn dozens of visible desktop OS windows.
 */
function createMockBrowser(): Browser {
  let isBrowserClosed = false;
  return {
    isConnected: () => !isBrowserClosed,
    newContext: vi.fn().mockImplementation(async () => {
      let isContextClosed = false;
      let isPageClosed = false;
      const mockPage = {
        url: () => "about:blank",
        title: async () => "New Tab",
        goto: vi.fn().mockResolvedValue({ status: () => 200 }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        isClosed: () => isPageClosed,
        close: vi.fn().mockImplementation(async () => {
          isPageClosed = true;
        }),
        on: vi.fn(),
        content: async () => "<html><body><h1>Test Page</h1></body></html>",
        locator: vi.fn().mockReturnValue({
          count: async () => 0,
          first: () => ({ click: vi.fn(), isVisible: async () => true, isEnabled: async () => true }),
        }),
      };

      return {
        newPage: vi.fn().mockResolvedValue(mockPage),
        isClosed: () => isContextClosed,
        close: vi.fn().mockImplementation(async () => {
          isContextClosed = true;
          isPageClosed = true;
        }),
        on: vi.fn(),
      };
    }),
    close: vi.fn().mockImplementation(async () => {
      isBrowserClosed = true;
    }),
    on: vi.fn(),
  } as unknown as Browser;
}

describe("Visible Browser Window Lifecycle & Headless Mode Removal", () => {
  beforeEach(() => {
    resetConfigForTesting();
  });

  afterEach(async () => {
    const manager = BrowserManager.getInstance();
    await manager.close().catch(() => {});
    vi.restoreAllMocks();
  });

  it("1. Config defaults enforce visible browser execution (BROWSER_HEADLESS is false)", () => {
    const config = getConfig();
    expect(config.BROWSER_HEADLESS).toBe(false);
  });

  it("2. Caller supplying headless: true cannot enable headless execution (enforces headless: false)", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();

    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValueOnce(createMockBrowser());

    // Caller explicitly attempts to pass headless: true via options
    await manager.ensureBrowserInstance({ headless: true } as any);

    // Verified: Chromium launch was called with headless: false, NOT headless: true
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(launchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      })
    );
    expect(launchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
      })
    );
  });

  it("3. Legacy environment configuration (BROWSER_HEADLESS=true) cannot override visible-only enforcement", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();

    // Set legacy environment variable
    process.env.BROWSER_HEADLESS = "true";
    const config = resetConfigForTesting({ BROWSER_HEADLESS: true } as any);
    expect(config.BROWSER_HEADLESS).toBe(false);

    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValueOnce(createMockBrowser());

    await manager.ensureBrowserInstance();

    expect(launchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      })
    );
    delete process.env.BROWSER_HEADLESS;
  });

  it("4. Every actual user-task launch passes headless: false", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();

    const launchSpy = vi.spyOn(chromium, "launch").mockResolvedValueOnce(createMockBrowser());

    const agent = new AgentLoop();
    await agent.runTask({
      taskId: "task-actual-user-launch",
      task: "Open example.com",
      targetUrl: "https://example.com",
      forceBrowser: true,
    }).catch(() => {});

    expect(launchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      })
    );
  }, 20000);

  it("5. A display failure does not trigger a headless retry (honest failure reporting)", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();

    const launchSpy = vi.spyOn(chromium, "launch").mockRejectedValue(
      new Error("Missing X server or $DISPLAY: cannot open visible display")
    );

    let caughtError: AgentError | null = null;
    try {
      await manager.ensureBrowserInstance();
    } catch (err) {
      caughtError = err as AgentError;
    }

    expect(caughtError).toBeInstanceOf(AgentError);
    expect(caughtError?.code).toBe(ErrorCode.BROWSER_LAUNCH_FAILED);
    expect(caughtError?.message).toContain("Failed to launch visible browser window");

    // Chromium launch must NOT be retried with headless: true
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(launchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: false,
      })
    );
    expect(launchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
      })
    );
  });

  it("6. Every new task receives its own visible browser window and isolated context", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();
    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    const session1 = await manager.createTaskSession("task-user-1");
    const session2 = await manager.createTaskSession("task-user-2");

    expect(session1.taskId).toBe("task-user-1");
    expect(session2.taskId).toBe("task-user-2");

    // Must be completely different contexts and pages
    expect(session1.context).not.toBe(session2.context);
    expect(session1.page).not.toBe(session2.page);

    // Both windows open
    expect(session1.windowOpen).toBe(true);
    expect(session2.windowOpen).toBe(true);
    expect(session1.page.isClosed()).toBe(false);
    expect(session2.page.isClosed()).toBe(false);
  });

  it("7. Task does not reuse a previous task's active page", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();
    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    const sessionA = await manager.createTaskSession("task-A");
    const pageA = sessionA.page;

    // Simulate task A navigating to a site
    await pageA.goto("about:blank");

    // Start Task B
    const sessionB = await manager.createTaskSession("task-B");
    const pageB = sessionB.page;

    expect(pageB).not.toBe(pageA);
    expect(sessionB.context).not.toBe(sessionA.context);

    // Active page for task B is page B, not page A
    const activeB = await manager.getActivePage("task-B");
    expect(activeB.page).toBe(pageB);
  });

  it("8. Completed task visible window remains open for user inspection", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();
    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    const session = await manager.createTaskSession("task-completed-test");
    expect(session.windowOpen).toBe(true);

    // Simulate task completion
    manager.completeTaskSession("task-completed-test", "completed");

    // The window must remain open and not closed
    expect(session.windowOpen).toBe(true);
    expect(session.page.isClosed()).toBe(false);
    expect(manager.isWindowOpen("task-completed-test")).toBe(true);
  });

  it("9. Failed task visible window remains open for user debugging", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();
    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    const session = await manager.createTaskSession("task-failed-test");
    expect(session.windowOpen).toBe(true);

    // Simulate task failure
    manager.completeTaskSession("task-failed-test", "failed");

    expect(session.windowOpen).toBe(true);
    expect(session.page.isClosed()).toBe(false);
    expect(manager.isWindowOpen("task-failed-test")).toBe(true);
  });

  it("10. Per-task cleanup does not close another task's window", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();
    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    const session1 = await manager.createTaskSession("task-isolate-1");
    const session2 = await manager.createTaskSession("task-isolate-2");

    // Close session 1
    const closed = await manager.closeTaskSession("task-isolate-1");
    expect(closed).toBe(true);
    expect(session1.windowOpen).toBe(false);
    expect(session1.page.isClosed()).toBe(true);

    // Session 2 MUST remain completely intact and open
    expect(session2.windowOpen).toBe(true);
    expect(session2.page.isClosed()).toBe(false);
    expect(manager.isWindowOpen("task-isolate-2")).toBe(true);
  });

  it("11. Bounded completed window retention prunes oldest completed windows without touching active tasks", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();
    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    // Create 6 completed task sessions
    const sessions = [];
    for (let i = 1; i <= 6; i++) {
      const s = await manager.createTaskSession(`task-retention-${i}`);
      manager.completeTaskSession(`task-retention-${i}`, "completed");
      sessions.push(s);
    }

    // Now prune to max 5
    const pruned = await manager.pruneCompletedSessions(5);
    expect(pruned).toBe(1);

    // Oldest session (task-retention-1) is closed
    expect(sessions[0].page.isClosed()).toBe(true);
    expect(manager.getTaskSession("task-retention-1")).toBeUndefined();

    // The other 5 sessions remain open
    for (let i = 1; i < 6; i++) {
      expect(sessions[i].page.isClosed()).toBe(false);
      expect(manager.getTaskSession(`task-retention-${i + 1}`)).toBeDefined();
    }
  });

  it("12. AgentLoop tracks browserWindow state honestly on task completion", async () => {
    const agent = new AgentLoop();
    const emittedEvents: string[] = [];

    const sessionMock = {
      taskId: "task-agent-test",
      context: {
        newPage: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      },
      page: {
        url: () => "https://example.com",
        title: async () => "Example Domain",
        goto: vi.fn().mockResolvedValue({ status: () => 200 }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        isClosed: () => false,
        on: vi.fn(),
        content: async () => "<html><body><h1>Example Domain</h1></body></html>",
        locator: vi.fn().mockReturnValue({
          count: async () => 1,
          first: () => ({
            click: vi.fn(),
            isVisible: async () => true,
            isEnabled: async () => true,
          }),
        }),
      },
      tabId: "tab-1",
      tabs: new Map(),
      activeTabId: "tab-1",
      createdAt: Date.now(),
      status: "active" as const,
      windowOpen: true,
    };

    vi.spyOn(BrowserManager.getInstance(), "createTaskSession").mockResolvedValue(sessionMock as any);
    vi.spyOn(BrowserManager.getInstance(), "isWindowOpen").mockReturnValue(true);

    const result = await agent.runTask({
      taskId: "task-agent-test",
      task: "Check example domain",
      targetUrl: "https://example.com",
      onEvent: (evt) => {
        emittedEvents.push(evt.type);
      },
    });

    // Verified: BROWSER_LAUNCHED event was emitted
    expect(emittedEvents).toContain("BROWSER_LAUNCHED");

    // Verified: browserWindow state is honest and indicates window is open and retained
    expect(result.browserWindow).toBeDefined();
    expect(result.browserWindow?.taskId).toBe("task-agent-test");
    expect(result.browserWindow?.isVisible).toBe(true);
    expect(result.browserWindow?.isOpen).toBe(true);
  }, 20000);

  it("13. Playwright and Gemini-Assisted operating modes both use Playwright browser execution", async () => {
    const agent = new AgentLoop();
    const mockSession = {
      taskId: "mode-test",
      context: { close: vi.fn().mockResolvedValue(undefined) },
      page: {
        url: () => "https://example.com",
        title: async () => "Example",
        goto: vi.fn().mockResolvedValue({ status: () => 200 }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
        isClosed: () => false,
        on: vi.fn(),
        content: async () => "<html><body><h1>Example</h1></body></html>",
        locator: vi.fn().mockReturnValue({
          count: async () => 1,
          first: () => ({ click: vi.fn(), isVisible: async () => true, isEnabled: async () => true }),
        }),
      },
      tabId: "tab-m",
      tabs: new Map(),
      activeTabId: "tab-m",
      createdAt: Date.now(),
      status: "active" as const,
      windowOpen: true,
    };

    const createSessionSpy = vi.spyOn(BrowserManager.getInstance(), "createTaskSession").mockResolvedValue(mockSession as any);
    vi.spyOn(BrowserManager.getInstance(), "isWindowOpen").mockReturnValue(true);

    // Playwright mode
    await agent.runTask({
      task: "Open example",
      targetUrl: "https://example.com",
      operatingMode: "playwright",
    }).catch(() => {});

    expect(createSessionSpy).toHaveBeenCalled();
    createSessionSpy.mockClear();

    // Gemini-Assisted mode
    await agent.runTask({
      task: "Open example",
      targetUrl: "https://example.com",
      operatingMode: "gemini_assisted",
    }).catch(() => {});

    expect(createSessionSpy).toHaveBeenCalled();
  }, 20000);

  it("14. detectDisplayEnvironment accurately identifies display server availability or reports limitation", () => {
    const originalPlatform = process.platform;
    const originalDisplay = process.env.DISPLAY;
    const originalWayland = process.env.WAYLAND_DISPLAY;

    try {
      // Simulate remote Linux headless server without display server
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;

      const headlessLinux = detectDisplayEnvironment();
      expect(headlessLinux.hasDisplay).toBe(false);
      expect(headlessLinux.displayType).toBe("none");
      expect(headlessLinux.warning).toContain("Remote server or headless deployment environment detected");

      // Simulate Linux with X11 display
      process.env.DISPLAY = ":0";
      const x11Linux = detectDisplayEnvironment();
      expect(x11Linux.hasDisplay).toBe(true);
      expect(x11Linux.displayType).toBe("x11");

      // Simulate Linux with Wayland
      delete process.env.DISPLAY;
      process.env.WAYLAND_DISPLAY = "wayland-0";
      const waylandLinux = detectDisplayEnvironment();
      expect(waylandLinux.hasDisplay).toBe(true);
      expect(waylandLinux.displayType).toBe("wayland");

      // Simulate Windows environment
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const winEnv = detectDisplayEnvironment();
      expect(winEnv.hasDisplay).toBe(true);
      expect(winEnv.displayType).toBe("windows");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      if (originalDisplay !== undefined) process.env.DISPLAY = originalDisplay;
      else delete process.env.DISPLAY;
      if (originalWayland !== undefined) process.env.WAYLAND_DISPLAY = originalWayland;
      else delete process.env.WAYLAND_DISPLAY;
    }
  });

  it("15. ensureBrowserInstance proactively aborts and reports limitation on headless Linux environments without $DISPLAY", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();

    const originalPlatform = process.platform;
    const originalDisplay = process.env.DISPLAY;
    const originalWayland = process.env.WAYLAND_DISPLAY;

    try {
      // Mock Linux headless server
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      delete process.env.DISPLAY;
      delete process.env.WAYLAND_DISPLAY;

      let caughtError: AgentError | null = null;
      try {
        await manager.ensureBrowserInstance();
      } catch (err) {
        caughtError = err as AgentError;
      }

      expect(caughtError).toBeInstanceOf(AgentError);
      expect(caughtError?.code).toBe(ErrorCode.BROWSER_LAUNCH_FAILED);
      expect(caughtError?.message).toContain("Graphical browser display unavailable: Remote server or headless deployment environment detected");
      expect(caughtError?.message).toContain("$DISPLAY / $WAYLAND_DISPLAY is missing");
      expect(caughtError?.message).toContain("does not simulate visible execution");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      if (originalDisplay !== undefined) process.env.DISPLAY = originalDisplay;
      else delete process.env.DISPLAY;
      if (originalWayland !== undefined) process.env.WAYLAND_DISPLAY = originalWayland;
      else delete process.env.WAYLAND_DISPLAY;
    }
  });

  it("16. BrowserManager accurately reports verified launch state, active sessions, and open windows", async () => {
    const manager = BrowserManager.getInstance();
    await manager.close();

    // Before launch
    expect(manager.isBrowserLaunched()).toBe(false);
    expect(manager.getActiveSessionsCount()).toBe(0);
    expect(manager.getOpenWindowsCount()).toBe(0);

    vi.spyOn(chromium, "launch").mockResolvedValue(createMockBrowser());

    const session = await manager.createTaskSession("task-verified-state");
    expect(manager.isBrowserLaunched()).toBe(true);
    expect(manager.getActiveSessionsCount()).toBe(1);
    expect(manager.getOpenWindowsCount()).toBe(1);

    manager.completeTaskSession("task-verified-state", "completed");
    expect(manager.getActiveSessionsCount()).toBe(0);
    expect(manager.getOpenWindowsCount()).toBe(1); // Window retained

    await manager.closeTaskSession("task-verified-state");
    expect(manager.getOpenWindowsCount()).toBe(0);

    await manager.close();
    expect(manager.isBrowserLaunched()).toBe(false);
  });

  it("17. POST /api/agent rejects request attempting to specify headless: true with HTTP 400", async () => {
    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "Check news headlines",
        headless: true,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toMatch(/Headless Browser Mode has been removed/i);
  });

  it("18. POST /api/agent rejects request with settings.headless: true with HTTP 400", async () => {
    const request = new NextRequest("http://localhost:3000/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "Check news headlines",
        settings: { headless: true },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const json = await response.json();
    expect(json.error).toMatch(/Headless Browser Mode has been removed/i);
  });
});
