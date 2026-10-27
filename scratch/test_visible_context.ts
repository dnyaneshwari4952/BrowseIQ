import { chromium } from "playwright";

async function main() {
  console.log("Launching visible Chromium...");
  const browser = await chromium.launch({ headless: false });
  console.log("Creating context 1...");
  const ctx1 = await browser.newContext();
  const page1 = await ctx1.newPage();
  await page1.goto("about:blank");
  console.log("Page 1 opened.");

  console.log("Creating context 2...");
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto("about:blank");
  console.log("Page 2 opened.");

  console.log("Closing page 1...");
  await page1.close();
  await ctx1.close();
  console.log("Context 1 closed. Is page 2 still open?", !page2.isClosed());

  await page2.close();
  await ctx2.close();
  await browser.close();
  console.log("Done.");
}

main().catch(console.error);
