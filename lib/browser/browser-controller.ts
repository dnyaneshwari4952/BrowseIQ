import { Page, BrowserContext, Browser, chromium } from "playwright";
import { getConfig } from "../config";
import { BrowserTab, PageObservation } from "../types/browser";
import { AgentError, ErrorCode } from "../types/errors";
import { logger } from "../observability/logger";
import { validateUrlString } from "../validation/url-policy";
import { PageObserver } from "./page-observer";
import { BrowserManager } from "./browser-manager";

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: "load" | "domcontentloaded" | "commit";
  referer?: string;
}

export interface NavigationResult {
  initialUrl: string;
  finalUrl: string;
  status: number;
  redirected: boolean;
  title: string;
  durationMs: number;
}

export interface WaitCondition {
  urlChange?: boolean;
  expectedUrlPattern?: string;
  elementAppears?: string;
  elementDisappears?: string;
  textContains?: string;
  domSettled?: boolean;
}

export interface BrowserDiagnostics {
  timestamp: string;
  url: string;
  title: string;
  tabCount: number;
  activeTabId: string;
  consoleErrors: string[];
  screenshotBase64?: string;
  reason?: string;
}

/**
 * Production-grade Playwright Browser Controller (Phase 1, Section 4).
 * Provides a clean, reusable, typed interface for browser lifecycle,
 * navigation, history, tab management, dynamic readiness, and diagnostics.
 */
export class BrowserController {
  private static instance: BrowserController | null = null;
  private manager: BrowserManager;
  private consoleErrors: string[] = [];
  private isLiveMode = true;

  constructor(manager?: BrowserManager) {
    this.manager = manager || BrowserManager.getInstance();
  }

  static getInstance(): BrowserController {
    if (!BrowserController.instance) {
      BrowserController.instance = new BrowserController();
    }
    return BrowserController.instance;
  }

  setLiveMode(live: boolean): void {
    this.isLiveMode = live;
  }

  isLive(): boolean {
    return this.isLiveMode;
  }

  /**
   * Launch the browser and ensure a healthy visible context.
   * Headless execution is strictly disabled: any caller-supplied headless option is ignored.
   */
  async launch(_options?: { headless?: boolean; slowMo?: number }): Promise<BrowserContext> {
    if (_options?.headless !== undefined) {
      logger.warn("BrowserController.launch: headless option is obsolete and ignored. Visible browser is enforced.");
    }
    const context = await this.manager.ensureBrowser();
    this.attachConsoleListener(context);
    return context;
  }

  /**
   * Controlled browser shutdown and resource release.
   */
  async shutdown(): Promise<void> {
    this.consoleErrors = [];
    await this.manager.close();
  }

  /**
   * Get the active Playwright page and its registered tab ID.
   */
  async getActivePage(): Promise<{ page: Page; tabId: string }> {
    const active = await this.manager.getActivePage();
    if (active.page.isClosed()) {
      throw new AgentError(
        "Active browser page is unexpectedly closed.",
        ErrorCode.BROWSER_CRASH,
        false
      );
    }
    return active;
  }

