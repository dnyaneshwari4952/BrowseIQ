import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function main() {
  console.log("=== RUNNING: 'search for the cheapest school bags' ===");
  const agent = new AgentLoop();

  const ctx = await agent.runTask({
    task: "search for the cheapest school bags",
    forceBrowser: true,
  });

  console.log("\n--- EXECUTION RESULTS ---");
  console.log("Final Status:", ctx.finalStatus);
  console.log("Status Message:", ctx.statusMessage);
  console.log("Route:", ctx.plan?.routeDecision?.route);
  console.log("Completed Steps Count:", ctx.completedSteps.length);
  ctx.completedSteps.forEach((s, idx) => {
    console.log(`  Step ${idx + 1}: ${s.type} [${s.status}] (${s.durationMs}ms)`);
  });
  console.log("Retries Used:", ctx.retries);
  console.log("Replans Used:", ctx.replans);
  console.log("Extracted Data:", JSON.stringify(ctx.extractedData, null, 2));

  await browserManager.close().catch(() => {});
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
