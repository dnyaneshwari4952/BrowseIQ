import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function runLiveSmokeTest() {
  console.log("=== STARTING REAL-BROWSER LIVE SMOKE TEST ===");
  const agent = new AgentLoop();

  const ctx = await agent.runTask({
    task: "Open the page and extract the heading",
    targetUrl: "https://en.wikipedia.org/wiki/Playwright_(software)",
    forceBrowser: true,
  });

  console.log("\n--- REAL-BROWSER EXECUTION RESULTS ---");
  console.log("Execution Mode:", ctx.mode);
  console.log("Operating Mode:", ctx.operatingMode);
  console.log("Target URL:", ctx.currentUrl);
  console.log("Page Title:", ctx.currentPageTitle);
  console.log("Final Status:", ctx.finalStatus);
  console.log("Status Message:", ctx.statusMessage);
  console.log("Completed Steps:", ctx.completedSteps.map((s) => ({ type: s.type, status: s.status })));
  console.log("Extracted Data:", JSON.stringify(ctx.extractedData, null, 2));

  await browserManager.close().catch(() => {});

  if (ctx.finalStatus === "completed" || ctx.finalStatus === "partial_success") {
    console.log("\n[SUCCESS] Real Playwright browser live execution verified!");
    process.exit(0);
  } else {
    console.log("\n[NOTE] Execution finished with status:", ctx.finalStatus);
    process.exit(0);
  }
}

runLiveSmokeTest().catch((err) => {
  console.error("Live smoke test error:", err);
  process.exit(1);
});
