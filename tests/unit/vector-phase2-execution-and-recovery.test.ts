import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chromium, Browser, BrowserContext, Page, Locator } from "playwright";
import { BrowserManager } from "../../lib/browser/browser-manager";
import { PageObserver } from "../../lib/browser/page-observer";
import { LocatorEngine } from "../../lib/browser/locator-engine";
import { PreExecutionValidator } from "../../lib/validation/pre-execution-validator";
import { ActionExecutor } from "../../lib/browser/action-executor";
import { RecoveryEngine, mapToVectorCategory } from "../../lib/agent/recovery-engine";
import { LocalFileResolver } from "../../lib/local/local-file-resolver";
import { Action, ActionType, RiskLevel, LocatorStrategy } from "../../lib/types/actions";
import { ErrorCode, AgentError } from "../../lib/types/errors";
import { PageObservation } from "../../lib/types/browser";
import path from "path";

/**
 * Creates a mock Playwright Locator with full standard inspection and interaction methods.
 */
function createMockLocator(options?: {
  count?: number;
  visible?: boolean;
  enabled?: boolean;
  text?: string;
  value?: string;
  click?: any;
}): Locator {
  const count = options?.count ?? 1;
  const isVisible = options?.visible ?? true;
  const isEnabled = options?.enabled ?? true;
  const text = options?.text ?? "Target Element";
  const val = options?.value ?? "";
  const clickFn = options?.click ?? vi.fn().mockResolvedValue(undefined);

  const mockItem = {
    count: async () => 1,
    isVisible: async () => isVisible,
    isEnabled: async () => isEnabled,
    innerText: async () => text,
    inputValue: async () => val,
    getAttribute: async (attr: string) => (attr === "href" ? "https://example.com/item/1" : null),
    click: clickFn,
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation((fn: any) => fn({ tagName: "BUTTON", disabled: !isEnabled })),
    first: () => mockItem,
    nth: () => mockItem,
  };

  return {
    count: async () => count,
    isVisible: async () => isVisible,
    isEnabled: async () => isEnabled,
    innerText: async () => text,
    inputValue: async () => val,
    getAttribute: async (attr: string) => (attr === "href" ? "https://example.com/item/1" : null),
    click: clickFn,
    fill: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation((fn: any) => fn({ tagName: "BUTTON", disabled: !isEnabled })),
    first: () => mockItem,
    nth: (_index: number) => mockItem,
    allInnerTexts: async () => [text],
  } as unknown as Locator;
}

/**
 * Creates an isolated mock Playwright Page with full standard methods.
 */
function createMockPage(overrides?: Partial<Record<string, unknown>>): Page {
  let isPageClosed = false;
  const defaultLocator = createMockLocator();

  const mockPage = {
    url: () => "https://example.com/shop",
    title: async () => "Shop Page",
    goto: vi.fn().mockResolvedValue({ status: () => 200, url: () => "https://example.com/shop" }),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    isClosed: () => isPageClosed,
    close: vi.fn().mockImplementation(async () => {
      isPageClosed = true;
    }),
    on: vi.fn(),
    evaluate: vi.fn().mockResolvedValue({
      interactiveElements: [],
      headings: ["Shop Products"],
      forms: [],
      mediaElements: [],
      dialogs: [],
    }),
    getByRole: vi.fn().mockReturnValue(defaultLocator),
    getByLabel: vi.fn().mockReturnValue(defaultLocator),
    getByPlaceholder: vi.fn().mockReturnValue(defaultLocator),
    getByText: vi.fn().mockReturnValue(defaultLocator),
    getByTestId: vi.fn().mockReturnValue(defaultLocator),
    getByTitle: vi.fn().mockReturnValue(defaultLocator),
    locator: vi.fn().mockReturnValue(defaultLocator),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };

  return mockPage as unknown as Page;
}

/**
 * Creates an isolated mock Playwright Browser for unit test execution.
 */
function createMockBrowser(): Browser {
  let isBrowserClosed = false;
  return {
    isConnected: () => !isBrowserClosed,
    newContext: vi.fn().mockImplementation(async () => {
      let isContextClosed = false;
      const mockPage = createMockPage();

      return {
        newPage: vi.fn().mockResolvedValue(mockPage),
        isClosed: () => isContextClosed,
        close: vi.fn().mockImplementation(async () => {
          isContextClosed = true;
        }),
        on: vi.fn(),
        clearCookies: vi.fn().mockResolvedValue(undefined),
      };
    }),
    close: vi.fn().mockImplementation(async () => {
      isBrowserClosed = true;
    }),
    on: vi.fn(),
  } as unknown as Browser;
}

