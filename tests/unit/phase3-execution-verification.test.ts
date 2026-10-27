import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BrowserManager } from "@/lib/browser/browser-manager";
import { ActionExecutor } from "@/lib/browser/action-executor";
import { LocatorEngine } from "@/lib/browser/locator-engine";
import { PreExecutionValidator } from "@/lib/validation/pre-execution-validator";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { Action, ActionType, ActionStatus, LocatorStrategy, RiskLevel } from "@/lib/types/actions";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { PageObservation } from "@/lib/types/browser";

describe("PHASE 3: Production-Grade Browser Execution, Dynamic Locators, Recovery & Task Verification", () => {
  // =========================================================================
  // GROUP 1: Dynamic Locator Selection, Scoring, Scoping, and Ambiguity
  // =========================================================================
  describe("Group 1: Dynamic Locator Selection & Scoring", () => {
    it("resolves unique visible element and computes calibrated confidence with reason", async () => {
      const mockLocator = {
        count: vi.fn().mockResolvedValue(1),
        nth: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        }),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        }),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue(mockLocator),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      } as any;

      const result = await LocatorEngine.resolve(mockPage, {
        strategy: LocatorStrategy.ROLE,
        value: "Search",
        role: "button",
      });

      expect(result.locator).toBeDefined();
      expect(result.strategyUsed).toBe(LocatorStrategy.ROLE);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reason).toContain("role");
      expect(result.allCandidates.length).toBeGreaterThan(0);
    });

    it("throws ELEMENT_AMBIGUOUS when multiple visible candidates match without index", async () => {
      const mockMultiLocator = {
        count: vi.fn().mockResolvedValue(3),
        nth: vi.fn().mockImplementation(() => ({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        })),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        }),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue(mockMultiLocator),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      } as any;

      await expect(
        LocatorEngine.resolve(mockPage, {
          strategy: LocatorStrategy.ROLE,
          value: "Submit",
          role: "button",
        })
      ).rejects.toThrowError(/ambiguous elements/i);
    });

    it("scopes locator resolution inside specified container", async () => {
      const mockContainerLocator = {
        getByRole: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          nth: vi.fn().mockReturnValue({
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          }),
          first: vi.fn().mockReturnValue({
            isVisible: vi.fn().mockResolvedValue(true),
            isEnabled: vi.fn().mockResolvedValue(true),
          }),
        }),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        locator: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      };

      const mockPage = {
        locator: vi.fn().mockImplementation((selector: string) => {
          if (selector === "#checkout-modal") return mockContainerLocator;
          return { count: vi.fn().mockResolvedValue(0) };
        }),
      } as any;

      const result = await LocatorEngine.resolve(mockPage, {
        strategy: LocatorStrategy.ROLE,
        value: "Confirm Order",
        role: "button",
        container: "#checkout-modal",
      });

      expect(mockPage.locator).toHaveBeenCalledWith("#checkout-modal");
      expect(result.strategyUsed).toBe(LocatorStrategy.ROLE);
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it("throws ELEMENT_NOT_FOUND when target does not exist on page", async () => {
      const mockEmptyLocator = {
        count: vi.fn().mockResolvedValue(0),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue(mockEmptyLocator),
        getByLabel: vi.fn().mockReturnValue(mockEmptyLocator),
        getByPlaceholder: vi.fn().mockReturnValue(mockEmptyLocator),
        getByText: vi.fn().mockReturnValue(mockEmptyLocator),
        getByTestId: vi.fn().mockReturnValue(mockEmptyLocator),
        locator: vi.fn().mockReturnValue(mockEmptyLocator),
      } as any;

      await expect(
        LocatorEngine.resolve(mockPage, {
          strategy: LocatorStrategy.TEXT,
          value: "Nonexistent Link",
        })
      ).rejects.toThrowError(/not found using any locator strategy/i);
    });
  });

  // =========================================================================
  // GROUP 2: Navigation & Action Stabilization
  // =========================================================================
  describe("Group 2: Navigation and Page Readiness", () => {
    it("detects HTTP 404 response as a terminal, non-retryable navigation failure", async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue("about:blank"),
        goto: vi.fn().mockResolvedValue({
          url: () => "http://localhost:3000/not-found",
          status: () => 404,
        }),
      } as any;

      const action: Action = {
        id: "nav-1",
        type: ActionType.NAVIGATE,
        value: "http://localhost:3000/not-found",
        reason: "Navigate to not-found",
      };

      const result = await ActionExecutor.execute({
        action,
        page: mockPage,
        tabId: "tab-test",
      });

      expect(result.result.status).toBe("failed");
      expect(result.result.error?.code).toBe(ErrorCode.NAVIGATION_FAILED);
      expect(result.result.error?.message).toContain("404");
    });

    it("detects HTTP 500 response as retryable server error", async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue("about:blank"),
        goto: vi.fn().mockResolvedValue({
          url: () => "http://localhost:3000/server-error",
          status: () => 500,
        }),
      } as any;

      const action: Action = {
        id: "nav-2",
        type: ActionType.NAVIGATE,
        value: "http://localhost:3000/server-error",
        reason: "Navigate to server-error",
      };

      const result = await ActionExecutor.execute({
        action,
        page: mockPage,
        tabId: "tab-test",
      });

      expect(result.result.status).toBe("failed");
      expect(result.result.error?.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(result.result.error?.message).toContain("500");
    });

    it("preserves final redirected destination URL and status", async () => {
      const mockPage = {
        url: vi.fn().mockReturnValue("http://localhost:3000/dest"),
        goto: vi.fn().mockResolvedValue({
          url: () => "http://localhost:3000/dest",
          status: () => 200,
        }),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        title: vi.fn().mockResolvedValue("Destination Page"),
      } as any;

      const action: Action = {
        id: "nav-3",
        type: ActionType.NAVIGATE,
        value: "http://localhost:3000/redirect-source",
        reason: "Navigate to redirect source",
      };

      const beforeObs: PageObservation = {
        url: "http://localhost:3000/home",
        title: "Redirecting...",
        headings: [],
        forms: [],
        dialogs: [],
        summary: "",
        tabId: "tab-test",
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      const result = await ActionExecutor.execute({
        action,
        page: mockPage,
        tabId: "tab-test",
        beforeObservation: beforeObs,
      });

      expect(result.result.status).toBe("completed");
      expect((result.result.extractedData as any)?.finalUrl).toBe("http://localhost:3000/dest");
      expect((result.result.extractedData as any)?.status).toBe(200);
    });
  });

  // =========================================================================
  // GROUP 3: Pre-Execution Just-In-Time Validation
  // =========================================================================
  describe("Group 3: Just-In-Time Action Validation", () => {
    it("blocks forbidden purchase clicks immediately before Playwright invocation", async () => {
      const mockLocator = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        isEnabled: vi.fn().mockResolvedValue(true),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue(mockLocator),
      } as any;

      const action: Action = {
        id: "act-buy",
        type: ActionType.CLICK,
        target: { strategy: LocatorStrategy.ROLE, value: "Buy Now", role: "button" },
        reason: "Purchase product",
      };

      const obs: PageObservation = {
        url: "http://localhost:3000/product/1",
        title: "Product Page",
        headings: [],
        forms: [],
        dialogs: [],
        summary: "",
        tabId: "tab-1",
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      await expect(
        PreExecutionValidator.validate({
          action,
          page: mockPage,
          currentObservation: obs,
          authorizedTask: "Find price of laptop without purchasing or buying",
        })
      ).rejects.toThrowError(/negative constraint forbidding purchases/i);
    });

    it("blocks forbidden submit actions immediately before execution", async () => {
      const mockLocator = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        isEnabled: vi.fn().mockResolvedValue(true),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue(mockLocator),
      } as any;

      const action: Action = {
        id: "act-submit",
        type: ActionType.CLICK,
        target: { strategy: LocatorStrategy.ROLE, value: "Submit Form", role: "button" },
        reason: "Submit the inquiry",
      };

      const obs: PageObservation = {
        url: "http://localhost:3000/contact",
        title: "Contact",
        headings: [],
        forms: [],
        dialogs: [],
        summary: "",
        tabId: "tab-1",
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      await expect(
        PreExecutionValidator.validate({
          action,
          page: mockPage,
          currentObservation: obs,
          authorizedTask: "Fill out the contact form but do not submit it",
        })
      ).rejects.toThrowError(/negative constraint forbidding form submission/i);
    });

    it("rejects FILL action when element is not an editable field", async () => {
      const mockNonEditableLocator = {
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(true),
        isEnabled: vi.fn().mockResolvedValue(true),
        evaluate: vi.fn().mockImplementation(async (fn: Function) => {
          return fn({ tagName: "BUTTON", isContentEditable: false });
        }),
      };

      const mockPage = {
        getByRole: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByLabel: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
        getByText: vi.fn().mockReturnValue({
          count: vi.fn().mockResolvedValue(1),
          nth: vi.fn().mockReturnValue(mockNonEditableLocator),
          first: vi.fn().mockReturnValue(mockNonEditableLocator),
        }),
        locator: vi.fn().mockReturnValue(mockNonEditableLocator),
        getByTestId: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
      } as any;

      const action: Action = {
        id: "act-fill-btn",
        type: ActionType.FILL,
        value: "sample text",
        target: { strategy: LocatorStrategy.TEXT, value: "Click Here" },
        reason: "Fill text into button",
      };

      const obs: PageObservation = {
        url: "http://localhost:3000/test",
        title: "Test",
        headings: [],
        forms: [],
        dialogs: [],
        summary: "",
        tabId: "tab-1",
        interactiveElements: [],
        timestamp: new Date().toISOString(),
      };

      await expect(
        PreExecutionValidator.validate({
          action,
          page: mockPage,
          currentObservation: obs,
          authorizedTask: "Enter text into input",
        })
      ).rejects.toThrowError(/cannot be performed on non-editable <button> element/i);
    });
  });

  // =========================================================================
  // GROUP 4: Intelligent Recovery & Structured Decision History
  // =========================================================================
  describe("Group 4: Recovery Decisions & Structured History", () => {
    it("halts immediately on confirmed 404 page without wasted retries", () => {
      const decision = RecoveryEngine.determineRecovery({
        action: { id: "a1", type: ActionType.NAVIGATE, value: "http://localhost:3000/404", reason: "Navigate to 404" },
        error: new AgentError("404 Not Found", ErrorCode.NAVIGATION_FAILED, false),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: {
          url: "http://localhost:3000/404",
          title: "404 - Page Not Found",
          headings: ["404 Not Found"],
          forms: [],
          dialogs: [],
          summary: "Error 404",
          tabId: "tab-1",
          interactiveElements: [],
          timestamp: new Date().toISOString(),
        },
      });

      expect(decision.strategy).toBe("FAIL");
      expect(decision.terminal).toBe(true);
      expect(decision.reason).toContain("404");
      expect(decision.record).toBeDefined();
      expect(decision.record?.evidence.is404).toBe(true);
      expect(decision.record?.anotherAttemptPermitted).toBe(false);
    });

    it("prohibits automated blind retry of side-effecting submit actions", () => {
      const decision = RecoveryEngine.determineRecovery({
        action: {
          id: "a2",
          type: ActionType.CLICK,
          target: { strategy: LocatorStrategy.ROLE, value: "Submit Application" },
          reason: "submit form",
        },
        error: new AgentError("Timeout waiting for response", ErrorCode.TIMEOUT, true),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
      });

      expect(decision.strategy).toBe("WAITING_FOR_USER");
      expect(decision.requiresConfirmation).toBe(true);
      expect(decision.reason).toContain("side-effecting");
      expect(decision.record).toBeDefined();
      expect(decision.record?.chosenStrategy).toBe("WAITING_FOR_USER");
    });

    it("generates structured RecoveryDecisionRecord with evidence and error category", () => {
      const decision = RecoveryEngine.determineRecovery({
        action: { id: "a3", type: ActionType.CLICK, target: { strategy: LocatorStrategy.ROLE, value: "Search" }, reason: "Click search" },
        error: new AgentError("Element not found", ErrorCode.ELEMENT_NOT_FOUND, true),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: {
          url: "http://localhost:3000/search",
          title: "Search Results",
          headings: ["Search"],
          forms: [],
          dialogs: [],
          summary: "",
          tabId: "tab-1",
          interactiveElements: [
            { id: "el-1", tagName: "BUTTON", role: "button", text: "Search", isVisible: true, isEnabled: true },
          ],
          timestamp: new Date().toISOString(),
        },
      });

      expect(decision.record).toBeDefined();
      expect(decision.record?.originalErrorCategory).toBe(ErrorCode.ELEMENT_NOT_FOUND);
      expect(decision.record?.currentUrl).toBe("http://localhost:3000/search");
      expect(decision.record?.evidence.pageTitle).toBe("Search Results");
      expect(decision.record?.evidence.attempt).toBe(1);
    });
  });

  // =========================================================================
  // GROUP 5: Independent Task Verification & False-Success Prevention
  // =========================================================================
  describe("Group 5: Task Verification & Explicit Outcome States", () => {
    it("reports outcome as blocked when target page presents a challenge", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search for shoes",
        completedSteps: [
          {
            actionId: "a1",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            verified: true,
            durationMs: 100,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
          },
        ],
        observation: {
          url: "https://example.com/challenge",
          title: "Just a moment... Cloudflare Turnstile Challenge",
          headings: ["Verify you are human"],
          forms: [],
          dialogs: [],
          summary: "CAPTCHA challenge",
          tabId: "tab-1",
          interactiveElements: [],
          timestamp: new Date().toISOString(),
        },
      });

      expect(result.passed).toBe(false);
      expect(result.outcome).toBe("blocked");
      expect(result.isBlocked).toBe(true);
      expect(result.evidence).toBeDefined();
      expect(result.evidence?.originalObjective).toBe("Search for shoes");
    });

    it("prevents false success when search results are empty", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search for 'Mechanical Keyboard'",
        completedSteps: [
          {
            actionId: "a1",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            verified: true,
            durationMs: 100,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
          },
          {
            actionId: "a2",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            verified: true,
            durationMs: 100,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
          },
          {
            actionId: "a3",
            type: ActionType.PRESS,
            status: ActionStatus.COMPLETED,
            verified: true,
            durationMs: 100,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
          },
        ],
        observation: {
          url: "http://localhost:3000/search?q=Mechanical+Keyboard",
          title: "Search Results",
          headings: ["No products found matching your search"],
          forms: [],
          dialogs: [],
          summary: "0 results",
          tabId: "tab-1",
          interactiveElements: [],
          timestamp: new Date().toISOString(),
        },
        extractedData: {},
      });

      expect(result.passed).toBe(false);
      expect(result.outcome).toBe("failed");
      expect(result.reason).toContain("empty or incomplete state");
    });

    it("returns partial_success outcome when primary action completed but optional secondary items missing", () => {
      const result = TaskVerifier.verifyTask({
        task: "Find 'Pro Laptop' and export comparison report",
        plan: {
          actions: [
            {
              id: "a1",
              type: ActionType.CLICK,
              reason: "search for Pro Laptop",
              target: { strategy: LocatorStrategy.ROLE, value: "Search" },
            },
          ],
          taskSuccessCriteria: {
            requiredOperations: ["search"],
            requiredOutputs: ["reportFile"],
            verificationChecks: ["searchSubmitted"],
          },
        },
        completedSteps: [
          {
            actionId: "a1",
            type: ActionType.CLICK,
            status: ActionStatus.COMPLETED,
            verified: true,
            durationMs: 100,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
          },
        ],
        extractedData: { title: "Pro Laptop", price: "₹75,000" },
        observation: {
          url: "http://localhost:3000/products",
          title: "Catalog",
          headings: ["Laptops", "Pro Laptop"],
          forms: [],
          dialogs: [],
          summary: "Product catalog",
          tabId: "tab-1",
          interactiveElements: [
            { id: "e1", tagName: "H3", text: "Pro Laptop", isVisible: true, isEnabled: true },
          ],
          timestamp: new Date().toISOString(),
        },
      });

      expect(result.passed).toBe(false);
      expect(result.outcome).toBe("partial_success");
      expect(result.evidence).toBeDefined();
      expect(result.evidence?.conditionsPassed).toContain("searchSubmitted");
      expect(result.missingOutputs).toContain("reportFile");
    });

    it("verifies success with full structured evidence on complete satisfaction", () => {
      const result = TaskVerifier.verifyTask({
        task: "Find the price of 'Pro Laptop'",
        plan: {
          actions: [
            {
              id: "a1",
              type: ActionType.CLICK,
              reason: "search for Pro Laptop",
              target: { strategy: LocatorStrategy.ROLE, value: "Search" },
            },
          ],
          taskSuccessCriteria: {
            requiredOperations: ["search"],
            requiredOutputs: ["price"],
            verificationChecks: ["searchSubmitted"],
          },
        },
        completedSteps: [
          {
            actionId: "a1",
            type: ActionType.CLICK,
            status: ActionStatus.COMPLETED,
            verified: true,
            durationMs: 100,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            retriesUsed: 0,
          },
        ],
        extractedData: { name: "Pro Laptop", price: "₹75,000" },
        observation: {
          url: "http://localhost:3000/products",
          title: "Products",
          headings: ["Pro Laptop - ₹75,000"],
          forms: [],
          dialogs: [],
          summary: "Product page",
          tabId: "tab-1",
          interactiveElements: [
            { id: "e1", tagName: "SPAN", text: "Pro Laptop", isVisible: true, isEnabled: true },
          ],
          timestamp: new Date().toISOString(),
        },
      });

      expect(result.passed).toBe(true);
      expect(result.outcome).toBe("success");
      expect(result.evidence?.originalObjective).toBe("Find the price of 'Pro Laptop'");
      expect(result.evidence?.finalUrl).toBe("http://localhost:3000/products");
      expect(result.evidence?.conditionsPassed).toContain("searchSubmitted");
      expect(result.missingOutputs.length).toBe(0);
    });
  });
});
