import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function main() {
  console.log("================================================================================");
  console.log("      STARTING LIVE VISIBLE-BROWSER FLIPKART PRODUCT SEARCH SMOKE TEST          ");
  console.log("================================================================================\n");

  const task = "search for cheapest mobile phones on flipkart";
  const agent = new AgentLoop();

  console.log(`Executing live task: "${task}"...`);
  const startMs = Date.now();

  const ctx = await agent.runTask({
    task,
    forceBrowser: true,
    onEvent: (e) => {
      console.log(`[AGENT EVENT: ${e.type}] ${e.message}`);
    },
    onStateChange: (state, step, msg) => {
      console.log(`[AGENT STATE: ${state} (step ${step})] ${msg}`);
    },
  });

  const durationMs = Date.now() - startMs;

  console.log("\n--- RUNTIME EXECUTION AUDIT ---");
  console.log("Original Instruction:", ctx.originalTask);
  console.log("Execution Mode:", ctx.mode);
  console.log("Operating Mode:", ctx.operatingMode);
  console.log("Final URL:", ctx.currentUrl);
  console.log("Page Title:", ctx.currentPageTitle);
  console.log("Final Status:", ctx.finalStatus);
  console.log("Lifecycle State:", ctx.lifecycleState);
  console.log("Status Message:", ctx.statusMessage);
  console.log("Execution Duration (ms):", durationMs);
  console.log("Completed Steps Count:", ctx.completedSteps.length);
  console.log("Completed Steps Breakdown:");
  for (const step of ctx.completedSteps) {
    console.log(`  - [${step.type}] status=${step.status} id=${step.actionId}`);
  }
  if (ctx.failedSteps.length > 0) {
    console.log("Failed Steps Count:", ctx.failedSteps.length);
    for (const failed of ctx.failedSteps) {
      console.log(`  - [${failed.type}] status=${failed.status} id=${failed.actionId} error=${failed.error?.message}`);
    }
  }

  console.log("\n--- EXTRACTED DATA / PRICE COMPARISON AUDIT ---");
  console.log("Extracted Data:", JSON.stringify(ctx.extractedData, null, 2));

  console.log("\n--- TASK VERIFICATION AUDIT ---");
  console.log("Passed:", ctx.taskVerification?.passed);
  console.log("Outcome:", ctx.taskVerification?.outcome);
  console.log("Failed Checks:", ctx.taskVerification?.failedChecks);
  console.log("Missing Outputs:", ctx.taskVerification?.missingOutputs);

  // Close browser session cleanly
  await browserManager.close().catch(() => {});

  console.log("\n================================================================================");
  console.log("                      FLIPKART SMOKE TEST SUMMARY REPORT                        ");
  console.log("================================================================================");
  console.log(`Task: ${task}`);
  console.log(`Final Status: ${ctx.finalStatus}`);
  console.log(`Reached Flipkart: ${Boolean(ctx.currentUrl && ctx.currentUrl.includes("flipkart.com"))}`);
  console.log(`Browser left about:blank: ${ctx.currentUrl !== "about:blank"}`);
  console.log("================================================================================");

  if (ctx.finalStatus !== "completed" && ctx.finalStatus !== "partial_success" && ctx.finalStatus !== "blocked") {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("Live test failed with unhandled error:", err);
  await browserManager.close().catch(() => {});
  process.exit(1);
});
