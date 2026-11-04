import { chromium } from "playwright";
import { ChallengeDetector } from "@/lib/browser/challenge-detector";
import { LocatorEngine } from "@/lib/browser/locator-engine";

interface LiveTestResult {
  site: string;
  url: string;
  status: "PASSED" | "FAILED" | "BLOCKED";
  reason?: string;
  details: string;
  durationMs: number;
}

async function testRealWebsites() {
  console.log("============================================================");
  console.log("       BROWSEIQ REAL-WORLD PUBLIC WEBSITE RELIABILITY AUDIT  ");
  console.log("============================================================\n");
  console.log("Browser: Visible Chromium (headless: false)");
  console.log("Platform: Windows Desktop\n");

  const results: LiveTestResult[] = [];
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  // --- 1. WIKIPEDIA ---
  console.log("[1/5] Testing Wikipedia (Search & Extraction)...");
  const tWiki = Date.now();
  const pageWiki = await context.newPage();
  try {
    await pageWiki.goto("https://en.wikipedia.org/wiki/Main_Page", { waitUntil: "domcontentloaded", timeout: 25000 });
    const searchInput = pageWiki.locator("input[name='search'], input[type='search']").first();
    await searchInput.waitFor({ state: "visible", timeout: 8000 });
    await searchInput.fill("Artificial intelligence");
    await pageWiki.keyboard.press("Enter");
    await pageWiki.waitForLoadState("domcontentloaded", { timeout: 15000 });
    
    const heading = await pageWiki.locator("#firstHeading, h1").first().innerText();
    const firstPara = await pageWiki.locator("#mw-content-text p").filter({ hasText: /intelligence|machine|computer/i }).first().innerText();

    results.push({
      site: "Wikipedia",
      url: pageWiki.url(),
      status: heading.toLowerCase().includes("artificial intelligence") ? "PASSED" : "FAILED",
      details: `Article: "${heading}". Snippet: "${firstPara.slice(0, 100).replace(/\n/g, ' ')}..."`,
      durationMs: Date.now() - tWiki,
    });
  } catch (err: any) {
    results.push({
      site: "Wikipedia",
      url: pageWiki.url(),
      status: "FAILED",
      reason: err.message,
      details: `Failed to complete Wikipedia workflow: ${err.message}`,
      durationMs: Date.now() - tWiki,
    });
  } finally {
    await pageWiki.close().catch(() => {});
  }

  // --- 2. YOUTUBE ---
  console.log("\n[2/5] Testing YouTube (Search & Open Video Result)...");
  const tYt = Date.now();
  const pageYt = await context.newPage();
  try {
    await pageYt.goto("https://www.youtube.com", { waitUntil: "domcontentloaded", timeout: 25000 });
    
    // Check for cookie consent dialog (EU / Google consent)
    const consentBtn = pageYt.locator("button[aria-label*='Accept' i], button:has-text('Accept all'), button:has-text('Reject all'), button:has-text('I agree')").first();
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click().catch(() => {});
      await pageYt.waitForTimeout(1000);
    }

    const ytSearch = pageYt.locator("input#search, input[name='search_query']").first();
    await ytSearch.waitFor({ state: "visible", timeout: 10000 });
    await ytSearch.click();
    await ytSearch.fill("TypeScript tutorial for beginners");
    await pageYt.keyboard.press("Enter");
    await pageYt.waitForTimeout(3000);

    // Locate first video result
    const firstVideo = pageYt.locator("ytd-video-renderer #video-title, #video-title-link, a#video-title").first();
    await firstVideo.waitFor({ state: "visible", timeout: 10000 });
    const videoTitle = await firstVideo.innerText();
    await firstVideo.click();
    await pageYt.waitForTimeout(4000);

    const currentUrl = pageYt.url();
    const isPlayingPage = currentUrl.includes("/watch?v=");

    results.push({
      site: "YouTube",
      url: currentUrl,
      status: isPlayingPage ? "PASSED" : "FAILED",
      details: `Opened video: "${videoTitle.trim()}". Current URL: ${currentUrl}`,
      durationMs: Date.now() - tYt,
    });
  } catch (err: any) {
    results.push({
      site: "YouTube",
      url: pageYt.url(),
      status: "FAILED",
      reason: err.message,
      details: `Failed on YouTube: ${err.message}`,
      durationMs: Date.now() - tYt,
    });
  } finally {
    await pageYt.close().catch(() => {});
  }

  // --- 3. AMAZON ---
  console.log("\n[3/5] Testing Amazon (Product Search & Extraction / Bot Check)...");
  const tAz = Date.now();
  const pageAz = await context.newPage();
  try {
    await pageAz.goto("https://www.amazon.com", { waitUntil: "domcontentloaded", timeout: 25000 });
    
    // Check for Amazon Bot/Robot Check
    const pageContent = await pageAz.content();
    const isCaptcha = pageContent.includes("Type the characters you see in this image") || 
                      pageContent.includes("Enter the characters you see below") ||
                      pageContent.includes("Robot Check");

    if (isCaptcha) {
      console.log("   -> Amazon triggered Robot Check / Anti-bot CAPTCHA barrier.");
      results.push({
        site: "Amazon",
        url: pageAz.url(),
        status: "BLOCKED",
        reason: "BOT_CHALLENGE_CAPTCHA",
        details: "Amazon presented automated bot barrier ('Type characters you see'). Guardrails safely halted per security policy.",
        durationMs: Date.now() - tAz,
      });
    } else {
      const azInput = pageAz.locator("#twotabsearchtextbox, input[name='field-keywords']").first();
      await azInput.waitFor({ state: "visible", timeout: 8000 });
      await azInput.fill("wireless ergonomic mouse");
      const submitBtn = pageAz.locator("#nav-search-submit-button, input[type='submit']").first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
      } else {
        await pageAz.keyboard.press("Enter");
      }
      await pageAz.waitForLoadState("domcontentloaded", { timeout: 15000 });

      // Extract results
      const items = pageAz.locator("div[data-component-type='s-search-result'] h2, h2 a span, h2 span");
      const count = await items.count();
      const firstItem = count > 0 ? await items.first().innerText() : "No items extracted";

      results.push({
        site: "Amazon",
        url: pageAz.url(),
        status: count > 0 ? "PASSED" : "FAILED",
        details: `Extracted search results (${count} items found). First: "${firstItem.slice(0, 80)}"`,
        durationMs: Date.now() - tAz,
      });
    }
  } catch (err: any) {
    results.push({
      site: "Amazon",
      url: pageAz.url(),
      status: "FAILED",
      reason: err.message,
      details: `Amazon search encountered error: ${err.message}`,
      durationMs: Date.now() - tAz,
    });
  } finally {
    await pageAz.close().catch(() => {});
  }

  // --- 4. FLIPKART ---
  console.log("\n[4/5] Testing Flipkart (Product Search & Filter Verification)...");
  const tFk = Date.now();
  const pageFk = await context.newPage();
  try {
    await pageFk.goto("https://www.flipkart.com", { waitUntil: "domcontentloaded", timeout: 25000 });
    
    // Close login popup if present
    const closeBtn = pageFk.locator("span._30XB9F, button._2KpZ6l._2doB4z, span[role='button']:has-text('✕')").first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click().catch(() => {});
      await pageFk.waitForTimeout(500);
    }

    const fkSearch = pageFk.locator("input[name='q'], input[title*='Search' i]").first();
    await fkSearch.waitFor({ state: "visible", timeout: 8000 });
    await fkSearch.fill("smartphones");
    await pageFk.keyboard.press("Enter");
    await pageFk.waitForLoadState("domcontentloaded", { timeout: 15000 });

    // Look for product names and sort
    const productTitles = pageFk.locator("div[data-id] a, div._75nlfW, a.CGtC5Q, div.yKfJKb, div._4rR01T, div.KzDlHZ");
    await pageFk.waitForTimeout(3000);
    const count = await productTitles.count();
    const firstTitle = count > 0 ? (await productTitles.first().innerText()).split("\n")[0] : "";

    // Test sort filter: "Price -- Low to High"
    let sortApplied = false;
    const lowToHighBtn = pageFk.locator("div:has-text('Price -- Low to High')").last();
    if (await lowToHighBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lowToHighBtn.click();
      await pageFk.waitForTimeout(2000);
      sortApplied = pageFk.url().includes("sort=price_asc");
    }

    results.push({
      site: "Flipkart",
      url: pageFk.url(),
      status: count > 0 ? "PASSED" : "FAILED",
      details: `Extracted ${count} smartphone listings (Sort applied: ${sortApplied}). First item: "${firstTitle.slice(0, 80)}"`,
      durationMs: Date.now() - tFk,
    });
  } catch (err: any) {
    results.push({
      site: "Flipkart",
      url: pageFk.url(),
      status: "FAILED",
      reason: err.message,
      details: `Flipkart workflow failed: ${err.message}`,
      durationMs: Date.now() - tFk,
    });
  } finally {
    await pageFk.close().catch(() => {});
  }

  // --- 5. PUBLIC FORM (Httpbin) ---
  console.log("\n[5/5] Testing Public Accessible Form (Httpbin POST form)...");
  const tForm = Date.now();
  const pageForm = await context.newPage();
  try {
    await pageForm.goto("https://httpbin.org/forms/post", { waitUntil: "domcontentloaded", timeout: 25000 });
    
    await pageForm.locator("input[name='custname']").fill("BrowseIQ Test Runner");
    await pageForm.locator("input[name='custtel']").fill("+1-555-0199");
    await pageForm.locator("input[name='custemail']").fill("automation@browseiq.agent");
    await pageForm.locator("input[value='medium']").check();
    await pageForm.locator("input[value='cheese']").check();
    await pageForm.locator("input[name='delivery']").fill("20:30");
    await pageForm.locator("textarea[name='comments']").fill("Deterministic Playwright execution test submission.");

    // Submit Form
    await pageForm.locator("button:has-text('Submit order'), button[type='submit']").first().click();
    await pageForm.waitForLoadState("domcontentloaded", { timeout: 15000 });

    const responseBody = await pageForm.locator("pre").first().innerText();
    const hasCustName = responseBody.includes("BrowseIQ Test Runner");
    const hasEmail = responseBody.includes("automation@browseiq.agent");

    results.push({
      site: "Public Form (httpbin.org)",
      url: pageForm.url(),
      status: hasCustName && hasEmail ? "PASSED" : "FAILED",
      details: `Form submitted and server echoed back custname ("BrowseIQ Test Runner") and email ("automation@browseiq.agent").`,
      durationMs: Date.now() - tForm,
    });
  } catch (err: any) {
    results.push({
      site: "Public Form (httpbin.org)",
      url: pageForm.url(),
      status: "FAILED",
      reason: err.message,
      details: `Form submission failed: ${err.message}`,
      durationMs: Date.now() - tForm,
    });
  } finally {
    await pageForm.close().catch(() => {});
  }

  await browser.close().catch(() => {});

  console.log("\n============================================================");
  console.log("            REAL PUBLIC WEBSITE TEST RESULTS               ");
  console.log("============================================================\n");

  for (const r of results) {
    const symbol = r.status === "PASSED" ? "✓" : r.status === "BLOCKED" ? "⚠" : "✗";
    console.log(`${symbol} [${r.status}] ${r.site} (${r.durationMs}ms)`);
    console.log(`  URL: ${r.url}`);
    if (r.reason) console.log(`  Reason: ${r.reason}`);
    console.log(`  Details: ${r.details}\n`);
  }
}

testRealWebsites().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
