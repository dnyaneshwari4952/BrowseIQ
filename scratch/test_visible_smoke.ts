import { browserManager } from "../lib/browser/browser-manager";

async function runSmokeTest() {
  console.log("Starting smoke test for visible browser window...");
  const session = await browserManager.createTaskSession("smoke-task-visible");
  console.log(`Visible browser session created for ${session.taskId}. Window open: ${session.windowOpen}`);

  await session.page.goto("https://example.com");
  const title = await session.page.title();
  console.log(`Page navigated to https://example.com. Title: "${title}"`);

  browserManager.completeTaskSession(session.taskId, "completed");
  console.log(`Task completed. Is window still open? ${browserManager.isWindowOpen(session.taskId)}`);

  console.log("Waiting 2 seconds to confirm window persistence on desktop...");
  await new Promise((r) => setTimeout(r, 2000));

  console.log("Closing task session cleanly...");
  await browserManager.closeTaskSession(session.taskId);
  await browserManager.close();
  console.log("Smoke test finished successfully.");
}

runSmokeTest().catch(console.error);
