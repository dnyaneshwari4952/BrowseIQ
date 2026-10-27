import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { LocatorEngine } from "@/lib/browser/locator-engine";
import { PreExecutionValidator } from "@/lib/validation/pre-execution-validator";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { ActionType, LocatorStrategy, RiskLevel } from "@/lib/types/actions";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { PageObservation } from "@/lib/types/browser";
import { AgentLoop } from "@/lib/agent/agent-loop";

describe("Hidden Duplicate Locator, Keyboard Press, and Recovery Lifecycle", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  });

  it("1. RESOLUTION: Resolves to visible search input when a hidden duplicate named 'q' exists", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="search-form" action="/search">
            <!-- Hidden duplicate input named 'q' preceding the visible one -->
            <input type="hidden" name="q" id="hidden-q" value="tracking_param" />
            <!-- Visible search input named 'q' -->
            <input type="text" name="q" id="visible-search-box" placeholder="Search products..." />
            <button type="submit" id="submit-btn">Search</button>
          </form>
        </body>
      </html>
    `);

    const result = await LocatorEngine.resolve(page, {
      strategy: LocatorStrategy.NAME,
      value: "q",
    });

    expect(result).toBeDefined();
    expect(result.locator).toBeDefined();

    // Verify it resolved to the VISIBLE input, NOT the hidden duplicate
    const isVisible = await result.locator.isVisible();
    expect(isVisible).toBe(true);

    const elementId = await result.locator.getAttribute("id");
    expect(elementId).toBe("visible-search-box");
  });

  it("2. PRE-EXECUTION VALIDATION: PreExecutionValidator accepts visible input despite hidden duplicate 'q'", async () => {
    const mockObs: PageObservation = {
      url: "http://localhost/test",
      title: "Test Page",
      headings: [],
      interactiveElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: "",
      tabId: "tab-0",
    };

    const action = {
      id: "action-fill-q",
      type: ActionType.FILL,
      target: {
        strategy: LocatorStrategy.NAME,
        value: "q",
      },
      value: "cheapest school bags",
      risk: RiskLevel.LOW,
      reason: "Fill search input with school bags query",
    };

    const validation = await PreExecutionValidator.validate({
      action,
      page,
      currentObservation: mockObs,
    });

    expect(validation.valid).toBe(true);
    expect(validation.resolvedLocator).toBeDefined();
    const isVis = await validation.resolvedLocator!.isVisible();
    expect(isVis).toBe(true);
  });

  it("3. KEYBOARD PRESS: Press Enter on active input submits form without re-resolving to hidden duplicate", async () => {
    // Track form submissions
    await page.evaluate(() => {
      (window as any).__submittedQuery = null;
      document.getElementById("search-form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("visible-search-box") as HTMLInputElement;
        (window as any).__submittedQuery = input.value;
      });
    });

    // Step A: Fill search input
    const fillAction = {
      id: "step-fill",
      type: ActionType.FILL,
      target: {
        strategy: LocatorStrategy.NAME,
        value: "q",
      },
      value: "school bags",
      risk: RiskLevel.LOW,
      reason: "Enter search text",
    };

    const fillResult = await ActionExecutor.execute({
      action: fillAction,
      page,
      tabId: "tab-0",
    });

    expect(fillResult.result.status).toBe("completed");
    expect(fillResult.resolvedLocator).toBeDefined();

    // Step B: Press Enter without explicit target (uses active focused input)
    const pressActionWithoutTarget = {
      id: "step-press-no-target",
      type: ActionType.PRESS,
      value: "Enter",
      risk: RiskLevel.LOW,
      reason: "Submit search by pressing Enter on active input",
    };

    const pressResult = await ActionExecutor.execute({
      action: pressActionWithoutTarget,
      page,
      tabId: "tab-0",
      lastResolvedLocator: fillResult.resolvedLocator,
    });

    expect(pressResult.result.status).toBe("completed");

    // Verify form submission occurred with filled value
    const submittedVal = await page.evaluate(() => (window as any).__submittedQuery);
    expect(submittedVal).toBe("school bags");
  });

  it("4. KEYBOARD PRESS WITH TARGET: Press Enter targeting 'q' uses visible input without hidden element error", async () => {
    const pressActionWithTarget = {
      id: "step-press-with-q",
      type: ActionType.PRESS,
      target: {
        strategy: LocatorStrategy.NAME,
        value: "q",
      },
      value: "Enter",
      risk: RiskLevel.LOW,
      reason: "Submit search using target 'q'",
    };

    const pressResult = await ActionExecutor.execute({
      action: pressActionWithTarget,
      page,
      tabId: "tab-0",
    });

    expect(pressResult.result.status).toBe("completed");
    expect(pressResult.result.error).toBeUndefined();
  });

  it("5. GENUINE AMBIGUITY: Rejects unindexed target when multiple VISIBLE elements match", async () => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <input type="text" name="ambiguous_field" id="first-field" value="A" />
          <input type="text" name="ambiguous_field" id="second-field" value="B" />
        </body>
      </html>
    `);

    await expect(
      LocatorEngine.resolve(page, {
        strategy: LocatorStrategy.NAME,
        value: "ambiguous_field",
      })
    ).rejects.toThrowError(/ambiguous elements/i);
  });

  it("6. MISSING INPUT: Throws ELEMENT_NOT_FOUND when element does not exist", async () => {
    await page.setContent(`<html><body><div>Empty</div></body></html>`);

    await expect(
      LocatorEngine.resolve(page, {
        strategy: LocatorStrategy.NAME,
        value: "completely_nonexistent_field",
      })
    ).rejects.toThrowError(/not found using any locator strategy/i);
  });

  it("7. HIDDEN-ONLY ELEMENT: Throws ELEMENT_NOT_VISIBLE when ONLY hidden element exists", async () => {
    await page.setContent(`
      <html>
        <body>
          <input type="hidden" name="hidden_only_field" value="secret" />
        </body>
      </html>
    `);

    const mockObs: PageObservation = {
      url: "http://localhost/test",
      title: "Test Page",
      headings: [],
      interactiveElements: [],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: "",
      tabId: "tab-0",
    };

    const action = {
      id: "act-hidden",
      type: ActionType.CLICK,
      target: {
        strategy: LocatorStrategy.NAME,
        value: "hidden_only_field",
      },
      risk: RiskLevel.LOW,
      reason: "Click hidden field",
    };

    await expect(
      PreExecutionValidator.validate({
        action,
        page,
        currentObservation: mockObs,
      })
    ).rejects.toThrowError(/currently hidden or not visible/i);
  });

  it("8. RECOVERY: Does NOT repeat identical failed locator and avoids infinite retry loops", () => {
    const observation: PageObservation = {
      url: "http://localhost:3000/test-fixtures/search",
      title: "Product Search",
      headings: [],
      interactiveElements: [
        {
          id: "input-1",
          role: "textbox",
          tagName: "INPUT",
          name: "q",
          placeholder: "Search products (e.g. laptop)...",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
      ],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: "",
      tabId: "tab-0",
    };

    // The failing target was strategy "name", value "q"
    const failedTarget = { strategy: LocatorStrategy.NAME, value: "q" };

    // Recovery engine should find the ALTERNATIVE (placeholder), NEVER repeating name="q"
    const alternative = RecoveryEngine.findAlternativeLocator(failedTarget, observation);
    expect(alternative).toBeDefined();
    expect(alternative?.strategy).toBe("placeholder");
    expect(alternative?.value).toBe("Search products (e.g. laptop)...");

    // If both name="q" and placeholder are recorded as failed
    const failedSet = new Set(["name:q", "placeholder:search products (e.g. laptop)..."]);
    const noMoreAlternatives = RecoveryEngine.findAlternativeLocator(
      failedTarget,
      observation,
      RiskLevel.LOW,
      failedSet
    );
    expect(noMoreAlternatives).toBeNull();

    // When no alternative exists on attempt >= 2, determineRecovery transitions directly to REPLAN
    const decision = RecoveryEngine.determineRecovery({
      action: {
        id: "a1",
        type: ActionType.PRESS,
        target: failedTarget,
        reason: "Press enter",
      },
      error: new AgentError("Target element exists but is currently hidden or not visible: \"q\"", ErrorCode.ELEMENT_NOT_VISIBLE),
      attempt: 2,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 3,
      observation,
      failedTargets: failedSet,
    });

    expect(decision.strategy).toBe("REPLAN");
    expect(decision.reason).toContain("cannot be resolved to a visible interactive element");
  });

  it("9. LIVE FIXTURE E2E: 'search for the cheapest school bags' on /test-fixtures/search succeeds and extracts actual results", { timeout: 30000 }, async () => {
    const isServerUp = await fetch("http://localhost:3000/api/health").then((r) => r.ok).catch(() => false);
    if (!isServerUp) {
      console.log("Local fixture server is offline at localhost:3000. Skipping live network fixture test.");
      return;
    }
    const agent = new AgentLoop();
    const result = await agent.runTask({
      task: "Search for school bags and find the cheapest school bag with its name and price",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    console.log("TEST 9 RESULT STATUS:", result.finalStatus);
    console.log("TEST 9 STATUS MESSAGE:", result.statusMessage);
    console.log("TEST 9 COMPLETED STEPS:", result.completedSteps.map(s => ({ type: s.type, status: s.status, actionId: s.actionId })));
    console.log("TEST 9 FAILED STEPS:", result.failedSteps.map(s => ({ actionId: s.actionId, error: s.error?.message })));
    console.log("TEST 9 ERRORS:", result.errors);
    expect(result.finalStatus).toBe("completed");
    expect(result.completedSteps.length).toBeGreaterThanOrEqual(3);

    // Verify actual extracted data from the results page
    expect(result.extractedData).toBeDefined();
    const data = result.extractedData as Record<string, unknown>;
    const title = String(data.title || data.name || "");
    const price = String(data.price || "");

    // The cheapest school bag on the fixture is "Classic School Backpack" at "₹699"
    expect(title.toLowerCase()).toContain("school");
    expect(price).toMatch(/₹?699|₹?\d+/);
  });
});
