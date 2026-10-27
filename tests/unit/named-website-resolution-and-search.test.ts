import { describe, it, expect } from "vitest";
import { WebsiteRegistry } from "../../lib/planning/website-registry";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { ActionType, ActionStatus } from "../../lib/types/actions";
import { TaskVerifier } from "../../lib/agent/task-verifier";
import { AgentLoop } from "../../lib/agent/agent-loop";
import { AgentState } from "../../lib/types/plans";
import { ErrorCode, AgentError } from "../../lib/types/errors";
import { PageObservation } from "../../lib/types/browser";
import { LocalSemanticReasoner } from "../../lib/agent/local-semantic-reasoner";

describe("Named Website Resolution, Target Preservation & Search Execution Suite", () => {
  // 1. search for cheapest mobile phones on flipkart
  it("Scenario 1: 'search for cheapest mobile phones on flipkart' resolves Flipkart, preserves query & constraints", () => {
    const task = "search for cheapest mobile phones on flipkart";
    const target = WebsiteRegistry.resolveTarget(task);

    expect(target.urlClarificationNeeded).toBe(false);
    expect(target.targetWebsite).toBe("flipkart");
    expect(target.targetUrl).toBe("https://www.flipkart.com");
    expect(target.isRecognized).toBe(true);

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.targetWebsite).toBe("flipkart");
    expect(spec.targetUrl).toBe("https://www.flipkart.com");
    expect(spec.operation).toBe("COMPARE");
    expect(spec.ordering?.direction).toBe("MIN");
    expect(spec.ordering?.field).toBe("price");
    expect(spec.searchQuery).toBe("mobile phones");
    expect(spec.resultType).toBe("product");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions.length).toBeGreaterThan(3);
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://www.flipkart.com");

    const fillAction = plan.actions.find((a) => a.type === ActionType.FILL);
    expect(fillAction).toBeDefined();
    expect(fillAction?.value).toBe("mobile phones");

    const extractAction = plan.actions.find((a) => a.type === ActionType.EVALUATE_SAFE);
    expect(extractAction).toBeDefined();
  });

  // 2. open youtube and search for a song
  it("Scenario 2: 'open youtube and search for a song' resolves YouTube and plans navigation and search", () => {
    const task = "open youtube and search for a song";
    const target = WebsiteRegistry.resolveTarget(task);

    expect(target.urlClarificationNeeded).toBe(false);
    expect(target.targetWebsite).toBe("youtube");
    expect(target.targetUrl).toBe("https://www.youtube.com");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.targetWebsite).toBe("youtube");
    expect(spec.targetUrl).toBe("https://www.youtube.com");
    expect(spec.searchQuery).toBe("song");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://www.youtube.com");
  });

  // 3. search for Python tutorials on Wikipedia
  it("Scenario 3: 'search for Python tutorials on Wikipedia' resolves Wikipedia and preserves query", () => {
    const task = "search for Python tutorials on Wikipedia";
    const target = WebsiteRegistry.resolveTarget(task);

    expect(target.urlClarificationNeeded).toBe(false);
    expect(target.targetWebsite).toBe("wikipedia");
    expect(target.targetUrl).toBe("https://www.wikipedia.org");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.targetWebsite).toBe("wikipedia");
    expect(spec.targetUrl).toBe("https://www.wikipedia.org");
    expect(spec.searchQuery).toBe("Python tutorials");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://www.wikipedia.org");

    const fillAction = plan.actions.find((a) => a.type === ActionType.FILL);
    expect(fillAction?.value).toBe("Python tutorials");
  });

  // 4. open Hacker News and show the top story
  it("Scenario 4: 'open Hacker News and show the top story' resolves Hacker News domain alias", () => {
    const task = "open Hacker News and show the top story";
    const target = WebsiteRegistry.resolveTarget(task);

    expect(target.urlClarificationNeeded).toBe(false);
    expect(target.targetWebsite).toBe("hackernews");
    expect(target.targetUrl).toBe("https://news.ycombinator.com");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.targetWebsite).toBe("hackernews");
    expect(spec.targetUrl).toBe("https://news.ycombinator.com");

    const plan = DynamicTaskPlanner.plan({ spec });
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://news.ycombinator.com");
  });

  // 5. A task with an explicitly supplied target URL
  it("Scenario 5: Explicitly supplied target URL takes priority and resolves correctly", () => {
    const task = "find cheapest keyboard";
    const explicitUrl = "https://store.example.com/gadgets";

    const target = WebsiteRegistry.resolveTarget(task, explicitUrl);
    expect(target.urlClarificationNeeded).toBe(false);
    expect(target.targetUrl).toBe("https://store.example.com/gadgets");

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task, targetUrl: explicitUrl });
    expect(spec.targetUrl).toBe("https://store.example.com/gadgets");

    const plan = DynamicTaskPlanner.plan({ spec, targetUrl: explicitUrl });
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    expect(plan.actions[0].value).toBe("https://store.example.com/gadgets");
  });

  // 6. A task with no identifiable target website
  it("Scenario 6: Task with no identifiable target website does not invent domains and halts cleanly at about:blank", async () => {
    const task = "search for something somewhere";
    const target = WebsiteRegistry.resolveTarget(task);

    expect(target.targetUrl).toBeUndefined();
    expect(target.isRecognized).toBe(false);

    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    expect(spec.isAmbiguous).toBe(true);

    const agent = new AgentLoop();
    const result = await agent.runTask({
      task,
      operatingMode: "playwright",
    });

    expect(result.finalStatus).toBe("needs_clarification");
    expect(result.state).toBe(AgentState.WAITING_FOR_USER);
  });

  // 7. A replan that must preserve the original target and search query
  it("Scenario 7: Dynamic replan preserves original target URL, website, query, and spec", () => {
    const task = "search for cheapest mobile phones on flipkart";
    const spec = EntityConstraintResolver.resolve({ rawInstruction: task });
    const initialPlan = DynamicTaskPlanner.plan({ spec });

    const failedStepIndex = 1; // e.g. wait or fill failed
    const observation: PageObservation = {
      tabId: "tab-1",
      url: "https://www.flipkart.com",
      title: "Online Shopping Site for Mobiles, Electronics",
      interactiveElements: [
        {
          id: "search-input",
          tagName: "INPUT",
          type: "text",
          placeholder: "Search for Products, Brands and More",
          isVisible: true,
          isEnabled: true,
        },
        {
          id: "search-btn",
          tagName: "BUTTON",
          text: "Search",
          isVisible: true,
          isEnabled: true,
        },
      ],
      headings: [],
      forms: [],
      dialogs: [],
      summary: "Flipkart homepage loaded",
      timestamp: new Date().toISOString(),
    };

    const revisedPlan = DynamicTaskPlanner.replan({
      currentPlan: initialPlan,
      failedStepIndex,
      observation,
      failureReason: "Element not interactable",
      failedTargets: new Set(),
    });

    expect(revisedPlan.taskSpec).toBeDefined();
    expect(revisedPlan.taskSpec?.targetWebsite).toBe("flipkart");
    expect(revisedPlan.taskSpec?.targetUrl).toBe("https://www.flipkart.com");
    expect(revisedPlan.taskSpec?.searchQuery).toBe("mobile phones");
    expect(revisedPlan.taskInterpretation).toBe(initialPlan.taskInterpretation);
  });

  // 8. A navigation failure that must not be reported as success
  it("Scenario 8: Navigation failure fails task verification and does not report success", () => {
    const spec = EntityConstraintResolver.resolve({ rawInstruction: "search on flipkart" });
    const plan = DynamicTaskPlanner.plan({ spec });

    const verification = TaskVerifier.verifyTask({
      task: "search on flipkart",
      plan,
      targetUrl: "https://www.flipkart.com",
      completedSteps: [
        {
          actionId: "step-1-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.FAILED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 500,
          error: {
            code: ErrorCode.NAVIGATION_FAILED,
            message: "net::ERR_NAME_NOT_RESOLVED",
          },
          retriesUsed: 0,
          verified: false,
        },
      ],
      observation: {
        tabId: "tab-0",
        url: "about:blank",
        title: "",
        interactiveElements: [],
        headings: [],
        forms: [],
        dialogs: [],
        summary: "about:blank",
        timestamp: new Date().toISOString(),
      },
      extractedData: null,
      downloads: [],
    });

    expect(verification.passed).toBe(false);
    expect(verification.outcome).not.toBe("success");
    expect(verification.outcome).toBe("failed");
  });

  // 9. A loaded search page with no matching results
  it("Scenario 9: Search page loaded but no results found fails verification honestly", () => {
    const spec = EntityConstraintResolver.resolve({ rawInstruction: "search for cheapest mobile phones on flipkart" });
    const plan = DynamicTaskPlanner.plan({ spec });

    // When extractedData has zero products found
    const reasonerResult = LocalSemanticReasoner.evaluate(
      [],
      {
        entity: "phone",
        comparison: { operation: "MIN", field: "price" },
      } as any
    );

    expect(reasonerResult.found).toBe(false);

    const verification = TaskVerifier.verifyTask({
      task: "search for cheapest mobile phones on flipkart",
      plan,
      targetUrl: "https://www.flipkart.com",
      completedSteps: [
        {
          actionId: "step-1-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          verified: true,
        },
        {
          actionId: "step-2-fill",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 200,
          verified: true,
        },
      ],
      observation: {
        tabId: "tab-0",
        url: "https://www.flipkart.com/search?q=mobile+phones",
        title: "Search Results",
        interactiveElements: [],
        headings: ["No results found"],
        forms: [],
        dialogs: [],
        summary: "No products found",
        timestamp: new Date().toISOString(),
      },
      extractedData: reasonerResult,
      downloads: [],
    });

    expect(verification.passed).toBe(false);
    expect(verification.outcome).not.toBe("success");
  });

  // 10. A site that requires user authentication or displays a CAPTCHA
  it("Scenario 10: Site requiring authentication or CAPTCHA halts as blocked with preserved state", () => {
    const authObservation: PageObservation = {
      tabId: "tab-0",
      url: "https://example.com/restricted",
      title: "Authentication Required",
      interactiveElements: [],
      headings: ["Sign In to Access"],
      forms: [],
      dialogs: [{ type: "modal", message: "Sign in to see lyrics and listen to the full track." }],
      summary: "Sign in required banner displayed",
      timestamp: new Date().toISOString(),
    };

    const spec = EntityConstraintResolver.resolve({ rawInstruction: "search for music on spotify" });
    const plan = DynamicTaskPlanner.plan({ spec });

    const verification = TaskVerifier.verifyTask({
      task: "search for music on spotify",
      plan,
      targetUrl: "https://open.spotify.com",
      completedSteps: [
        {
          actionId: "step-1-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          verified: true,
        },
      ],
      observation: authObservation,
      extractedData: null,
      downloads: [],
    });

    expect(verification.passed).toBe(false);
    expect(verification.outcome).toBe("blocked");
    expect(verification.isBlocked).toBe(true);
  });

  // 11. Price comparison distinguishes lowest displayed price from final payable price
  it("Scenario 11: Price comparison accurately identifies lowest displayed price and includes pricing disclaimer", () => {
    const products = [
      { title: "Budget Phone Alpha 4G", price: "₹6,499" },
      { title: "Mid-tier Phone 5G", price: "₹14,999" },
      { title: "Flagship Phone Ultra 5G", price: "₹49,999" },
    ];

    const evaluation = LocalSemanticReasoner.evaluate(products, {
      entity: "phone",
      comparison: { operation: "MIN", field: "price" },
    } as any);

    expect(evaluation.found).toBe(true);
    expect(evaluation.title).toBe("Budget Phone Alpha 4G");
    expect(evaluation.price).toBe("₹6,499");
    expect(evaluation.rawPrice).toBe(6499);
    expect((evaluation.topOptions as any[])?.length).toBe(3);
    expect(evaluation.pricingNotice).toContain("Reported lowest displayed price");
  });
});
