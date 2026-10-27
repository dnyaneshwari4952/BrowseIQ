import { chromium, Browser, BrowserContext, Page, Download } from "playwright";
import path from "path";
import fs from "fs";
import { getConfig } from "../config";
import { BrowserTab } from "../types/browser";
import { DownloadedArtifact } from "../types/results";
import { logger } from "../observability/logger";
import { AgentError, ErrorCode } from "../types/errors";

export interface TaskBrowserSession {
  taskId: string;
  context: BrowserContext;
  page: Page;
  tabId: string;
  tabs: Map<string, { page: Page; tab: BrowserTab }>;
  activeTabId: string | null;
  createdAt: number;
  status: "active" | "completed" | "failed" | "cancelled" | "closed" | "blocked";
  windowOpen: boolean;
}

export interface DisplayEnvironmentStatus {
  hasDisplay: boolean;
  displayType: "windows" | "macos" | "x11" | "wayland" | "none";
  warning?: string;
}

/**
 * Detects whether the current host environment has an active graphical display server
 * capable of rendering a visible browser window (Windows desktop, macOS Aqua, X11, or Wayland).
 */
export function detectDisplayEnvironment(): DisplayEnvironmentStatus {
  if (process.platform === "win32") {
    return { hasDisplay: true, displayType: "windows" };
  }
  if (process.platform === "darwin") {
    return { hasDisplay: true, displayType: "macos" };
  }
  // Linux / Unix / Container environments
  if (process.env.WAYLAND_DISPLAY) {
    return { hasDisplay: true, displayType: "wayland" };
  }
  if (process.env.DISPLAY) {
    return { hasDisplay: true, displayType: "x11" };
  }
  return {
    hasDisplay: false,
    displayType: "none",
    warning: "Remote server or headless deployment environment detected: no active display server ($DISPLAY or $WAYLAND_DISPLAY is not set). Graphical visible browser windows cannot be rendered.",
  };
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private browser: Browser | null = null;
  private sessions: Map<string, TaskBrowserSession> = new Map();
  private activeTaskId: string | null = null;
  private maxRetainedCompletedSessions = 5; // Retain up to 5 completed visible windows for user inspection
  private downloads: DownloadedArtifact[] = [];
  private downloadDir: string;
  private maxDownloadSizeBytes = 25 * 1024 * 1024; // 25MB safety limit

  private constructor() {
    const config = getConfig();
    this.downloadDir = path.resolve(process.cwd(), config.DOWNLOAD_DIR);
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Ensures the underlying Chromium browser instance is launched.
   * Strictly enforces visible window execution (headless: false) directly.
   * Does NOT derive launch value from caller settings, request bodies, env vars, or stale config.
   * Throws BROWSER_LAUNCH_FAILED with diagnostic error if graphical environment is unavailable.
   */
  async ensureBrowserInstance(_options?: { headless?: boolean }): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    // Clean up stale handles if browser was disconnected
    if (this.browser && !this.browser.isConnected()) {
      this.sessions.clear();
      this.activeTaskId = null;
      this.browser = null;
    }

    // Explicitly reject/ignore any caller-supplied headless option
    if (_options?.headless !== undefined) {
      logger.warn(
        "Caller supplied options.headless; ignored. Visible browser execution is strictly enforced (headless: false)."
      );
    }

    // Proactively verify graphical display capability before launching visible browser.
    // If no display server exists, fail honestly rather than pretending visible execution works.
    const displayStatus = detectDisplayEnvironment();
    if (!displayStatus.hasDisplay) {
      logger.error("Visible browser launch aborted: headless or remote environment without graphical display capability", {
        platform: process.platform,
        displayStatus,
      });
      throw new AgentError(
        `Graphical browser display unavailable: Remote server or headless deployment environment detected without a display server ($DISPLAY / $WAYLAND_DISPLAY is missing). The application requires an environment capable of displaying a visible browser window and does not simulate visible execution. Configure a virtual display (e.g., Xvfb) or run in a desktop environment.`,
        ErrorCode.BROWSER_LAUNCH_FAILED,
        false,
        { displayType: displayStatus.displayType }
      );
    }

    const config = getConfig();
    logger.info("Initializing Playwright Chromium instance in VISIBLE mode (headless: false)...");

    try {
      // CENTRAL ENFORCEMENT: headless: false is directly hardcoded.
      // Launch value is never derived from caller settings, request bodies, env vars, or stale config.
      this.browser = await chromium.launch({
        headless: false,
        slowMo: config.BROWSER_SLOW_MO,
      });
    } catch (launchErr: unknown) {
      const errMessage = launchErr instanceof Error ? launchErr.message : String(launchErr);
      logger.error("Failed to launch visible Chromium browser instance:", { error: errMessage });
      throw new AgentError(
        `Failed to launch visible browser window: ${errMessage}. Ensure a graphical display environment is available.`,
        ErrorCode.BROWSER_LAUNCH_FAILED,
        false
      );
    }

    this.browser.on("disconnected", () => {
      logger.info("Chromium instance disconnected. Resetting all task sessions.");
      this.sessions.clear();
      this.activeTaskId = null;
      this.browser = null;
    });

    return this.browser;
  }

  /**
   * Legacy compatibility method: ensures browser instance and returns the active or default context.
   */
  async ensureBrowser(_options?: { headless?: boolean }): Promise<BrowserContext> {
    await this.ensureBrowserInstance();
    if (this.activeTaskId && this.sessions.has(this.activeTaskId)) {
      const activeSession = this.sessions.get(this.activeTaskId)!;
      if (activeSession.windowOpen) {
        return activeSession.context;
      }
    }
    const defaultSession = await this.createTaskSession(this.activeTaskId || "task-default");
    return defaultSession.context;
  }

  /**
   * Creates an isolated visible browser context and window for a new task.
   * Enforces:
   * 1. Brand new visible Chromium window for this task.
   * 2. Isolated BrowserContext (no cookie/storage/navigation leakage between tasks).
   * 3. Retains previous completed windows for user inspection (up to maxRetainedCompletedSessions).
   */
  async createTaskSession(taskId: string, _options?: { headless?: boolean }): Promise<TaskBrowserSession> {
    if (_options?.headless !== undefined) {
      logger.warn(`createTaskSession(${taskId}): headless option is obsolete and ignored. Visible browser is enforced.`);
    }
    // 1. Prune abandoned completed sessions if exceeding retention limit
    await this.pruneCompletedSessions(this.maxRetainedCompletedSessions);

    // 2. Ensure Chromium is running (visible)
    const browser = await this.ensureBrowserInstance();

    const config = getConfig();
    const context = await browser.newContext({
      viewport: {
        width: config.VIEWPORT_WIDTH,
        height: config.VIEWPORT_HEIGHT,
      },
      acceptDownloads: true,
    });

    // 3. Create fresh initial visible page for this task
    let page: Page;
    try {
      page = await context.newPage();
    } catch (pageErr: unknown) {
      await context.close().catch(() => {});
      const message = pageErr instanceof Error ? pageErr.message : String(pageErr);
      throw new AgentError(
        `Failed to open visible page for task ${taskId}: ${message}`,
        ErrorCode.BROWSER_LAUNCH_FAILED,
        false
      );
    }

    const session: TaskBrowserSession = {
      taskId,
      context,
      page,
      tabId: "",
      tabs: new Map(),
      activeTabId: null,
      createdAt: Date.now(),
      status: "active",
      windowOpen: true,
    };

    // 4. Register initial page and context popup handlers
    const initialTabId = this.registerPageForSession(session, page);
    session.tabId = initialTabId;

    context.on("page", (newPage) => {
      this.registerPageForSession(session, newPage);
    });

    this.sessions.set(taskId, session);
    this.activeTaskId = taskId;

    logger.info(`Created isolated visible browser session for task ${taskId} (window open: true)`);
    return session;
  }

  private registerPageForSession(session: TaskBrowserSession, page: Page): string {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tab: BrowserTab = {
      id: tabId,
      url: page.url() || "about:blank",
      title: "New Tab",
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    // Deactivate previous active tab
    if (session.activeTabId && session.tabs.has(session.activeTabId)) {
      session.tabs.get(session.activeTabId)!.tab.isActive = false;
    }

    session.tabs.set(tabId, { page, tab });
    session.activeTabId = tabId;

    page.on("load", async () => {
      tab.url = page.url();
      tab.title = await page.title().catch(() => "");
    });

    page.on("close", () => {
      session.tabs.delete(tabId);
      if (session.activeTabId === tabId) {
        const remaining = Array.from(session.tabs.keys());
        session.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        if (session.activeTabId) {
          session.tabs.get(session.activeTabId)!.tab.isActive = true;
        }
      }
      if (session.tabs.size === 0) {
        session.windowOpen = false;
        logger.info(`All tabs closed for task ${session.taskId}. Window marked closed.`);
      }
    });

    page.on("crash", () => {
      logger.error(`Playwright page crashed unexpectedly in task ${session.taskId}: tab ${tabId}`);
      session.tabs.delete(tabId);
      if (session.activeTabId === tabId) {
        const remaining = Array.from(session.tabs.keys());
        session.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        if (session.activeTabId && session.tabs.has(session.activeTabId)) {
          session.tabs.get(session.activeTabId)!.tab.isActive = true;
        }
      }
      if (session.tabs.size === 0) {
        session.windowOpen = false;
      }
    });

    page.on("download", async (download: Download) => {
      try {
        const rawFilename = download.suggestedFilename();
        const baseFilename = path.basename(rawFilename).replace(/[^a-zA-Z0-9_.-]/g, "_");
        const lowerFilename = baseFilename.toLowerCase();

        const dangerousExts = [".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".dll", ".vbs", ".scr", ".pif"];
        if (dangerousExts.some((ext) => lowerFilename.endsWith(ext))) {
          logger.error(`Security alert: Blocked download of dangerous executable: '${baseFilename}'`);
          await download.cancel().catch(() => {});
          return;
        }

        const safeFilename = `${Date.now()}-${baseFilename || "download"}`;
        const safePath = path.resolve(this.downloadDir, safeFilename);

        if (!safePath.startsWith(path.resolve(this.downloadDir))) {
          throw new Error("Path traversal attempt detected in download filename");
        }

        await download.saveAs(safePath);
        const stats = fs.statSync(safePath);

        if (stats.size > this.maxDownloadSizeBytes) {
          fs.unlinkSync(safePath);
          logger.error(`Security alert: Download exceeded size limit (${stats.size} > ${this.maxDownloadSizeBytes} bytes). Deleted file: ${safeFilename}`);
          return;
        }

        const artifact: DownloadedArtifact = {
          id: `dl-${Date.now()}`,
          originalFilename: baseFilename || rawFilename,
          savedPath: safePath,
          fileSizeBytes: stats.size,
          downloadTime: new Date().toISOString(),
          verified: stats.size > 0 && fs.existsSync(safePath),
        };

        this.downloads.push(artifact);
        logger.info(`Download saved for task ${session.taskId}: ${artifact.originalFilename} (${stats.size} bytes)`);
      } catch (err) {
        logger.error("Failed to save downloaded artifact:", { error: String(err) });
      }
    });

    return tabId;
  }

  /**
   * Retrieves an active or existing task browser session.
   */
  getTaskSession(taskId: string): TaskBrowserSession | undefined {
    return this.sessions.get(taskId);
  }

  /**
   * Marks a task session as completed or failed, keeping its visible window open for user inspection.
   * If cancelled, window is closed immediately.
   */
  completeTaskSession(taskId: string, outcome: "completed" | "failed" | "cancelled" | "blocked" = "completed"): void {
    const session = this.sessions.get(taskId);
    if (!session) return;

    session.status = outcome;

    if (outcome === "cancelled") {
      session.windowOpen = false;
      session.context.close().catch(() => {});
      logger.info(`Task ${taskId} cancelled. Closed visible browser window.`);
    } else {
      session.windowOpen = !session.page.isClosed();
      logger.info(
        `Task ${taskId} finished with status '${outcome}'. Keeping visible browser window OPEN for user inspection.`
      );
    }

    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
    }
  }

  /**
   * Closes a specific task's browser context and window.
   * Safe: only affects the specified task and does NOT touch other active/completed task windows.
   */
  async closeTaskSession(taskId: string): Promise<boolean> {
    const session = this.sessions.get(taskId);
    if (!session) return false;

    session.windowOpen = false;
    session.status = "closed";
    await session.context.close().catch(() => {});
    this.sessions.delete(taskId);

    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
    }
    logger.info(`Closed visible browser window for task ${taskId}`);
    return true;
  }

  /**
   * Checks whether the visible window for a task is currently open.
   */
  isWindowOpen(taskId: string): boolean {
    const session = this.sessions.get(taskId);
    if (!session) return false;
    return session.windowOpen && !session.page.isClosed();
  }

  /**
   * Gets active page for a task session (or current active task).
   */
  async getActivePage(taskId?: string): Promise<{ page: Page; tabId: string }> {
    const targetTaskId = taskId || this.activeTaskId;
    let session = targetTaskId ? this.sessions.get(targetTaskId) : undefined;

    if (!session || !session.windowOpen || session.page.isClosed()) {
      session = await this.createTaskSession(targetTaskId || "task-default");
    }

    // Prune closed tabs
    for (const [id, item] of Array.from(session.tabs.entries())) {
      if (item.page.isClosed()) {
        session.tabs.delete(id);
      }
    }

    if (!session.activeTabId || !session.tabs.has(session.activeTabId)) {
      const remainingIds = Array.from(session.tabs.keys());
      if (remainingIds.length > 0) {
        session.activeTabId = remainingIds[remainingIds.length - 1];
        const item = session.tabs.get(session.activeTabId)!;
        if (!item.page.isClosed()) {
          item.tab.isActive = true;
          return { page: item.page, tabId: session.activeTabId };
        }
      }
      const newPage = await session.context.newPage();
      const tabId = this.registerPageForSession(session, newPage);
      return { page: newPage, tabId };
    }

    const item = session.tabs.get(session.activeTabId)!;
    if (item.page.isClosed()) {
      session.tabs.delete(session.activeTabId);
      const newPage = await session.context.newPage();
      const tabId = this.registerPageForSession(session, newPage);
      return { page: newPage, tabId };
    }

    return { page: item.page, tabId: session.activeTabId };
  }

  async switchTab(tabId: string, taskId?: string): Promise<boolean> {
    const targetTaskId = taskId || this.activeTaskId;
    const session = targetTaskId ? this.sessions.get(targetTaskId) : undefined;
    if (!session || !session.tabs.has(tabId)) return false;

    if (session.activeTabId && session.tabs.has(session.activeTabId)) {
      session.tabs.get(session.activeTabId)!.tab.isActive = false;
    }
    session.activeTabId = tabId;
    const item = session.tabs.get(tabId)!;
    item.tab.isActive = true;
    await item.page.bringToFront();
    return true;
  }

  async openNewTab(url?: string, taskId?: string): Promise<{ tabId: string; page: Page }> {
    const targetTaskId = taskId || this.activeTaskId;
    let session = targetTaskId ? this.sessions.get(targetTaskId) : undefined;
    if (!session) {
      session = await this.createTaskSession(targetTaskId || "task-default");
    }

    const newPage = await session.context.newPage();
    const tabId = this.registerPageForSession(session, newPage);
    if (url) {
      await newPage.goto(url, { waitUntil: "domcontentloaded" });
    }
    return { tabId, page: newPage };
  }

  async closeTab(tabId: string, taskId?: string): Promise<boolean> {
    const targetTaskId = taskId || this.activeTaskId;
    const session = targetTaskId ? this.sessions.get(targetTaskId) : undefined;
    if (!session || !session.tabs.has(tabId)) return false;

    const item = session.tabs.get(tabId)!;
    await item.page.close().catch(() => {});
    return true;
  }

  getTabs(taskId?: string): BrowserTab[] {
    const targetTaskId = taskId || this.activeTaskId;
    const session = targetTaskId ? this.sessions.get(targetTaskId) : undefined;
    if (session) {
      return Array.from(session.tabs.values()).map((v) => ({ ...v.tab }));
    }
    // Return all tabs across sessions if no specific task
    const allTabs: BrowserTab[] = [];
    for (const s of Array.from(this.sessions.values())) {
      allTabs.push(...Array.from(s.tabs.values()).map((v) => ({ ...v.tab })));
    }
    return allTabs;
  }

  getDownloads(): DownloadedArtifact[] {
    return [...this.downloads];
  }

  clearDownloads(): void {
    this.downloads = [];
  }

  /**
   * Resets session cookies/storage for a task without affecting other tasks.
   */
  async clearSessionData(taskId?: string): Promise<void> {
    try {
      this.downloads = [];
      const targetTaskId = taskId || this.activeTaskId;
      const session = targetTaskId ? this.sessions.get(targetTaskId) : undefined;
      if (session?.context) {
        await session.context.clearCookies().catch(() => {});
        const tabEntries = Array.from(session.tabs.entries());
        for (let i = 1; i < tabEntries.length; i++) {
          const [id, item] = tabEntries[i];
          await item.page.close().catch(() => {});
          session.tabs.delete(id);
        }
      }
    } catch (err) {
      logger.warn("Non-fatal error clearing browser session data:", { error: String(err) });
    }
  }

  async resetTaskSession(taskId?: string): Promise<{ page: Page; tabId: string }> {
    await this.clearSessionData(taskId);
    return this.getActivePage(taskId);
  }

  cleanupArtifacts(maxAgeMs = 3600000): number {
    let deletedCount = 0;
    try {
      if (!fs.existsSync(this.downloadDir)) return 0;
      const now = Date.now();
      const files = fs.readdirSync(this.downloadDir);
      for (const file of files) {
        const fullPath = path.join(this.downloadDir, file);
        const stats = fs.statSync(fullPath);
        if (maxAgeMs <= 0 || (now - stats.mtimeMs) >= maxAgeMs) {
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      }
    } catch (err) {
      logger.warn("Error cleaning up artifacts:", { error: String(err) });
    }
    return deletedCount;
  }

  /**
   * Prunes oldest completed/closed task sessions to manage resource consumption.
   * Never closes an active task's window.
   */
  async pruneCompletedSessions(maxRetained = 5): Promise<number> {
    const completed = Array.from(this.sessions.values())
      .filter((s) => s.status !== "active" && s.taskId !== this.activeTaskId)
      .sort((a, b) => a.createdAt - b.createdAt);

    let prunedCount = 0;
    while (completed.length > maxRetained) {
      const oldest = completed.shift()!;
      await oldest.context.close().catch(() => {});
      this.sessions.delete(oldest.taskId);
      prunedCount++;
      logger.info(`Pruned completed visible browser window for task ${oldest.taskId} (retention limit: ${maxRetained})`);
    }
    return prunedCount;
  }

  getSession(taskId?: string): TaskBrowserSession | undefined {
    const targetTaskId = taskId || this.activeTaskId;
    return targetTaskId ? this.sessions.get(targetTaskId) : undefined;
  }

  getAllSessions(): TaskBrowserSession[] {
    return Array.from(this.sessions.values());
  }

  isBrowserLaunched(): boolean {
    return Boolean(this.browser && this.browser.isConnected());
  }

  getActiveSessionsCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.status === "active").length;
  }

  getOpenWindowsCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.windowOpen).length;
  }

  /**
   * Cleanly closes all sessions and the underlying browser.
   */
  async close(): Promise<void> {
    try {
      for (const [taskId, session] of Array.from(this.sessions.entries())) {
        await session.context.close().catch(() => {});
      }
      this.sessions.clear();
      this.activeTaskId = null;
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      logger.info("All browser sessions and Playwright Chromium cleanly closed.");
    } catch (err) {
      logger.error("Error closing browser manager:", { error: String(err) });
    }
  }
}

export const browserManager = BrowserManager.getInstance();
