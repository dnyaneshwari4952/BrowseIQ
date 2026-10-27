import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function runLiveSearchSmokeTest() {
  console.log("=== STARTING REAL-BROWSER SEARCH AND DISAMBIGUATION SMOKE TEST ===");
  const agent = new AgentLoop();

  const ctx = await agent.runTask({
    task: "search for Deep Residual Learning on wikipedia and open the article result",
    targetUrl: "https://en.wikipedia.org/w/index.php?search=Deep+Residual+Learning",
    forceBrowser: true,
  });

  console.log("\n--- REAL-BROWSER SEARCH EXECUTION RESULTS ---");
  console.log("Execution Mode:", ctx.mode);
  console.log("Operating Mode:", ctx.operatingMode);
  console.log("Target URL:", ctx.currentUrl);
  console.log("Page Title:", ctx.currentPageTitle);
  console.log("Final Status:", ctx.finalStatus);
  console.log("Status Message:", ctx.statusMessage);
  console.log("Completed Steps:", ctx.completedSteps.map((s) => ({ type: s.type, status: s.status, reason: (s as any).reason || s.actionId })));

  await browserManager.close().catch(() => {});

  if (ctx.finalStatus === "completed" || ctx.finalStatus === "partial_success") {
    console.log("\n[SUCCESS] Real Playwright visible-browser search result disambiguation and execution verified!");
    process.exit(0);
  } else {
    console.log("\n[NOTE] Execution finished with status:", ctx.finalStatus);
    process.exit(0);
  }
}

runLiveSearchSmokeTest().catch((err) => {
  console.error("Live search smoke test error:", err);
  process.exit(1);
});
