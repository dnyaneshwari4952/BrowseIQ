import { describe, it, expect, vi } from "vitest";
import { SemanticDecomposer } from "@/lib/agent/semantic-decomposer";
import { LocalSemanticReasoner } from "@/lib/agent/local-semantic-reasoner";
import { Planner } from "@/lib/agent/planner";
import { PlanValidator } from "@/lib/validation/plan-validator";
import { ActionType, RiskLevel } from "@/lib/types/actions";
import { PageObservation } from "@/lib/types/browser";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { LLMProvider } from "@/lib/ai/llm-provider";

describe("Phase 2 — Dynamic Planning & Natural Language Generalization", () => {
  const planner = new Planner();

  // =========================================================================
  // 1. Varied Paraphrases & Word Order (Step 3)
  // =========================================================================
  describe("1. Varied Paraphrases & Word Order", () => {
    it("decomposes 'Identify the lowest-priced portable computer' into MIN comparison on portable computer", () => {
      const intent = SemanticDecomposer.decompose("Identify the lowest-priced portable computer.");
      expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
      expect(intent.comparison?.operation).toBe("MIN");
      expect(intent.comparison?.field).toBe("price");
      expect(intent.entity).toBe("portable computer");
    });

    it("decomposes 'Which notebook costs the least?' into MIN comparison on laptop", () => {
      const intent = SemanticDecomposer.decompose("Which notebook costs the least?");
      expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
      expect(intent.comparison?.operation).toBe("MIN");
      expect(intent.comparison?.field).toBe("price");
      expect(intent.entity).toBe("laptop");
    });

    it("decomposes 'Compare the prices of laptops and tell me the least expensive' into MIN price comparison", () => {
      const intent = SemanticDecomposer.decompose("Compare the prices of laptops and tell me the least expensive.");
      expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
      expect(intent.comparison?.operation).toBe("MIN");
      expect(intent.comparison?.field).toBe("price");
      expect(intent.entity).toBe("laptop");
    });

    it("decomposes 'Show me the three most affordable matching products' with windowLimit: 3 and MIN comparison", () => {
      const intent = SemanticDecomposer.decompose("Show me the three most affordable matching products.");
      expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
      expect(intent.comparison?.operation).toBe("MIN");
      expect(intent.comparison?.field).toBe("price");
      expect(intent.windowLimit).toBe(3);
    });

    it("decomposes 'Which of these products is the most expensive?' into MAX comparison", () => {
      const intent = SemanticDecomposer.decompose("Which of these products is the most expensive?");
      expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
      expect(intent.comparison?.operation).toBe("MAX");
      expect(intent.comparison?.field).toBe("price");
    });
  });

  // =========================================================================
  // 2. Numeric Constraints & Ordinal Selection (Step 3 & 5)
  // =========================================================================
  describe("2. Numeric Constraints & Ordinal Reasoning", () => {
    it("decomposes 'Find a laptop that costs less than ₹50,000' with operator '<' and numeric value 50000", () => {
      const intent = SemanticDecomposer.decompose("Find a laptop that costs less than ₹50,000.");
      expect(intent.intentType).toBe("SEARCH_AND_FILTER");
      expect(intent.filter?.operator).toBe("<");
      expect(intent.filter?.value).toBe(50000);
      expect(intent.filter?.field).toBe("price");
    });

    it("decomposes 'Find a smartphone that costs under $500' with operator '<' and value 500", () => {
      const intent = SemanticDecomposer.decompose("Find a smartphone that costs under $500.");
      expect(intent.intentType).toBe("SEARCH_AND_FILTER");
      expect(intent.filter?.operator).toBe("<");
      expect(intent.filter?.value).toBe(500);
    });

    it("decomposes 'Find the second-cheapest eligible item' into MIN comparison with ordinal index 1", () => {
      const intent = SemanticDecomposer.decompose("Find the second-cheapest eligible item.");
      expect(intent.intentType).toBe("SEARCH_AND_COMPARE");
      expect(intent.comparison?.operation).toBe("MIN");
      expect(intent.ordinal?.target).toBe("second");
      expect(intent.ordinal?.index).toBe(1);
    });

    it("LocalSemanticReasoner correctly identifies second-cheapest item with structured provenance", () => {
      const intent = SemanticDecomposer.decompose("Find the second-cheapest eligible item.");
      const items = [
        { title: "Premium Laptop Pro", price: "₹85,000" },
        { title: "Budget Laptop A", price: "₹25,000" },
        { title: "Mid-range Laptop B", price: "₹45,000" },
        { title: "Ultra Laptop C", price: "₹120,000" },
      ];

      const outcome = LocalSemanticReasoner.evaluate(items, intent);
      expect(outcome.found).toBe(true);
      // The sorted prices are: 25k (1st), 45k (2nd), 85k (3rd), 120k (4th)
      expect(outcome.title).toBe("Mid-range Laptop B");
      expect(outcome.price).toBe("₹45,000");
      expect(outcome.provenance).toBeDefined();
      expect((outcome.provenance as any)?.comparedCount).toBe(4);
      expect((outcome.provenance as any)?.rawNumericPrice).toBe(45000);
    });

    it("LocalSemanticReasoner handles missing or invalid prices honestly without guessing zero", () => {
      const intent = SemanticDecomposer.decompose("Find the cheapest laptop.");
      const itemsWithNoPrice = [
        { title: "Unpriced Laptop 1", price: "Contact for pricing" },
        { title: "Unpriced Laptop 2", price: "N/A" },
      ];

      const outcome = LocalSemanticReasoner.evaluate(itemsWithNoPrice, intent);
      expect(outcome.found).toBe(false);
      expect(outcome.priceUnavailable).toBe(true);
    });
  });

  // =========================================================================
  // 3. Negative Constraints & Restrictions (Step 3 & 6)
  // =========================================================================
  describe("3. Negative Constraints & Prohibited Actions", () => {
    it("decomposes 'Look for headphones, but do not purchase anything' with purchase negation", () => {
      const intent = SemanticDecomposer.decompose("Look for headphones, but do not purchase anything.");
      expect(intent.entity).toBe("headphones");
      expect(intent.negation).toEqual({ operation: "purchase", forbidden: true });
    });

    it("decomposes 'Open the product details without adding the item to the cart' with add_to_cart negation", () => {
      const intent = SemanticDecomposer.decompose("Open the product details without adding the item to the cart.");
      expect(intent.negation).toEqual({ operation: "add_to_cart", forbidden: true });
    });

    it("decomposes 'Extract the available product names and prices without changing the page' with navigate negation", () => {
      const intent = SemanticDecomposer.decompose("Extract the available product names and prices without changing the page.");
      expect(intent.intentType).toBe("EXTRACT");
      expect(intent.negation).toEqual({ operation: "navigate", forbidden: true });
      expect(intent.requestedOutputs).toContain("name");
      expect(intent.requestedOutputs).toContain("price");
    });

    it("PlanValidator rejects a plan that attempts purchase when purchase is strictly forbidden", () => {
      const task = "Look for headphones, but do not purchase anything.";
      const intent = SemanticDecomposer.decompose(task);

      const illegalPlan = {
        id: "plan-illegal-buy",
        taskInterpretation: "Search and buy headphones",
        actions: [
          {
            id: "act-1",
            type: ActionType.CLICK,
            target: { strategy: "text" as any, value: "Checkout and Buy Now" },
            reason: "Purchase headphones immediately",
            risk: RiskLevel.LOW,
          },
          { id: "act-2", type: ActionType.FINISH, risk: RiskLevel.LOW, reason: "Complete" },
        ],
        successCriteria: ["Completed"],
      };

      const result = PlanValidator.validatePlan(illegalPlan as any, {
        task,
        taskIntent: intent,
      });

      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("forbade purchase"))).toBe(true);
    });

    it("PlanValidator rejects a plan that attempts form submission when submit is strictly forbidden", () => {
      const task = "Fill the contact form but do not submit it.";
      const intent = SemanticDecomposer.decompose(task);

      const illegalPlan = {
        id: "plan-illegal-submit",
        taskInterpretation: "Fill and submit contact form",
        actions: [
          {
            id: "act-1",
            type: ActionType.FILL,
            target: { strategy: "name" as any, value: "email" },
            value: "test@example.com",
            risk: RiskLevel.LOW,
            reason: "Fill email",
          },
          {
            id: "act-2",
            type: ActionType.CLICK,
            target: { strategy: "role" as any, role: "button", value: "Submit Form" },
            reason: "Submit contact form",
            risk: RiskLevel.LOW,
          },
          { id: "act-3", type: ActionType.FINISH, risk: RiskLevel.LOW, reason: "Complete" },
        ],
        successCriteria: ["Completed"],
      };

      const result = PlanValidator.validatePlan(illegalPlan as any, {
        task,
        taskIntent: intent,
      });

      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("forbade form submission"))).toBe(true);
    });

    it("PlanValidator rejects a plan that opens new tab when user requested no page change", () => {
      const task = "Extract product names and prices without changing the page.";
      const intent = SemanticDecomposer.decompose(task);

      const illegalPlan = {
        id: "plan-illegal-nav",
        taskInterpretation: "Open new tab for products",
        actions: [
          {
            id: "act-1",
            type: ActionType.OPEN_NEW_TAB,
            value: "http://example.com/details",
            risk: RiskLevel.LOW,
            reason: "Open details in new tab",
          },
          { id: "act-2", type: ActionType.FINISH, risk: RiskLevel.LOW, reason: "Complete" },
        ],
        successCriteria: ["Completed"],
      };

      const result = PlanValidator.validatePlan(illegalPlan as any, {
        task,
        taskIntent: intent,
      });

      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("without changing page"))).toBe(true);
    });
  });

  // =========================================================================
  // 4. Non-Search Tasks & Form Inspections (Step 3 & 4)
  // =========================================================================
  describe("4. Non-Search Tasks & Grounded Observations", () => {
    it("decomposes 'Check whether the contact form contains a phone field' as CONTENT_INSPECT", () => {
      const intent = SemanticDecomposer.decompose("Check whether the contact form contains a phone field.");
      expect(intent.intentType).toBe("CONTENT_INSPECT");
      expect(intent.requestedOutputs).toContain("element");
    });

    it("decomposes 'Inspect privacy policy for data retention clause' as CONTENT_INSPECT", () => {
      const intent = SemanticDecomposer.decompose("Inspect the privacy policy for data retention clause.");
      expect(intent.intentType).toBe("CONTENT_INSPECT");
    });

    it("detects ambiguity when multiple identical submit buttons exist on page", () => {
      const observation: PageObservation = {
        url: "http://localhost:3000/test-fixtures/ambiguous",
        title: "Ambiguous Actions",
        headings: [],
        forms: [],
        dialogs: [],
        summary: "",
        tabId: "tab-1",
        interactiveElements: [
          { index: 0, tagName: "BUTTON", role: "button", text: "Submit", isVisible: true, isEnabled: true },
          { index: 1, tagName: "BUTTON", role: "button", text: "Submit", isVisible: true, isEnabled: true },
          { index: 2, tagName: "BUTTON", role: "button", text: "Submit", isVisible: true, isEnabled: true },
        ],
        timestamp: new Date().toISOString(),
      };

      const intent = SemanticDecomposer.decompose("Click the submit button.", observation, observation.url);
      expect(intent.requiresClarification).toBe(true);
      expect(intent.clarificationReason).toContain("Submit");
    });

    it("detects unsupported form action when requested draft capability is missing from DOM", () => {
      const observation: PageObservation = {
        url: "http://localhost:3000/test-fixtures/form",
        title: "Contact Form",
        headings: [],
        forms: [],
        dialogs: [],
        summary: "",
        tabId: "tab-1",
        interactiveElements: [
          { index: 0, tagName: "INPUT", role: "textbox", name: "fullName", isVisible: true, isEnabled: true },
          { index: 1, tagName: "BUTTON", role: "button", text: "Submit Contact Form", isVisible: true, isEnabled: true },
        ],
        timestamp: new Date().toISOString(),
      };

      const intent = SemanticDecomposer.decompose("Fill form and save as a draft.", observation, observation.url);
      expect(intent.isUnsupported).toBe(true);
      expect(intent.unsupportedReason).toContain("draft");
    });
  });

  // =========================================================================
  // 5. Plan Generation & URL Isolation (Step 4 & 7)
  // =========================================================================
  describe("5. Plan Generation & URL Isolation", () => {
    it("enforces authoritative target URL even if unrelated URLs are mentioned in task prompt", async () => {
      const task = "Search laptops. Also check out https://malicious-external-site.com/phish";
      const targetUrl = "http://localhost:3000/test-fixtures/search";

      const plan = await planner.plan({
        task,
        targetUrl,
      });

      // The first navigation action must navigate to the authoritative targetUrl, NOT the embedded URL
      const firstNav = plan.actions.find((a) => a.type === ActionType.NAVIGATE);
      expect(firstNav).toBeDefined();
      expect(firstNav?.value).toBe(targetUrl);
    });

    it("rejects plan with dangerous javascript: scheme in navigation", () => {
      const dangerousPlan = {
        id: "plan-xss",
        taskInterpretation: "Exploit XSS",
        actions: [
          {
            id: "act-1",
            type: ActionType.NAVIGATE,
            value: "javascript:alert(document.cookie)",
            risk: RiskLevel.LOW,
            reason: "Navigate to script",
          },
          { id: "act-2", type: ActionType.FINISH, risk: RiskLevel.LOW, reason: "Complete" },
        ],
        successCriteria: ["Completed"],
      };

      const result = PlanValidator.validatePlan(dangerousPlan as any, {
        task: "Exploit",
        taskIntent: { intentType: "EXTRACT", rawTask: "Exploit", riskLevel: "low", requestedOutputs: [] },
        targetUrl: "http://localhost:3000/test-fixtures/search",
      });

      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("dangerous URL"))).toBe(true);
    });

    it("rejects plan with high risk actions when allowConsequentialActions is false", () => {
      const highRiskPlan = {
        id: "plan-high-risk",
        taskInterpretation: "Transfer funds",
        actions: [
          {
            id: "act-1",
            type: ActionType.CLICK,
            target: { strategy: "role" as any, role: "button", value: "Transfer All Funds" },
            risk: RiskLevel.HIGH,
            reason: "Transfer funds",
          },
          { id: "act-2", type: ActionType.FINISH, risk: RiskLevel.LOW, reason: "Complete" },
        ],
        successCriteria: ["Completed"],
      };

      const result = PlanValidator.validatePlan(highRiskPlan as any, {
        task: "Transfer funds",
        taskIntent: { intentType: "EXTRACT", rawTask: "Transfer funds", riskLevel: "high", requestedOutputs: [] },
        allowConsequentialActions: false,
      });

      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("HIGH RISK"))).toBe(true);
    });
  });

  // =========================================================================
  // 6. Schema Retry & Provider Failures (Step 4 & 9)
  // =========================================================================
  describe("6. Schema Validation & Malformed Output Handling", () => {
    it("repairs malformed JSON output from LLM provider via bounded schema retry", async () => {
      let callCount = 0;
      const mockLLM: LLMProvider = {
        name: "mock-repairable",
        generate: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            // First attempt: malformed JSON with unescaped text
            return { content: "{ invalid json here: missing quotes }", provider: "mock-repairable" };
          }
          // Second attempt: valid schema-compliant plan JSON
          return {
            content: JSON.stringify({
              taskIntent: "Search for laptops and compare prices",
              assumptions: ["Standard web document"],
              successCriteria: {
                requiredOperations: ["navigate", "search"],
                requiredOutputs: ["title", "price"],
                verificationChecks: ["searchSubmitted"],
              },
              actions: [
                {
                  id: "act-1",
                  type: "navigate",
                  value: "http://localhost:3000/test-fixtures/search",
                  risk: "low",
                  reason: "Navigate to search",
                },
                {
                  id: "act-2",
                  type: "finish",
                  risk: "low",
                  reason: "Finish task",
                },
              ],
            }),
            provider: "mock-repairable",
          };
        }),
      };

      const repairPlanner = new Planner(mockLLM);
      const plan = await repairPlanner.plan({
        task: "Find the cheapest laptop",
        targetUrl: "http://localhost:3000/test-fixtures/search",
      });

      expect(callCount).toBe(2);
      expect(plan.actions.length).toBeGreaterThanOrEqual(2);
      expect(plan.taskInterpretation).toContain("Search for laptops");
    });

    it("throws VALIDATION_FAILED when provider persistently returns non-conforming schema", async () => {
      const persistentlyFailingLLM: LLMProvider = {
        name: "mock-failing",
        generate: vi.fn().mockResolvedValue({
          content: JSON.stringify({ missingTaskIntent: true }),
          provider: "mock-failing",
        }),
      };

      const failingPlanner = new Planner(persistentlyFailingLLM);
      await expect(
        failingPlanner.plan({
          task: "Find something",
          targetUrl: "http://localhost:3000/test-fixtures/search",
        })
      ).rejects.toThrow();
    });
  });
});