describe("PHASE 2: Visible Playwright Execution, Live DOM Grounding, Safety and Recovery", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(chromium, "launch").mockImplementation(async () => createMockBrowser());
  });

  afterEach(async () => {
    const manager = BrowserManager.getInstance();
    await manager.close().catch(() => {});
    vi.restoreAllMocks();
  });

  describe("1. Visible Browser Sessions & Task Isolation", () => {
    it("creates an isolated visible browser context and window per task without headless fallback", async () => {
      const manager = BrowserManager.getInstance();
      const session1 = await manager.createTaskSession("task-vec2-1");
      const session2 = await manager.createTaskSession("task-vec2-2");

      expect(session1.taskId).toBe("task-vec2-1");
      expect(session2.taskId).toBe("task-vec2-2");
      expect(session1.context).not.toBe(session2.context);
      expect(session1.windowOpen).toBe(true);
      expect(session2.windowOpen).toBe(true);

      // Verify Chromium was launched in visible mode (headless: false)
      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: false,
        })
      );
    });

    it("keeps the visible browser window open on task completion and failure for user inspection", async () => {
      const manager = BrowserManager.getInstance();
      const sessionSuccess = await manager.createTaskSession("task-inspect-success");
      manager.completeTaskSession("task-inspect-success", "completed");
      expect(manager.isWindowOpen("task-inspect-success")).toBe(true);

      const sessionFailure = await manager.createTaskSession("task-inspect-fail");
      manager.completeTaskSession("task-inspect-fail", "failed");
      expect(manager.isWindowOpen("task-inspect-fail")).toBe(true);

      // Windows are only closed on explicit user cancellation
      const sessionCancel = await manager.createTaskSession("task-inspect-cancel");
      manager.completeTaskSession("task-inspect-cancel", "cancelled");
      expect(manager.isWindowOpen("task-inspect-cancel")).toBe(false);
    });
  });

  describe("2. Live DOM Inspection & Progressive Resolution", () => {
    it("PageObserver extracts URL, headings, interactive elements, and form select options", async () => {
      const mockPage = createMockPage({
        url: () => "https://example.com/checkout",
        title: async () => "Checkout Form",
        evaluate: vi.fn().mockResolvedValue({
          interactiveElements: [
            {
              id: "submit-btn",
              role: "button",
              tagName: "BUTTON",
              text: "Place Order",
              isVisible: true,
              isEnabled: true,
            },
          ],
          headings: ["Shipping Information", "Payment Method"],
          forms: [
            {
              id: "checkout-form",
              action: "/process",
              inputs: ["country", "card_number"],
              options: [
                { name: "country", value: "US", text: "United States" },
                { name: "country", value: "IN", text: "India" },
              ],
            },
          ],
          mediaElements: [],
          dialogs: [],
        }),
      });

      const obs = await PageObserver.observe(mockPage, "tab-test");
      expect(obs.url).toBe("https://example.com/checkout");
      expect(obs.title).toBe("Checkout Form");
      expect(obs.headings).toContain("Shipping Information");
      expect(obs.forms[0].options?.length).toBe(2);
      expect(obs.interactiveElements[0].role).toBe("button");
      expect(obs.interactiveElements[0].locatorCandidates?.length).toBeGreaterThan(0);
    });

    it("PageObserver.progressiveInspect discovers targets beyond the default compact sample cap", async () => {
      const mockPage = createMockPage({
        url: () => "https://example.com/large-catalog",
        title: async () => "Large Catalog",
        evaluate: vi.fn().mockImplementation((fn: any, arg?: any) => {
          if (typeof arg === "object" && arg.targetQuery) {
            // Evaluated inside progressive live search
            return Promise.resolve({
              interactiveElements: [
                {
                  id: "deep-target-link",
                  role: "link",
                  tagName: "A",
                  text: "Deeply Nested Category Link",
                  isVisible: true,
                  isEnabled: true,
                },
              ],
              headings: ["Catalog"],
              forms: [],
              mediaElements: [],
              dialogs: [],
            });
          }
          // Default compact evaluation with 80 unrelated items
          return Promise.resolve({
            interactiveElements: Array.from({ length: 80 }, (_, i) => ({
              id: `item-${i}`,
              tagName: "BUTTON",
              text: `Unrelated Button ${i}`,
              isVisible: true,
              isEnabled: true,
            })),
            headings: ["Catalog"],
            forms: [],
            mediaElements: [],
            dialogs: [],
          });
        }),
      });

      const result = await PageObserver.progressiveInspect(mockPage, "Deeply Nested Category");
      expect(result.found).toBe(true);
      expect(result.element?.text).toContain("Deeply Nested Category Link");
      expect(result.observation.interactiveElements.some((e) => e.text?.includes("Deeply Nested Category"))).toBe(true);
    });
  });

  describe("3. Grounded Locator Resolution & Ambiguity", () => {
    it("LocatorEngine disambiguates visible elements from hidden duplicates", async () => {
      const mockLocator = {
        count: vi.fn().mockResolvedValue(2),
        nth: vi.fn().mockImplementation((index: number) => ({
          isVisible: vi.fn().mockResolvedValue(index === 1), // Only index 1 is visible
          isEnabled: vi.fn().mockResolvedValue(true),
          count: vi.fn().mockResolvedValue(1),
          first: () => ({ isEnabled: vi.fn().mockResolvedValue(true) }),
        })),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(false),
          isEnabled: vi.fn().mockResolvedValue(true),
        }),
      };

      const mockPage = createMockPage({
        getByRole: vi.fn().mockReturnValue(mockLocator),
        getByLabel: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: async () => 0 }),
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      });

      const result = await LocatorEngine.resolve(mockPage, {
        strategy: LocatorStrategy.ROLE,
        role: "button",
        value: "Search",
      });

      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.strategyUsed).toBe(LocatorStrategy.ROLE);
    });

    it("throws ELEMENT_AMBIGUOUS when multiple visible elements match without index", async () => {
      const multiVisibleLocator = {
        count: vi.fn().mockResolvedValue(3),
        nth: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
          count: vi.fn().mockResolvedValue(1),
          first: () => ({ isEnabled: vi.fn().mockResolvedValue(true) }),
        }),
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          isEnabled: vi.fn().mockResolvedValue(true),
        }),
      };

      const mockPage = createMockPage({
        getByRole: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByLabel: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByTestId: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByTitle: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByText: vi.fn().mockReturnValue(multiVisibleLocator),
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      });

      await expect(
        LocatorEngine.resolve(mockPage, {
          strategy: LocatorStrategy.TEXT,
          value: "Duplicate Action Button",
        })
      ).rejects.toThrowError(/ambiguous elements/i);
    });
  });

  describe("4. Pre-Execution Safety Gate & Action Validation", () => {
    it("rejects execution if the browser page is closed or detached", async () => {
      const closedPage = createMockPage({
        isClosed: () => true,
      });

      const action: Action = {
        id: "act-1",
        type: ActionType.CLICK,
        target: { strategy: LocatorStrategy.ROLE, role: "button", value: "Submit" },
        reason: "Click submit",
      };

      const obs: PageObservation = {
        url: "https://example.com",
        title: "Test",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      await expect(
        PreExecutionValidator.validate({
          action,
          page: closedPage,
          currentObservation: obs,
        })
      ).rejects.toThrowError(/browser page is closed or disconnected/i);
    });

    it("enforces action preconditions before allowing execution", async () => {
      const activePage = createMockPage({
        url: () => "about:blank",
      });

      const actionWithPrecondition: Action = {
        id: "act-click",
        type: ActionType.CLICK,
        target: { strategy: LocatorStrategy.ROLE, role: "button", value: "Proceed" },
        reason: "Click proceed",
        preconditions: ["page_loaded"],
      };

      const blankObs: PageObservation = {
        url: "about:blank",
        title: "",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      await expect(
        PreExecutionValidator.validate({
          action: actionWithPrecondition,
          page: activePage,
          currentObservation: blankObs,
        })
      ).rejects.toThrowError(/action precondition 'page_loaded' not met/i);
    });

    it("identifies side-effecting actions and marks isSafeToRetry as false", async () => {
      const singleLoc = createMockLocator({ count: 1, visible: true, enabled: true });
      const activePage = createMockPage({
        url: () => "https://example.com/checkout",
        getByRole: vi.fn().mockReturnValue(singleLoc),
        getByLabel: vi.fn().mockReturnValue({ count: async () => 0 }),
        getByPlaceholder: vi.fn().mockReturnValue({ count: async () => 0 }),
        locator: vi.fn().mockReturnValue({ count: async () => 0 }),
      });

      const submitAction: Action = {
        id: "act-submit",
        type: ActionType.CLICK,
        target: { strategy: LocatorStrategy.ROLE, role: "button", value: "Place Order" },
        reason: "Submit order payment",
        risk: RiskLevel.LOW,
      };

      const obs: PageObservation = {
        url: "https://example.com/checkout",
        title: "Checkout",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = await PreExecutionValidator.validate({
        action: submitAction,
        page: activePage,
        currentObservation: obs,
        requireConfirmationForHighRisk: false,
      });

      expect(result.valid).toBe(true);
      expect(result.isSafeToRetry).toBe(false);
    });
  });

  describe("5. Generalized Candidate Scoring & Result Selection", () => {
    it("ActionExecutor scores candidate search links semantically without hardcoded site selectors", async () => {
      const targetQuery = "Wireless Noise Cancelling Headphones";
      const action: Action = {
        id: "click-result-1",
        type: ActionType.CLICK,
        value: targetQuery,
        target: { strategy: LocatorStrategy.TEXT, value: targetQuery },
        reason: "Click matching media result",
      };

      let currentUrl = "https://example.com/search?q=headphones";
      const mockCandidateLink = createMockLocator({
        count: 1,
        visible: true,
        enabled: true,
        text: targetQuery,
        click: vi.fn().mockImplementation(async () => {
          currentUrl = "https://example.com/item/headphones-1";
        }),
      });

      const mockPage = createMockPage({
        url: () => currentUrl,
        title: async () => (currentUrl.includes("item") ? "Headphones Detail" : "Search Results"),
        getByText: vi.fn().mockReturnValue(mockCandidateLink),
        locator: vi.fn().mockImplementation((selector: string) => {
          if (
            selector.includes("has-text") ||
            selector.includes("Wireless") ||
            selector.includes("headphones") ||
            selector.includes("item") ||
            selector.includes("href")
          ) {
            return mockCandidateLink;
          }
          return { count: async () => 0, isVisible: async () => false, first: () => mockCandidateLink };
        }),
        evaluate: vi.fn().mockImplementation(async (fn: any) => {
          if (typeof fn === "function") {
            const src = fn.toString();
            if (src.includes("candidateLinks") || src.includes("results.push") || src.includes("seenCardIds")) {
              return {
                items: [
                  {
                    id: "link_1",
                    selector: `a:has-text("${targetQuery}")`,
                    title: targetQuery,
                    snippet: "High fidelity wireless noise cancelling headphones with rich sound",
                    href: "https://example.com/item/headphones-1",
                    visibleText: targetQuery,
                    accessibleName: targetQuery,
                    role: "link",
                    cardId: "item_1",
                    isThumbnail: false,
                    isTitleLink: true,
                    metadata: { price: 199.99, currency: "$" },
                  },
                ],
                totalScanned: 1,
                distinctCards: 1,
              };
            }
          }
          return {
            interactiveElements: [
              {
                id: "link_1",
                role: "link",
                tagName: "a",
                text: targetQuery,
                isVisible: true,
                isEnabled: true,
              },
            ],
            headings: [currentUrl.includes("item") ? "Headphones Detail" : "Search Results"],
            forms: [],
            mediaElements: [],
            dialogs: [],
          };
        }),
      });

      const execResponse = await ActionExecutor.execute({
        action,
        page: mockPage,
        tabId: "tab-1",
        taskId: "task-search-scoring",
        stepIndex: 1,
      });

      expect(execResponse.result.status).toBe("completed");
      expect(execResponse.result.taskId).toBe("task-search-scoring");
      expect(execResponse.result.stepIndex).toBe(1);
    });
  });

  describe("6. Failure Classification & Evidence-Driven Recovery", () => {
    it("maps all 10 Vector error categories correctly", () => {
      expect(mapToVectorCategory(ErrorCode.TIMEOUT)).toBe("timeout_or_element_not_ready");
      expect(mapToVectorCategory(ErrorCode.ELEMENT_NOT_FOUND)).toBe("missing_or_ambiguous_locator");
      expect(mapToVectorCategory(ErrorCode.ELEMENT_AMBIGUOUS)).toBe("missing_or_ambiguous_locator");
      expect(mapToVectorCategory(ErrorCode.STALE_TARGET)).toBe("stale_page_context");
      expect(mapToVectorCategory(ErrorCode.NAVIGATION_FAILED)).toBe("failed_navigation");
      expect(mapToVectorCategory(ErrorCode.NETWORK_ERROR)).toBe("transient_network_failure");
      expect(mapToVectorCategory(ErrorCode.SECURITY_POLICY_VIOLATION)).toBe("permission_denial");
      expect(mapToVectorCategory(ErrorCode.CAPTCHA_DETECTED)).toBe("site_restriction_or_challenge");
      expect(mapToVectorCategory(ErrorCode.AUTH_REQUIRED)).toBe("site_restriction_or_challenge");
      expect(mapToVectorCategory(ErrorCode.UNSUPPORTED_ACTION)).toBe("unsupported_action");
      expect(mapToVectorCategory(ErrorCode.POSTCONDITION_FAILED)).toBe("failed_postcondition");
      expect(mapToVectorCategory(ErrorCode.FATAL_ERROR)).toBe("fatal_error");
    });

    it("halts safely on CAPTCHA and Auth blockers instead of attempting bypass", () => {
      const captchaError = new AgentError("Google /sorry/ CAPTCHA detected", ErrorCode.CAPTCHA_DETECTED, false);
      const decision = RecoveryEngine.determineRecovery({
        action: { id: "a1", type: ActionType.CLICK, reason: "Click search" },
        error: captchaError,
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
      });

      expect(decision.strategy).toBe("WAITING_FOR_USER");
      expect(decision.record?.vectorCategory).toBe("site_restriction_or_challenge");
      expect(decision.record?.anotherAttemptPermitted).toBe(false);
    });

    it("prevents blind automatic retries on side-effecting operations (purchases / form submits)", () => {
      const timeoutError = new AgentError("Network timeout during submission", ErrorCode.TIMEOUT, true);
      const sideEffectingAction: Action = {
        id: "submit-payment",
        type: ActionType.CLICK,
        target: { strategy: LocatorStrategy.ROLE, role: "button", value: "Pay Now" },
        reason: "Submit credit card payment",
      };

      const decision = RecoveryEngine.determineRecovery({
        action: sideEffectingAction,
        error: timeoutError,
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
      });

      // Side-effecting operations must require user confirmation rather than retrying blindly
      expect(decision.strategy).toBe("WAITING_FOR_USER");
      expect(decision.requiresConfirmation).toBe(true);
      expect(decision.reason).toContain("prevent duplicate side effects");
    });
  });

  describe("7. Local File Protection & Telemetry", () => {
    it("LocalFileResolver denies access to paths outside authorized roots and path traversals", () => {
      const traversalPath = path.resolve(process.cwd(), "../../../Windows/System32/drivers/etc/hosts");
      const check = LocalFileResolver.isPermittedPath(traversalPath);
      expect(check.permitted).toBe(false);
      expect(check.reason).toContain("outside authorized search roots");
    });

    it("ActionExecutor produces complete telemetry records for completed actions", async () => {
      const mockPage = createMockPage({
        url: () => "https://example.com/catalog",
        title: async () => "Catalog",
      });

      const waitAction: Action = {
        id: "act-wait",
        type: ActionType.WAIT,
        value: 100,
        reason: "Wait for elements to settle",
      };

      const response = await ActionExecutor.execute({
        action: waitAction,
        page: mockPage,
        tabId: "tab-test",
        taskId: "task-telemetry-42",
        stepIndex: 3,
      });

      expect(response.result.taskId).toBe("task-telemetry-42");
      expect(response.result.stepIndex).toBe(3);
      expect(response.result.currentUrl).toBe("https://example.com/catalog");
      expect(response.result.validationResult?.valid).toBe(true);
      expect(response.result.resultingState?.url).toBe("https://example.com/catalog");
      expect(response.result.verified).toBe(true);
    });
  });
});
