import { chromium } from "playwright";
import { LocatorEngine } from "../lib/browser/locator-engine";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/test-fixtures/search");

  const fillLoc = await LocatorEngine.resolve(page, {
    strategy: "placeholder",
    value: "Search products",
  });
  console.log("FILL LOCATOR:", fillLoc.strategyUsed, fillLoc.reason);
  await fillLoc.locator.fill("quantum teleportation device");

  const clickLoc = await LocatorEngine.resolve(page, {
    strategy: "role",
    value: "Search",
    role: "button",
  });
  console.log("CLICK LOCATOR:", clickLoc.strategyUsed, clickLoc.reason);
  await clickLoc.locator.click();

  await page.waitForTimeout(1000);
  const bodyText = await page.innerText("body");
  console.log("BODY TEXT:\n", bodyText);
  await browser.close();
}

main();
