import { chromium } from "playwright";
import { PageObserver } from "../lib/browser/page-observer";
import { ChallengeDetector } from "../lib/browser/challenge-detector";

async function main() {
  console.log("Launching Chromium to inspect real Google search...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log("Navigating to https://www.google.com...");
    await page.goto("https://www.google.com", { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Initial URL:", page.url());
    console.log("Initial Title:", await page.title());

    // Observe initial page
    let obs = await PageObserver.observe(page);
    console.log("Initial Obs Summary:", obs.summary);
    console.log("Initial Headings:", obs.headings);
    console.log("Initial Challenge:", ChallengeDetector.detect(obs));

    // Fill search input
    const searchInput = page.locator('textarea[name="q"], input[name="q"]').first();
    await searchInput.fill("cheapest school bags");
    console.log("Filled search input.");

    // Press Enter
    console.log("Pressing Enter...");
    await searchInput.press("Enter");

    // Immediately observe (what ActionExecutor does right after press Enter)
    const immediateObs = await PageObserver.observe(page);
    console.log("\n--- IMMEDIATE OBSERVATION AFTER ENTER ---");
    console.log("Immediate URL:", immediateObs.url);
    console.log("Immediate Title:", immediateObs.title);
    console.log("Immediate Headings:", immediateObs.headings);
    console.log("Immediate Element count:", immediateObs.interactiveElements.length);
    console.log("Immediate Challenge:", ChallengeDetector.detect(immediateObs));

    // Now wait for load state / navigation
    console.log("\nWaiting for domcontentloaded / networkidle / navigation...");
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(2000);

    const postWaitObs = await PageObserver.observe(page);
    console.log("\n--- POST-WAIT OBSERVATION (2s) ---");
    console.log("Post-Wait URL:", postWaitObs.url);
    console.log("Post-Wait Title:", postWaitObs.title);
    console.log("Post-Wait Headings:", postWaitObs.headings);
    console.log("Post-Wait Summary:", postWaitObs.summary);
    console.log("Post-Wait Challenge:", ChallengeDetector.detect(postWaitObs));

    // Check visible body text snippets
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1000) : "");
    console.log("\nPost-Wait Body Text Sample (first 500 chars):\n", bodyText.slice(0, 500));

    // Check relevant search result elements
    const searchResults = await page.evaluate(() => {
      const items: string[] = [];
      // Google search result titles/cards
      document.querySelectorAll('h3, div[data-snf], div[role="heading"], a h3').forEach((el) => {
        const text = (el.textContent || "").trim();
        if (text && items.length < 10) items.push(text);
      });
      return items;
    });
    console.log("\nSearch Result Headings (h3):", searchResults);

  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
