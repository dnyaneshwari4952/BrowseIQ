import { resetConfigForTesting } from "../lib/config";
import { AgentLoop } from "../lib/agent/agent-loop";

resetConfigForTesting({ LLM_PROVIDER: "mock", NODE_ENV: "test" });

async function main() {
  const agentLoop = new AgentLoop();
  const ctx = await agentLoop.runTask({
    task: "Find 'quantum teleportation device' on this website",
    targetUrl: "http://localhost:3000/test-fixtures/search",
  });
  console.log("FINAL STATUS:", ctx.finalStatus);
  console.log("REASON:", ctx.statusMessage);
  console.log("VERIF:", ctx.taskVerification);
  console.log("COMPLETED STEPS:", ctx.completedSteps.map(s => ({
    type: s.type,
    id: s.actionId,
    extractedData: s.extractedData,
  })));
}

main();