  /**
   * Open and navigate to a user-requested URL.
   * Handles terminal HTTP 404, server 500, redirects, and context-appropriate readiness.
   */
  async navigate(url: string, options?: NavigationOptions): Promise<NavigationResult> {
    validateUrlString(url, "BrowserController.navigate");

    const { page } = await this.getActivePage();
    const config = getConfig();
    const timeout = options?.timeout ?? config.NAVIGATION_TIMEOUT;
    const waitUntil = options?.waitUntil ?? "domcontentloaded";
    const startMs = Date.now();
    const initialUrl = page.url();

    let status = 200;
    let finalUrl = url;
    let redirected = false;

    try {
      const response = await page.goto(url, {
        timeout,
        waitUntil,
        referer: options?.referer,
      });

      if (response) {
        status = response.status();
        finalUrl = response.url();
        redirected = response.request().redirectedFrom() !== null;

        // Terminal HTTP Status discrimination (Section 4 & Step 3)
        if (status === 404) {
          throw new AgentError(
            `Navigation to ${url} resulted in terminal HTTP 404 Not Found at ${finalUrl}`,
            ErrorCode.NAVIGATION_FAILED,
            false,
            { url, finalUrl, status }
          );
        }

        if (status >= 500) {
          throw new AgentError(
            `Navigation to ${url} encountered HTTP ${status} Server Error at ${finalUrl}`,
            ErrorCode.NETWORK_ERROR,
            true,
            { url, finalUrl, status }
          );
        }
      } else {
        // In-page navigation or client-side hash change
        finalUrl = page.url();
      }

      // Context-appropriate readiness wait (avoids indefinite networkidle)
      await this.waitForPageReadiness(page, timeout);

      const title = await page.title().catch(() => "");
      return {
        initialUrl,
        finalUrl,
        status,
        redirected,
        title,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      if (err instanceof AgentError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("closed") || message.includes("Target page, context or browser has been closed")) {
        throw new AgentError(
          `Page was unexpectedly closed during navigation to ${url}`,
          ErrorCode.BROWSER_CRASH,
          false,
          { url }
        );
      }
      if (message.includes("Timeout")) {
        throw new AgentError(
          `Navigation to ${url} timed out after ${timeout}ms`,
          ErrorCode.TIMEOUT,
          true,
          { url, timeout }
        );
      }
      throw new AgentError(
        `Failed to navigate to ${url}: ${message}`,
        ErrorCode.NAVIGATION_FAILED,
        true,
        { url, message }
      );
    }
  }

  /**
   * Browser history back operation with readiness wait.
   */
  async back(options?: { timeout?: number }): Promise<NavigationResult> {
    const { page } = await this.getActivePage();
    const config = getConfig();
    const timeout = options?.timeout ?? config.NAVIGATION_TIMEOUT;
    const initialUrl = page.url();
    const startMs = Date.now();

    try {
      const response = await page.goBack({ timeout, waitUntil: "domcontentloaded" });
      await this.waitForPageReadiness(page, timeout);

      const finalUrl = page.url();
      const status = response ? response.status() : 200;
      const title = await page.title().catch(() => "");

      return {
        initialUrl,
        finalUrl,
        status,
        redirected: false,
        title,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AgentError(
        `Browser back navigation failed: ${message}`,
        ErrorCode.NAVIGATION_FAILED,
        true,
        { initialUrl, message }
      );
    }
  }

  /**
   * Browser history forward operation with readiness wait.
   */
  async forward(options?: { timeout?: number }): Promise<NavigationResult> {
    const { page } = await this.getActivePage();
    const config = getConfig();
    const timeout = options?.timeout ?? config.NAVIGATION_TIMEOUT;
    const initialUrl = page.url();
    const startMs = Date.now();

    try {
      const response = await page.goForward({ timeout, waitUntil: "domcontentloaded" });
      await this.waitForPageReadiness(page, timeout);

      const finalUrl = page.url();
      const status = response ? response.status() : 200;
      const title = await page.title().catch(() => "");

      return {
        initialUrl,
        finalUrl,
        status,
        redirected: false,
        title,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AgentError(
        `Browser forward navigation failed: ${message}`,
        ErrorCode.NAVIGATION_FAILED,
        true,
        { initialUrl, message }
      );
    }
  }

  /**
   * Browser page reload operation with readiness wait.
   */
  async reload(options?: { timeout?: number }): Promise<NavigationResult> {
    const { page } = await this.getActivePage();
    const config = getConfig();
    const timeout = options?.timeout ?? config.NAVIGATION_TIMEOUT;
    const initialUrl = page.url();
    const startMs = Date.now();

    try {
      const response = await page.reload({ timeout, waitUntil: "domcontentloaded" });
      await this.waitForPageReadiness(page, timeout);

      const finalUrl = page.url();
      const status = response ? response.status() : 200;
      const title = await page.title().catch(() => "");

      return {
        initialUrl,
        finalUrl,
        status,
        redirected: false,
        title,
        durationMs: Date.now() - startMs,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AgentError(
        `Browser reload failed: ${message}`,
        ErrorCode.NAVIGATION_FAILED,
        true,
        { initialUrl, message }
      );
    }
  }

  /**
   * Create a new tab and optionally navigate to URL.
   */
  async createTab(url?: string): Promise<{ tabId: string; page: Page }> {
    if (url) {
      validateUrlString(url, "BrowserController.createTab");
    }
    return this.manager.openNewTab(url);
  }

  /**
   * List all currently registered browser tabs.
   */
  listTabs(): BrowserTab[] {
    return this.manager.getTabs();
  }

  /**
   * Select and bring a tab to the front.
   */
  async selectTab(tabId: string): Promise<boolean> {
    return this.manager.switchTab(tabId);
  }

  /**
   * Close a specific tab.
   */
  async closeTab(tabId: string): Promise<boolean> {
    return this.manager.closeTab(tabId);
  }

  /**
   * Get the current active URL.
   */
  async getCurrentUrl(): Promise<string> {
    const { page } = await this.getActivePage();
    return page.url();
  }

  /**
   * Get the current page title.
   */
  async getPageTitle(): Promise<string> {
    const { page } = await this.getActivePage();
    return page.title().catch(() => "");
  }

  /**
   * Inspect page: extracts accessible roles, text, form controls, headings, DOM structure.
   */
  async inspectPage(): Promise<PageObservation> {
    const { page, tabId } = await this.getActivePage();
    return PageObserver.observe(page, tabId);
  }

  /**
   * Waits for an observable browser condition without relying on arbitrary fixed sleeps.
   */
  async waitForCondition(condition: WaitCondition, options?: { timeout?: number }): Promise<boolean> {
    const { page } = await this.getActivePage();
    const config = getConfig();
    const timeout = options?.timeout ?? config.ELEMENT_TIMEOUT;

    try {
      if (condition.urlChange) {
        const initialUrl = page.url();
        await page.waitForFunction((orig) => window.location.href !== orig, initialUrl, { timeout });
        return true;
      }

      if (condition.expectedUrlPattern) {
        const pattern = condition.expectedUrlPattern;
        await page.waitForURL((u) => u.toString().includes(pattern), { timeout });
        return true;
      }

      if (condition.elementAppears) {
        const sel = condition.elementAppears;
        if (sel.startsWith("#") || sel.startsWith(".") || sel.startsWith("[")) {
          await page.waitForSelector(sel, { state: "visible", timeout });
        } else {
          await page.waitForFunction(
            (text) => document.body.innerText.toLowerCase().includes(text.toLowerCase()),
            sel,
            { timeout }
          );
        }
        return true;
      }

      if (condition.elementDisappears) {
        const sel = condition.elementDisappears;
        await page.waitForSelector(sel, { state: "hidden", timeout });
        return true;
      }

      if (condition.textContains) {
        const text = condition.textContains.toLowerCase();
        await page.waitForFunction(
          (t) => document.body.innerText.toLowerCase().includes(t),
          text,
          { timeout }
        );
        return true;
      }

      if (condition.domSettled) {
        await this.waitForDomSettle(page, timeout);
        return true;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Captures a screenshot as base64 string.
   */
  async takeScreenshot(options?: { fullPage?: boolean }): Promise<string> {
    const { page } = await this.getActivePage();
    const buffer = await page.screenshot({ fullPage: options?.fullPage ?? false });
    return `data:image/png;base64,${buffer.toString("base64")}`;
  }

  /**
   * Collects diagnostic evidence on task failure or verification.
   */
  async collectDiagnostics(reason?: string): Promise<BrowserDiagnostics> {
    try {
      const { page, tabId } = await this.getActivePage();
      const url = page.url();
      const title = await page.title().catch(() => "");
      const tabCount = this.manager.getTabs().length;
      const screenshotBase64 = await this.takeScreenshot({ fullPage: false }).catch(() => undefined);

      return {
        timestamp: new Date().toISOString(),
        url,
        title,
        tabCount,
        activeTabId: tabId,
        consoleErrors: [...this.consoleErrors],
        screenshotBase64,
        reason,
      };
    } catch {
      return {
        timestamp: new Date().toISOString(),
        url: "unavailable",
        title: "Browser Unavailable",
        tabCount: 0,
        activeTabId: "none",
        consoleErrors: [...this.consoleErrors],
        reason: reason || "Browser error during diagnostic collection",
      };
    }
  }

  /**
   * Context-appropriate readiness condition.
   * Avoids networkidle, ensuring streaming or long-polling pages don't hang indefinitely.
   */
  private async waitForPageReadiness(page: Page, timeoutMs: number): Promise<void> {
    try {
      // 1. Wait for document readiness state
      await page.waitForFunction(
        () => document.readyState === "interactive" || document.readyState === "complete",
        { timeout: Math.min(5000, timeoutMs) }
      ).catch(() => {});

      // 2. Microtask settle: brief DOM mutation observer
      await this.waitForDomSettle(page, 1500);
    } catch {
      // Non-fatal readiness settle
    }
  }

  /**
   * Microtask DOM settle: waits until DOM mutations pause for 100ms.
   */
  private async waitForDomSettle(page: Page, maxWaitMs = 1500): Promise<void> {
    await page.evaluate(
      (maxWait) =>
        new Promise<void>((resolve) => {
          let timer: any = null;
          const observer = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve();
            }, 100);
          });

          observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
          });

          // Fallback timeout to ensure resolve
          setTimeout(() => {
            observer.disconnect();
            resolve();
          }, maxWait);
        }),
      maxWaitMs
    ).catch(() => {});
  }

  /**
   * Attaches console listeners to capture browser errors for diagnostics without logging secrets.
   */
  private attachConsoleListener(context: BrowserContext): void {
    context.on("page", (page) => {
      page.on("pageerror", (err) => {
        const msg = String(err.message || err);
        this.consoleErrors.push(msg.slice(0, 200));
        if (this.consoleErrors.length > 20) {
          this.consoleErrors.shift();
        }
      });
    });
  }

  /**
   * Resets browser session isolation between tasks.
   */
  async resetTaskSession(): Promise<{ page: Page; tabId: string }> {
    this.consoleErrors = [];
    return this.manager.resetTaskSession();
  }
}

export const browserController = BrowserController.getInstance();
