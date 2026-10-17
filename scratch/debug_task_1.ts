import { AgentLoop } from "../lib/agent/agent-loop";
import { browserManager } from "../lib/browser/browser-manager";

async function main() {
  const loop = new AgentLoop();
  const ctx = await loop.runTask({
    task: "Find the cheapest laptop and give me its name and price.",
    targetUrl: "http://localhost:3000/test-fixtures/search",
    onEvent: (evt) => {
      console.log(`[EVENT ${evt.type}] ${evt.message}`);
    },
  });
  console.log("PLAN ACTIONS:", JSON.stringify(ctx.plan?.actions, null, 2));
  console.log("FINAL STATUS:", ctx.finalStatus);
  console.log("STATUS MESSAGE:", ctx.statusMessage);
  console.log("ERRORS:", ctx.errors);
  await browserManager.close();
}


main().catch(console.error);
