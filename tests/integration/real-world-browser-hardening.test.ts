import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import path from "path";
import fs from "fs";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { PageObserver } from "@/lib/browser/page-observer";
import { ChallengeDetector } from "@/lib/browser/challenge-detector";
import { LocalFileResolver } from "@/lib/local/local-file-resolver";
import { validateUrlString } from "@/lib/validation/url-policy";
import { Action, ActionType, ActionStatus, LocatorStrategy, RiskLevel } from "@/lib/types/actions";

describe("Real-World Browser Automation Reliability & Hardening Suite", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
  });

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });

  // =========================================================================
  // 1. Dynamic Content & Async State Transitions
  // =========================================================================
  it("1. Dynamic Content: waits for asynchronously rendered content without brittle sleeps", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Dynamic Content Test</title></head>
        <body>
          <h1>Async Catalog</h1>
          <div id="container">
            <span id="loading">Loading items...</span>
          </div>
          <script>
            setTimeout(() => {
              const c = document.getElementById('container');
              c.innerHTML = '<div class="product-item" id="item-99"><h3>Dynamic Ultra Laptop</h3><span class="price">₹85,000</span></div>';
            }, 600);
          </script>
        </body>
      </html>
    `);

    const waitAction: Action = {
      id: "wait-dynamic",
      type: ActionType.WAIT,
      reason: "Wait for dynamic promotion card to render",
      risk: RiskLevel.LOW,
      expectedState: { elementAppears: "#item-99" },
      timeout: 5000,
    };

    const waitRes = await ActionExecutor.execute({
      action: waitAction,
      page,
      tabId: "tab-dynamic",
    });

    expect(waitRes.result.status).toBe(ActionStatus.COMPLETED);

    const extractAction: Action = {
      id: "extract-title",
      type: ActionType.EXTRACT_TEXT,
      reason: "Extract headline from loaded dynamic card",
      risk: RiskLevel.LOW,
      target: { strategy: LocatorStrategy.CSS, value: "#item-99 h3" },
    };

    const extractRes = await ActionExecutor.execute({
      action: extractAction,
      page,
      tabId: "tab-dynamic",
    });

    expect(extractRes.result.status).toBe(ActionStatus.COMPLETED);
    expect(extractRes.result.extractedData).toBe("Dynamic Ultra Laptop");
  });

  // =========================================================================
  // 2. Infinite Scrolling
  // =========================================================================
  it("2. Infinite Scrolling: scrolling triggers dynamic content hydration and item discovery", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Infinite Scroll Feed</title></head>
        <body style="height: 3000px; padding: 20px;">
          <h1>Feed</h1>
          <div id="feed">
            <div class="feed-item" id="post-1">Post 1</div>
            <div class="feed-item" id="post-2">Post 2</div>
          </div>
          <script>
            window.addEventListener('scroll', () => {
              if (window.scrollY > 200 && !document.getElementById('post-3')) {
                const f = document.getElementById('feed');
                const p3 = document.createElement('div');
                p3.className = 'feed-item';
                p3.id = 'post-3';
                p3.innerText = 'Post 3 (Loaded on Scroll)';
                f.appendChild(p3);
              }
            });
          </script>
        </body>
      </html>
    `);

    const initialObs = await PageObserver.observe(page, "tab-scroll");
    expect(initialObs.summary).toContain("Feed");

    const scrollAction: Action = {
      id: "scroll-feed",
      type: ActionType.SCROLL,
      reason: "Scroll down to trigger lazy loading of additional feed items",
      value: 500,
      risk: RiskLevel.LOW,
    };

    const scrollRes = await ActionExecutor.execute({
      action: scrollAction,
      page,
      tabId: "tab-scroll",
    });

    expect(scrollRes.result.status).toBe(ActionStatus.COMPLETED);

    const post3 = page.locator("#post-3");
    await post3.waitFor({ state: "visible", timeout: 3000 });
    const text = await post3.innerText();
    expect(text).toBe("Post 3 (Loaded on Scroll)");
  });

  // =========================================================================
  // 3. Pagination
  // =========================================================================
  it("3. Pagination: navigates pages and verifies updated items and active page indicator", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Pagination Page</title></head>
        <body>
          <h2 id="page-indicator">Page 1 of 3</h2>
          <ul id="items-list">
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
          <button id="next-page" onclick="nextPage()">Next Page &gt;</button>
          <script>
            function nextPage() {
              document.getElementById('page-indicator').innerText = 'Page 2 of 3';
              document.getElementById('items-list').innerHTML = '<li>Item 3</li><li>Item 4</li>';
            }
          </script>
        </body>
      </html>
    `);

    const clickAction: Action = {
      id: "click-next",
      type: ActionType.CLICK,
      reason: "Advance to page 2 via next page button",
      risk: RiskLevel.LOW,
      target: { strategy: LocatorStrategy.ID, value: "next-page" },
      expectedState: { textContains: "Page 2" },
    };

    const clickRes = await ActionExecutor.execute({
      action: clickAction,
      page,
      tabId: "tab-pagination",
    });

    expect(clickRes.result.status).toBe(ActionStatus.COMPLETED);
    const indicatorText = await page.locator("#page-indicator").innerText();
    expect(indicatorText).toBe("Page 2 of 3");
  });

  // =========================================================================
  // 4. Multiple Tabs Context Switching
  // =========================================================================
  it("4. Multiple Tabs: handles secondary tab creation, isolation, and safe cleanup", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Main Tab</title></head>
        <body>
          <h1>Main Workspace</h1>
          <a id="ext-link" href="about:blank" target="_blank">Open Doc in New Tab</a>
        </body>
      </html>
    `);

    const context = page.context();
    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      page.locator("#ext-link").click(),
    ]);

    await newPage.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Secondary Document Tab</title></head>
        <body>
          <h2 id="secret-token">SEC-TOKEN-98765</h2>
        </body>
      </html>
    `);

    const secondaryObs = await PageObserver.observe(newPage, "tab-secondary");
    expect(secondaryObs.title).toBe("Secondary Document Tab");

    const token = await newPage.locator("#secret-token").innerText();
    expect(token).toBe("SEC-TOKEN-98765");

    await newPage.close();
    expect(page.isClosed()).toBe(false);
  });

  // =========================================================================
  // 5. Iframes Interaction
  // =========================================================================
  it("5. Iframes: safely interacts with embedded iframe controls without sandbox boundary escape", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Parent Page With Iframe</title></head>
        <body>
          <h1>Parent Window</h1>
          <iframe id="embedded-frame" srcdoc="
            <!DOCTYPE html>
            <html>
              <body>
                <button id='frame-btn' onclick='window.clicked = true; document.getElementById(&quot;status&quot;).innerText = &quot;Frame Clicked&quot;'>Click Inside Frame</button>
                <span id='status'>Waiting</span>
              </body>
            </html>
          "></iframe>
        </body>
      </html>
    `);

    const frame = page.frameLocator("#embedded-frame");
    const frameBtn = frame.locator("#frame-btn");
    await frameBtn.waitFor({ state: "visible", timeout: 3000 });
    await frameBtn.click();

    const statusText = await frame.locator("#status").innerText();
    expect(statusText).toBe("Frame Clicked");
  });

  // =========================================================================
  // 6. Popups and Overlays: Reject Forced Clicks
  // =========================================================================
  it("6. Popups and Overlays: refuses forced click or synthetic bypass when element is obscured", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Modal Overlay Test</title></head>
        <body>
          <button id="target-btn" style="position: absolute; top: 100px; left: 100px;" onclick="window.clicked = true;">
            Target Action
          </button>
          <div id="blocking-modal" style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 9999;">
            <h2>Session Notification Overlay</h2>
            <p>Please review notice.</p>
          </div>
        </body>
      </html>
    `);

    const blockedAction: Action = {
      id: "click-obscured",
      type: ActionType.CLICK,
      reason: "Click action that is completely covered by an modal overlay",
      risk: RiskLevel.LOW,
      target: { strategy: LocatorStrategy.ID, value: "target-btn" },
      timeout: 2000,
    };

    const res = await ActionExecutor.execute({
      action: blockedAction,
      page,
      tabId: "tab-modal",
    });

    expect(res.result.status).toBe(ActionStatus.FAILED);
    expect(res.result.verified).toBe(false);
  });

  // =========================================================================
  // 7. Search Filters and Sorting
  // =========================================================================
  it("7. Search Filters: applies price filter and verifies filtered product listing", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Product Catalog with Filter</title></head>
        <body>
          <select id="price-filter" onchange="filterProducts(this.value)">
            <option value="all">All Prices</option>
            <option value="under-50k">Under ₹50,000</option>
          </select>
          <div id="product-list">
            <div class="prod" data-price="75000">Laptop Pro - ₹75,000</div>
            <div class="prod" data-price="35000">Tablet Air - ₹35,000</div>
            <div class="prod" data-price="25000">Wireless Buds - ₹25,000</div>
          </div>
          <script>
            function filterProducts(val) {
              const prods = document.querySelectorAll('.prod');
              prods.forEach(p => {
                const price = parseInt(p.getAttribute('data-price'));
                if (val === 'under-50k' && price >= 50000) {
                  p.style.display = 'none';
                } else {
                  p.style.display = 'block';
                }
              });
            }
          </script>
        </body>
      </html>
    `);

    const selectAction: Action = {
      id: "select-filter",
      type: ActionType.SELECT,
      reason: "Filter products to under ₹50,000",
      risk: RiskLevel.LOW,
      target: { strategy: LocatorStrategy.ID, value: "price-filter" },
      value: "under-50k",
    };

    const selectRes = await ActionExecutor.execute({
      action: selectAction,
      page,
      tabId: "tab-filter",
    });

    expect(selectRes.result.status).toBe(ActionStatus.COMPLETED);

    const isLaptopVisible = await page.locator("text=Laptop Pro").isVisible();
    expect(isLaptopVisible).toBe(false);

    const isTabletVisible = await page.locator("text=Tablet Air").isVisible();
    expect(isTabletVisible).toBe(true);
  });

  // =========================================================================
  // 8. Login-Required Pages: Safe Halt without Bypass Attempt
  // =========================================================================
  it("8. Login-Required Pages: detects auth gate and halts with AUTH_REQUIRED without bypass", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Sign in to your Account</title></head>
        <body>
          <div role="dialog" class="auth-modal">
            <h2>Sign in to continue</h2>
            <p>Please log in with your credentials to access your banking dashboard.</p>
            <input type="text" placeholder="Username" />
            <input type="password" placeholder="Password" />
            <button id="login-submit">Sign In</button>
          </div>
        </body>
      </html>
    `);

    const obs = await PageObserver.observe(page, "tab-auth");
    const challenge = ChallengeDetector.detect(obs);
    expect(challenge.isBlocked).toBe(true);
    expect(challenge.blockType).toBe("AUTH_REQUIRED");
  });

  // =========================================================================
  // 9. Session Expiration Detection
  // =========================================================================
  it("9. Session Expiration: detects session timeout redirect to login and halts safely", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Session Expired</title></head>
        <body>
          <div class="alert alert-warning">
            <h2>Your session has expired</h2>
            <p>Please sign in to continue listening and access this service.</p>
            <a href="/login">Go to Login</a>
          </div>
        </body>
      </html>
    `);

    const obs = await PageObserver.observe(page, "tab-session");
    const challenge = ChallengeDetector.detect(obs);
    expect(challenge.isBlocked).toBe(true);
    expect(challenge.blockType).toBe("AUTH_REQUIRED");
    expect(challenge.reason).toContain("sign-in");
  });

  // =========================================================================
  // 10. Downloads and Uploads
  // =========================================================================
  it("10. Downloads and Uploads: enforces LocalFileResolver boundary and handles file input", async () => {
    await expect(
      LocalFileResolver.resolveFile({
        pathOrName: "../../Windows/System32/cmd.exe",
        searchDirectory: process.cwd(),
      })
    ).rejects.toThrow();

    const tempFile = path.resolve(process.cwd(), "scratch", "upload-test.txt");
    fs.mkdirSync(path.dirname(tempFile), { recursive: true });
    fs.writeFileSync(tempFile, "Authorized BrowseIQ Upload Test Document", "utf-8");

    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>File Upload Test</title></head>
        <body>
          <h1>Upload Portal</h1>
          <input type="file" id="doc-upload" />
          <span id="file-name">No file</span>
          <script>
            document.getElementById('doc-upload').addEventListener('change', (e) => {
              if (e.target.files.length > 0) {
                document.getElementById('file-name').innerText = e.target.files[0].name;
              }
            });
          </script>
        </body>
      </html>
    `);

    const uploadAction: Action = {
      id: "upload-doc",
      type: ActionType.UPLOAD,
      reason: "Upload authorized document to file input",
      risk: RiskLevel.LOW,
      target: { strategy: LocatorStrategy.ID, value: "doc-upload" },
      value: tempFile,
    };

    const uploadRes = await ActionExecutor.execute({
      action: uploadAction,
      page,
      tabId: "tab-upload",
    });

    expect(uploadRes.result.status).toBe(ActionStatus.COMPLETED);
    const uploadedName = await page.locator("#file-name").innerText();
    expect(uploadedName).toBe("upload-test.txt");

    try {
      fs.unlinkSync(tempFile);
    } catch {}
  });

  // =========================================================================
  // 11. Unexpected Redirects Destination Safety Check
  // =========================================================================
  it("11. Unexpected Redirects: validates redirect destinations against URL security policy", () => {
    expect(() => validateUrlString("https://example.com/checkout", "test")).not.toThrow();

    expect(() => validateUrlString("javascript:alert(1)", "test")).toThrow();
    expect(() => validateUrlString("file:///etc/passwd", "test")).toThrow();
    expect(() => validateUrlString("data:text/html,<h1>XSS</h1>", "test")).toThrow();

    expect(() => validateUrlString("http://169.254.169.254/latest/meta-data", "test")).toThrow();
  });
});
