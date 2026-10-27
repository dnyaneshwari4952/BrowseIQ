import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function runDemo() {
  const agent = new AgentLoop();

  console.log("================================================================================");
  console.log("TEST 1: LIVE CONTROLLED FIXTURE SEARCH ('search for the cheapest school bags')");
  console.log("Target: http://localhost:3000/test-fixtures/search");
  console.log("================================================================================");

  const searchCtx = await agent.runTask({
    task: "Search for school bags and find the cheapest school bag with its name and price",
    targetUrl: "http://localhost:3000/test-fixtures/search",
    forceBrowser: true,
  });

  console.log("Final Status:", searchCtx.finalStatus);
  console.log("Status Message:", searchCtx.statusMessage);
  console.log("Steps Completed:", searchCtx.completedSteps.length);
  searchCtx.completedSteps.forEach((s, idx) => {
    console.log(`  Step ${idx + 1}: ${s.type} [${s.status}] (verified: ${s.verified})`);
  });
  console.log("Extracted Data:", JSON.stringify(searchCtx.extractedData, null, 2));
  console.log("Page Observation Available:", Boolean(searchCtx.latestObservation));
  console.log("Observed Page Title:", searchCtx.latestObservation?.title);
  console.log("Observed Elements Count:", searchCtx.latestObservation?.interactiveElements.length);

  console.log("\n================================================================================");
  console.log("TEST 2: GOOGLE-STYLE CHALLENGE PAGE DETECTION (/test-fixtures/challenge)");
  console.log("Target: http://localhost:3000/test-fixtures/challenge");
  console.log("================================================================================");

  const challengeCtx = await agent.runTask({
    task: "search for cheapest school bags",
    targetUrl: "http://localhost:3000/test-fixtures/challenge",
    forceBrowser: true,
  });

  console.log("Final Status:", challengeCtx.finalStatus);
  console.log("Status Message:", challengeCtx.statusMessage);
  console.log("Error Classification:", challengeCtx.errors.map((e) => e.code).join(", "));
  console.log("Steps Executed:", challengeCtx.completedSteps.length);
  console.log("Retries Wasted:", challengeCtx.retries);
  console.log("Replans Wasted:", challengeCtx.replans);
  console.log("Page Observation Available After Failure:", Boolean(challengeCtx.latestObservation));
  console.log("Observed Page URL:", challengeCtx.latestObservation?.url);
  console.log("Observed Page Title:", challengeCtx.latestObservation?.title);
  console.log("Observed Headings:", challengeCtx.latestObservation?.headings);

  await browserManager.close().catch(() => {});
  console.log("\nLive verification demo completed successfully.");
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
