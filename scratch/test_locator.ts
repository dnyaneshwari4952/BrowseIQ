import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/test-fixtures/search", { waitUntil: "networkidle" });
  console.log("URL:", page.url());
  console.log("PAGE TITLE:", await page.title());
  console.log("HTML SNIPPET:", (await page.content()).slice(0, 300));
  console.log("INPUT COUNT:", await page.locator("input").count());
  
  const loc1 = page.getByPlaceholder(new RegExp("Search products", "i"));
  console.log("LOC1 COUNT (regex placeholder):", await loc1.count());
  
  const loc2 = page.getByLabel("Search products");
  console.log("LOC2 COUNT (getByLabel aria-label):", await loc2.count());

  const loc3 = page.locator('input[placeholder*="Search products"]');
  console.log("LOC3 COUNT (css substring):", await loc3.count());
  
  await browser.close();
}

main().catch(console.error);
