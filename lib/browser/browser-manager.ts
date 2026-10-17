import { chromium, Browser, BrowserContext, Page, Download } from "playwright";
import path from "path";
import fs from "fs";
import { getConfig } from "../config";
import { BrowserTab } from "../types/browser";
import { DownloadedArtifact } from "../types/results";
import { logger } from "../observability/logger";

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private tabs: Map<string, { page: Page; tab: BrowserTab }> = new Map();
  private activeTabId: string | null = null;
  private downloads: DownloadedArtifact[] = [];
  private downloadDir: string;

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

  async ensureBrowser(): Promise<BrowserContext> {
    if (this.context && this.browser?.isConnected()) {
      return this.context;
    }

    const config = getConfig();
    logger.info("Initializing Playwright Chromium instance...", { headless: config.BROWSER_HEADLESS });

    this.browser = await chromium.launch({
      headless: config.BROWSER_HEADLESS,
      slowMo: config.BROWSER_SLOW_MO,
    });

    this.context = await this.browser.newContext({
      viewport: {
        width: config.VIEWPORT_WIDTH,
        height: config.VIEWPORT_HEIGHT,
      },
      acceptDownloads: true,
    });

    // Handle new tabs opened automatically (e.g. target="_blank")
    this.context.on("page", (newPage) => {
      this.registerPage(newPage);
    });

    // Create initial page if none
    const initialPage = await this.context.newPage();
    this.registerPage(initialPage);

    return this.context;
  }

  private registerPage(page: Page): string {
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tab: BrowserTab = {
      id: tabId,
      url: page.url() || "about:blank",
      title: "New Tab",
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    // Deactivate previous active tab
    if (this.activeTabId && this.tabs.has(this.activeTabId)) {
      this.tabs.get(this.activeTabId)!.tab.isActive = false;
    }

    this.tabs.set(tabId, { page, tab });
    this.activeTabId = tabId;

    // Track tab URL and Title changes
    page.on("load", async () => {
      tab.url = page.url();
      tab.title = await page.title().catch(() => "");
    });

    // Track tab close
    page.on("close", () => {
      this.tabs.delete(tabId);
      if (this.activeTabId === tabId) {
        const remaining = Array.from(this.tabs.keys());
        this.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        if (this.activeTabId) {
          this.tabs.get(this.activeTabId)!.tab.isActive = true;
        }
      }
    });

    // Track downloads
    page.on("download", async (download: Download) => {
      try {
        const originalFilename = download.suggestedFilename();
        const safePath = path.join(this.downloadDir, `${Date.now()}-${originalFilename}`);
        await download.saveAs(safePath);
        const stats = fs.statSync(safePath);

        const artifact: DownloadedArtifact = {
          id: `dl-${Date.now()}`,
          originalFilename,
          savedPath: safePath,
          fileSizeBytes: stats.size,
          downloadTime: new Date().toISOString(),
          verified: stats.size > 0,
        };

        this.downloads.push(artifact);
        logger.info(`Download saved: ${originalFilename} (${stats.size} bytes)`);
      } catch (err) {
        logger.error("Failed to save downloaded artifact:", { error: String(err) });
      }
    });

    return tabId;
  }

  async getActivePage(): Promise<{ page: Page; tabId: string }> {
    await this.ensureBrowser();
    if (!this.activeTabId || !this.tabs.has(this.activeTabId)) {
      const newPage = await this.context!.newPage();
      const tabId = this.registerPage(newPage);
      return { page: newPage, tabId };
    }
    const item = this.tabs.get(this.activeTabId)!;
    return { page: item.page, tabId: this.activeTabId };
  }

  async switchTab(tabId: string): Promise<boolean> {
    if (!this.tabs.has(tabId)) return false;
    if (this.activeTabId && this.tabs.has(this.activeTabId)) {
      this.tabs.get(this.activeTabId)!.tab.isActive = false;
    }
    this.activeTabId = tabId;
    const item = this.tabs.get(tabId)!;
    item.tab.isActive = true;
    await item.page.bringToFront();
    return true;
  }

  async openNewTab(url?: string): Promise<{ tabId: string; page: Page }> {
    await this.ensureBrowser();
    const newPage = await this.context!.newPage();
    const tabId = this.registerPage(newPage);
    if (url) {
      await newPage.goto(url, { waitUntil: "domcontentloaded" });
    }
    return { tabId, page: newPage };
  }

  async closeTab(tabId: string): Promise<boolean> {
    if (!this.tabs.has(tabId)) return false;
    const item = this.tabs.get(tabId)!;
    await item.page.close().catch(() => {});
    return true;
  }

  getTabs(): BrowserTab[] {
    return Array.from(this.tabs.values()).map((v) => ({ ...v.tab }));
  }

  getDownloads(): DownloadedArtifact[] {
    return [...this.downloads];
  }

  async close(): Promise<void> {
    try {
      this.tabs.clear();
      this.activeTabId = null;
      if (this.context) {
        await this.context.close().catch(() => {});
        this.context = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
      logger.info("Browser instance cleanly closed.");
    } catch (err) {
      logger.error("Error closing browser manager:", { error: String(err) });
    }
  }
}

export const browserManager = BrowserManager.getInstance();
