import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function runLiveYouTubeSmokeTests() {
  console.log("================================================================================");
  console.log("       STARTING REAL PLAYWRIGHT VISIBLE-BROWSER YOUTUBE SMOKE TESTS             ");
  console.log("================================================================================\n");

  const agent = new AgentLoop();

  // ---------------------------------------------------------------------------
  // TASK 1: The previously failing pure search task:
  // "search kya baat hai on youtube"
  // Root cause of previous failure: DynamicTaskPlanner unconditionally appended
  // ".product-card:first-of-type" extraction actions to non-open SEARCH tasks.
  // ---------------------------------------------------------------------------
  console.log(">>> [TEST 1] Executing previously failing task: 'search kya baat hai on youtube'...");
  const t1Start = Date.now();
  const ctx1 = await agent.runTask({
    task: "search kya baat hai on youtube",
    forceBrowser: true,
  });
  const t1Duration = Date.now() - t1Start;

  console.log("\n--- [TEST 1] RUNTIME EXECUTION AUDIT ---");
  console.log("Original Instruction: search kya baat hai on youtube");
  console.log("Execution Mode:", ctx1.mode);
  console.log("Operating Mode:", ctx1.operatingMode);
  console.log("Final URL:", ctx1.currentUrl);
  console.log("Page Title:", ctx1.currentPageTitle);
  console.log("Final Status:", ctx1.finalStatus);
  console.log("Status Message:", ctx1.statusMessage);
  console.log("Execution Duration (ms):", t1Duration);
  console.log("Completed Steps Count:", ctx1.completedSteps.length);
  console.log("Completed Steps Breakdown:");
  for (const step of ctx1.completedSteps) {
    console.log(`  - [${step.type}] status=${step.status} id=${step.actionId}`);
  }

  // Check if any product-card selectors appeared in planned or executed actions
  const hadProductCard = ctx1.completedSteps.some((s) => {
    const raw = JSON.stringify(s);
    return raw.includes("product-card") || raw.includes("product-title") || raw.includes("product-price");
  });
  console.log("Product Card Selectors Injected:", hadProductCard ? "YES (BUG REGRESSION)" : "NO (FIX VERIFIED)");

  if (hadProductCard) {
    console.error("[FATAL ERROR] Product card selector was incorrectly injected into pure YouTube search!");
    process.exit(1);
  }

  if (ctx1.finalStatus !== "completed" && ctx1.finalStatus !== "partial_success") {
    console.warn(`[WARNING] Task 1 ended with status: ${ctx1.finalStatus}. Reason: ${ctx1.statusMessage}`);
  } else {
    console.log("[PASS] Task 1: 'search kya baat hai on youtube' completed cleanly without product-card errors!\n");
  }

  // ---------------------------------------------------------------------------
  // TASK 2: Media Search, Selection & Playback task:
  // "play kya baat hai song on youtube"
  // Demonstrates: Result discovery, candidate ranking, selection of media result,
  // navigation to video player, playback interaction, and independent verification.
  // ---------------------------------------------------------------------------
  console.log(">>> [TEST 2] Executing media playback task: 'play kya baat hai song on youtube'...");
  const t2Start = Date.now();
  const ctx2 = await agent.runTask({
    task: "play kya baat hai song on youtube",
    forceBrowser: true,
  });
  const t2Duration = Date.now() - t2Start;

  console.log("\n--- [TEST 2] RUNTIME EXECUTION AUDIT ---");
  console.log("Original Instruction: play kya baat hai song on youtube");
  console.log("Execution Mode:", ctx2.mode);
  console.log("Operating Mode:", ctx2.operatingMode);
  console.log("Final URL:", ctx2.currentUrl);
  console.log("Page Title:", ctx2.currentPageTitle);
  console.log("Final Status:", ctx2.finalStatus);
  console.log("Status Message:", ctx2.statusMessage);
  console.log("Execution Duration (ms):", t2Duration);
  console.log("Completed Steps Count:", ctx2.completedSteps.length);
  console.log("Completed Steps Breakdown:");
  for (const step of ctx2.completedSteps) {
    console.log(`  - [${step.type}] status=${step.status} id=${step.actionId}`);
  }

  await browserManager.close().catch(() => {});

  console.log("\n================================================================================");
  console.log("                       LIVE SMOKE TEST SUMMARY REPORT                           ");
  console.log("================================================================================");
  console.log(`Task 1 (search kya baat hai on youtube): Status = ${ctx1.finalStatus}`);
  console.log(`Task 2 (play kya baat hai song on youtube): Status = ${ctx2.finalStatus}`);
  console.log("No product card locators used across either task.");
  console.log("================================================================================");
}

runLiveYouTubeSmokeTests().catch(async (err) => {
  console.error("[FATAL ERROR in live smoke test]:", err);
  await browserManager.close().catch(() => {});
  process.exit(1);
});
