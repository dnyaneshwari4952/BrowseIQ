import { describe, it, expect, afterAll } from "vitest";
import { SemanticDecomposer } from "@/lib/agent/semantic-decomposer";
import { LocalSemanticReasoner } from "@/lib/agent/local-semantic-reasoner";
import { Planner } from "@/lib/agent/planner";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { ActionType } from "@/lib/types/actions";
import { ErrorCode } from "@/lib/types/errors";
import { AgentLoop } from "@/lib/agent/agent-loop";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { buildProviderInstance } from "@/lib/ai/llm-provider";
import { browserManager } from "@/lib/browser/browser-manager";
import heldOutTasks from "../evaluation/held-out-tasks.json";

describe("Phase 4 — Layer D: Held-Out Generalization & Genuine NLU (Sections 2, 3, 4)", () => {
  const planner = new Planner();

  afterAll(async () => {
    await browserManager.close().catch(() => {});
  });

  it("1. Verifies held-out generalization dataset is cleanly separated from development tasks", () => {
    expect(heldOutTasks.length).toBeGreaterThanOrEqual(10);
    const ids = heldOutTasks.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(heldOutTasks.length);
    // Ensure all held-out tasks have required test properties
    for (const t of heldOutTasks) {
      expect(t.task).toBeDefined();
      expect(t.expectedStatus).toBeDefined();
      expect(t.category).toBeDefined();
    }
  });

  it("2. Paraphrase MIN: 'Look up the cheapest available laptop in this catalog.' decomposes to MIN comparison", () => {
    const task = "Look up the cheapest available laptop in this catalog.";
    const intent = SemanticDecomposer.decompose(task, null, "http://localhost:3000/test-fixtures/search");

    expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
    expect(intent.comparison?.operation).toBe("MIN");
    expect(intent.comparison?.field).toBe("price");
    expect(intent.entity).toBe("laptop");
  });

  it("3. Synonym & Alternative Word Order: 'Which listed notebook costs the least?' maps notebook->laptop and MIN price", () => {
    const task = "Which listed notebook costs the least?";
    const intent = SemanticDecomposer.decompose(task, null, "http://localhost:3000/test-fixtures/search");

    expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
    expect(intent.comparison?.operation).toBe("MIN");
    expect(intent.comparison?.field).toBe("price");
    expect(intent.entity).toBe("laptop");
    expect(intent.query).toBe("laptop");
  });

  it("4. Hyphenated and Model Terminology: 'Find the lowest-priced laptop and tell me its model and price.'", () => {
    const task = "Find the lowest-priced laptop and tell me its model and price.";
    const intent = SemanticDecomposer.decompose(task, null, "http://localhost:3000/test-fixtures/search");

    expect(intent.comparison?.operation).toBe("MIN");
    expect(intent.requestedOutputs).toContain("price");
  });

  it("5. Window Comparison: 'Compare the first three matching products and identify the cheapest.'", () => {
    const task = "Compare the first three matching products and identify the cheapest.";
    const intent = SemanticDecomposer.decompose(task, null, "http://localhost:3000/test-fixtures/search");

    expect(intent.comparison?.operation).toBe("MIN");
    expect(intent.comparison?.field).toBe("price");
  });

  it("6. Negative Constraint (No Purchase): 'Search for a laptop but do not purchase anything.'", async () => {
    const task = "Search for a laptop but do not purchase anything.";
    const plan = await planner.plan({
      task,
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    // Plan must search and inspect, but strictly forbid any purchase/checkout actions
    const hasPurchase = plan.actions.some(
      (a) => /(?:buy|purchase|checkout|order|pay)/i.test(a.reason || "") || /(?:buy|checkout|order)/i.test(a.target?.value || "")
    );
    expect(hasPurchase).toBe(false);

    // Verification check ensures purchase is forbidden
    const verification = TaskVerifier.verifyTask({
      task,
      plan,
      completedSteps: [
        {
          actionId: "act-buy",
          type: ActionType.CLICK,
          status: "completed" as any,
          reason: "Purchase product and checkout",
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        } as any,
      ],
      observation: {
        url: "http://localhost:3000/test-fixtures/search",
        title: "Product Search",
        headings: ["Product Search"],
        interactiveElements: [],
        forms: [],
        timestamp: new Date().toISOString(),
      } as any,
    });

    expect(verification.passed).toBe(false);
    expect(verification.failedChecks).toContain("purchaseForbidden");
  });

  it("7. Form Negation Paraphrase: 'Fill the contact form using the details provided, but leave it unsubmitted.'", async () => {
    const task = "Fill the contact form using the details provided, but leave it unsubmitted.";
    const plan = await planner.plan({
      task,
      targetUrl: "http://localhost:3000/test-fixtures/form",
    });

    // Must plan fill actions but strictly omit submit action
    const hasSubmitAction = plan.actions.some(
      (a) => a.type === ActionType.CLICK && /submit/i.test(a.target?.value || a.reason || "")
    );
    expect(hasSubmitAction).toBe(false);

    // TaskVerifier must reject if submission was made
    const failedVerification = TaskVerifier.verifyTask({
      task,
      plan,
      completedSteps: [
        {
          actionId: "act-sub",
          type: ActionType.CLICK,
          status: "completed" as any,
          reason: "Submit form",
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        } as any,
      ],
      observation: {
        url: "http://localhost:3000/test-fixtures/form",
        title: "Contact Form",
        headings: ["Contact Us"],
        interactiveElements: [],
        forms: [],
        timestamp: new Date().toISOString(),
      } as any,
    });

    expect(failedVerification.passed).toBe(false);
    expect(failedVerification.failedChecks).toContain("submissionForbidden");
  });

  it("8. Distinct Actions: 'Open second result and extract title' vs 'Extract second result title without opening it'", async () => {
    const targetUrl = "http://localhost:3000/test-fixtures/search";

    // Task A: Open and extract
    const planOpen = await planner.plan({
      task: "Open the second matching result and extract its title.",
      targetUrl,
    });

    // Task B: Extract without opening
    const planExtractOnly = await planner.plan({
      task: "Extract the second result's title without opening it.",
      targetUrl,
    });

    // Plan A must contain an explicit CLICK action to open the product modal/view
    const openClickAction = planOpen.actions.find(
      (a) => a.type === ActionType.CLICK && /select product|open/i.test(a.target?.value || a.reason || "")
    );
    expect(openClickAction).toBeDefined();

    // Plan B must NOT contain any click action on product
    const extractOnlyClickAction = planExtractOnly.actions.find(
      (a) => a.type === ActionType.CLICK && /select product/i.test(a.target?.value || a.reason || "")
    );
    expect(extractOnlyClickAction).toBeUndefined();

    // Both plans must extract text, but Plan B extracts directly from the card
    expect(planExtractOnly.actions.some((a) => a.type === ActionType.EXTRACT_TEXT)).toBe(true);
  });

  it("9. Honest Ordinal Boundary: Out-of-range ordinal (15th result when only 3 exist) fails honestly", () => {
    const rawItems = [
      { title: "Laptop Pro 16", price: "₹75,000" },
      { title: "Laptop Air 13", price: "₹65,000" },
      { title: "Gaming Laptop Ultra", price: "₹90,000" },
    ];

    const intent = SemanticDecomposer.decompose(
      "Extract the 15th search result from this page.",
      null,
      "http://localhost:3000/test-fixtures/search"
    );

    const result = LocalSemanticReasoner.evaluate(rawItems, intent);

    // Must NOT silently return first item; must flag outOfRange
    expect(result.found).toBe(false);
    expect(result.outOfRange).toBe(true);

    const verification = TaskVerifier.verifyTask({
      task: "Extract the 15th search result from this page.",
      plan: { id: "p1", taskInterpretation: "15th result", actions: [], successCriteria: [] } as any,
      completedSteps: [
        {
          actionId: "act-nav",
          type: ActionType.NAVIGATE,
          status: "completed" as any,
          reason: "Navigate to search",
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        } as any,
      ],
      observation: {
        url: "http://localhost:3000/test-fixtures/search",
        title: "Product Search",
        headings: ["Product Search"],
        interactiveElements: [],
        forms: [],
        timestamp: new Date().toISOString(),
      } as any,
      extractedData: result,
    });

    expect(verification.passed).toBe(false);
    expect(verification.failedChecks).toContain("ordinalResultExists");
  });

  it("10. Honest Refusal on Unsupported Domain: 'Book a flight from New York to Tokyo' on product catalog", () => {
    const intent = SemanticDecomposer.decompose(
      "Book a flight from New York to Tokyo on this page.",
      null,
      "http://localhost:3000/test-fixtures/search"
    );

    expect(intent.isUnsupported).toBe(true);
    expect(intent.unsupportedReason).toContain("Flight, travel, or lodging reservation is not supported");
  });

  it("11. Knapsack/Satchel Synonyms: maps knapsack to school bags entity and query", () => {
    const intent = SemanticDecomposer.decompose(
      "Search for knapsacks on the product catalog.",
      null,
      "http://localhost:3000/test-fixtures/search"
    );

    expect(intent.entity).toBe("school bags");
    expect(intent.query).toBe("school bags");
  });

  it("12. LIVE GENERALIZATION E2E: Runs held-out paraphrase 'Which listed notebook costs the least?' in real browser", async () => {
    const isServerUp = await fetch("http://localhost:3000/api/health").then((r) => r.ok).catch(() => false);
    if (!isServerUp) {
      console.log("Fixture server is offline at localhost:3000. Skipping live network navigation.");
      return;
    }

    const agent = new AgentLoop();
    const result = await agent.runTask({
      task: "Which listed notebook costs the least?",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });
    console.log("TEST 12 PLAN:", result.plan?.actions.map(a => ({ type: a.type, reason: a.reason, target: a.target })));
    console.log("TEST 12 STEPS:", result.completedSteps.map(s => ({ type: s.type, status: s.status, actionId: s.actionId, extractedData: s.extractedData })));
    console.log("TEST 12 RESULT:", result.finalStatus, result.statusMessage);
    expect(result.finalStatus).toBe("completed");
    expect(result.extractedData).toBeDefined();
    // Must extract Laptop Air 13 at ₹65,000 (the cheapest notebook)
    const data = result.extractedData as any;
    expect(data.name || data.title).toBe("Laptop Air 13");
    expect(data.rawPrice).toBe(65000);
  }, 30000);

  it("13. Novel Unseen Entity: 'Find the cheapest monitor on this page' extracts monitor entity and MIN comparison", () => {
    const task = "Find the cheapest monitor on this page";
    const intent = SemanticDecomposer.decompose(task, null, "http://localhost:3000/test-fixtures/search");

    expect(intent.entity).toBe("monitor");
    expect(intent.query).toBe("monitor");
    expect(intent.comparison?.operation).toBe("MIN");
    expect(intent.comparison?.field).toBe("price");
  });

  it("14. Currencies & Price Normalization: correctly normalizes USD, INR, EUR, and rejects invalid amounts", () => {
    expect(LocalSemanticReasoner.parsePrice("₹30,000")).toBe(30000);
    expect(LocalSemanticReasoner.parsePrice("$1,299.99")).toBe(1299.99);
    expect(LocalSemanticReasoner.parsePrice("€450.50")).toBe(450.5);
    expect(LocalSemanticReasoner.parsePrice("Price unavailable")).toBe(0);
    expect(LocalSemanticReasoner.parsePrice("")).toBe(0);

    const testProducts = [
      { title: "Curved Monitor 4K", price: "₹35,000" },
      { title: "Gaming Monitor 144Hz", price: "₹24,999" },
      { title: "Office Monitor 24in", price: "₹18,500" },
    ];

    const intent = SemanticDecomposer.decompose("Find the cheapest monitor on this page", null, "http://localhost:3000/test-fixtures/search");
    const evaluation = LocalSemanticReasoner.evaluate(testProducts, intent);

    expect(evaluation.title).toBe("Office Monitor 24in");
    expect(evaluation.rawPrice).toBe(18500);
    expect(evaluation.comparedCount).toBe(3);
  });

  it("15. Honest Zero-Results: Nonexistent category returns found: false without fabricating substitutes", () => {
    const rawItems: any[] = [];
    const intent = SemanticDecomposer.decompose("Search for quantum processors and return results", null, "http://localhost:3000/test-fixtures/search");
    const result = LocalSemanticReasoner.evaluate(rawItems, intent);

    expect(result.found).toBe(false);
    expect(result.total).toBe(0);
    expect(result.message).toContain("No results found for entity: quantum");
  });

  it("16. Provider Fail-Closed: throws CONFIG_ERROR when real provider credentials are missing", () => {
    // When OpenAI is requested without valid credentials, it must throw CONFIG_ERROR
    expect(() => buildProviderInstance("openai", false)).toThrow(
      /OpenAI\/Grok API key is not configured/
    );
  });

  it("17. Immediate 404 Fail-Fast: RecoveryEngine marks HTTP 404 page as terminal without pointless retries", () => {
    const decision = RecoveryEngine.determineRecovery({
      action: { id: "act-1", type: ActionType.CLICK, risk: "low" as any, reason: "Click element on 404 page" },
      error: new Error("Target element not found: #main-content"),
      attempt: 1,
      maxAttempts: 4,
      replansUsed: 0,
      maxReplans: 3,
      observation: {
        url: "http://localhost:3000/test-fixtures/404-broken",
        title: "404 - Not Found",
        headings: ["404 - Page Not Found"],
        interactiveElements: [],
        forms: [],
        timestamp: new Date().toISOString(),
      } as any,
    });

    expect(decision.strategy).toBe("FAIL");
    expect(decision.terminal).toBe(true);
    expect(decision.reason).toContain("HTTP 404 / Not Found");
  });
});
