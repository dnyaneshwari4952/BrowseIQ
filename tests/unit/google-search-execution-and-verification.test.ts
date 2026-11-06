import { describe, it, expect } from "vitest";
import { TaskVerifier, isSearchEngineHomepage } from "../../lib/agent/task-verifier";
import { ChallengeDetector } from "../../lib/browser/challenge-detector";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { EntityConstraintResolver } from "../../lib/planning/entity-constraint-resolver";
import { ActionType, ActionStatus } from "../../lib/types/actions";
import { PageObservation } from "../../lib/types/browser";
import { ErrorCode, AgentError } from "../../lib/types/errors";

describe("BrowseIQ — Google Search Execution and Verification Regression Suite", () => {
  const searchQuery = "harry potter books";
  const searchTask = "search for harry potter books on google";
  const searchSpec = EntityConstraintResolver.resolve({ rawInstruction: searchTask });

  // ---------------------------------------------------------------------------
  // 1. Successful Google search
  // ---------------------------------------------------------------------------
  it("1. Successful Google search: generates valid plan and verifies search results", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });
    expect(plan.actions.length).toBeGreaterThanOrEqual(4);
    expect(plan.actions.some((a) => a.type === ActionType.FILL && a.value === searchQuery)).toBe(true);
    expect(plan.actions.some((a) => a.type === ActionType.PRESS && a.value === "Enter")).toBe(true);
    expect(plan.actions.some((a) => a.type === ActionType.EVALUATE_SAFE)).toBe(true);

    const mockObservation: PageObservation = {
      url: "https://www.google.com/search?q=harry+potter+books",
      title: "harry potter books - Google Search",
      headings: ["Search Results", "Harry Potter: Complete 8-Book Collection", "Books by J.K. Rowling"],
      interactiveElements: [
        { id: "res-1", role: "article", text: "Harry Potter Book Series - Bloomsbury Children's Books", href: "https://www.bloomsbury.com/harry-potter" },
        { id: "res-2", role: "article", text: "Harry Potter and the Sorcerer's Stone Paperback", href: "https://www.amazon.com/Harry-Potter" },
      ],
      forms: [],
      dialogs: [],
      summary: "PAGE: Search Results for harry potter books. Elements: 15 visible.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "search_results",
      isSettled: true,
    };

    const extractedData = [
      { title: "Harry Potter: Complete 8-Book Collection", snippet: "All seven classic Harry Potter novels", url: "https://example.com/hp-books" },
      { title: "Harry Potter Paperback Box Set", snippet: "The official boxed set by J.K. Rowling", url: "https://example.com/hp-box" },
    ];

    const completedSteps = [
      { actionId: "1", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
      { actionId: "2", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: searchQuery },
      { actionId: "3", type: ActionType.PRESS, status: "completed" as ActionStatus },
      { actionId: "4", type: ActionType.EVALUATE_SAFE, status: "completed" as ActionStatus, extractedData },
    ];

    const result = TaskVerifier.verifyTask({
      task: searchTask,
      plan,
      targetUrl: "https://www.google.com",
      completedSteps,
      observation: mockObservation,
      extractedData,
    });

    expect(result.passed).toBe(true);
    expect(result.isBlocked).toBeFalsy();
    expect(result.failedChecks).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Search query entered but not submitted (Stays on Homepage)
  // ---------------------------------------------------------------------------
  it("2. Search query entered but not submitted: fails verification honestly when browser remains on homepage", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });

    // Browser remained on google.com/ (with or without params like ?gws_rd=ssl or /webhp)
    const homepageUrls = [
      "https://www.google.com/",
      "https://www.google.com/?gws_rd=ssl",
      "https://www.google.com/webhp?hl=en",
      "https://www.google.co.in/",
    ];

    for (const url of homepageUrls) {
      expect(isSearchEngineHomepage(url)).toBe(true);

      const homepageObservation: PageObservation = {
        url,
        title: "Google",
        headings: ["Search"],
        interactiveElements: [
          { id: "input-q", role: "searchbox", text: "harry potter books", name: "q" },
          { id: "btn-search", role: "button", text: "Google Search" },
          { id: "link-about", role: "link", text: "About Google and our products" },
        ],
        forms: [],
        dialogs: [],
        summary: "PAGE: Google Home. Elements: 10 visible.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
        pageType: "normal",
        isSettled: true,
      };

      const completedSteps = [
        { actionId: "1", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
        { actionId: "2", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: searchQuery },
        { actionId: "3", type: ActionType.PRESS, status: "completed" as ActionStatus }, // Enter swallowed or unsubmitted
      ];

      const result = TaskVerifier.verifyTask({
        task: searchTask,
        plan,
        targetUrl: "https://www.google.com",
        completedSteps,
        observation: homepageObservation,
      });

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toContain("searchSubmitted");
      expect(result.failedChecks).toContain("resultsExist");
      expect(result.reason).toContain("remained on the homepage without submitting the search or navigating to search results");
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Search input missing
  // ---------------------------------------------------------------------------
  it("3. Search input missing: reports ELEMENT_NOT_FOUND when target search input is absent", async () => {
    const missingTarget = { strategy: "id" as const, value: "non-existent-search-box-xyz" };
    const dummyAction = {
      id: "test-missing-input",
      type: ActionType.FILL,
      target: missingTarget,
      value: "harry potter books",
      risk: "low" as const,
      reason: "Fill missing search box",
    };

    const err = new AgentError(`Target element not found: "${missingTarget.value}"`, ErrorCode.ELEMENT_NOT_FOUND, true, { action: dummyAction });
    expect(err.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
    expect(err.recoverable).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Search submission followed by delayed navigation
  // ---------------------------------------------------------------------------
  it("4. Search submission followed by delayed navigation: waits for search results state before concluding", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });
    const waitStep = plan.actions.find((a) => a.type === ActionType.WAIT && a.reason.includes("results"));
    expect(waitStep).toBeDefined();
    expect(waitStep?.expectedState?.elementAppears).toContain("#search");
    expect(waitStep?.expectedState?.elementAppears).toContain(".g");
  });

  // ---------------------------------------------------------------------------
  // 5. Search results loaded successfully
  // ---------------------------------------------------------------------------
  it("5. Search results loaded successfully: verifies distinct search result entries and query relevance", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });

    const searchResultsObs: PageObservation = {
      url: "https://www.google.com/search?q=harry+potter+books&hl=en",
      title: "harry potter books - Google Search",
      headings: ["Search Results", "Harry Potter Series by J.K. Rowling", "Paperback & Hardcover Editions"],
      interactiveElements: [
        { id: "r1", role: "article", text: "Harry Potter Hardcover Box Set Books 1-7", href: "https://example.com/books/hp" },
        { id: "r2", role: "article", text: "J.K. Rowling Harry Potter Official Collection", href: "https://example.com/rowling" },
      ],
      forms: [],
      dialogs: [],
      summary: "Search Results for harry potter books containing multiple matching books and sets.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "search_results",
      isSettled: true,
    };

    const extractedData = [
      { title: "Harry Potter Hardcover Box Set Books 1-7", url: "https://example.com/books/hp" },
      { title: "J.K. Rowling Harry Potter Official Collection", url: "https://example.com/rowling" },
    ];

    const result = TaskVerifier.verifyTask({
      task: searchTask,
      plan,
      targetUrl: "https://www.google.com",
      completedSteps: [
        { actionId: "nav", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
        { actionId: "1", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: searchQuery },
        { actionId: "2", type: ActionType.PRESS, status: "completed" as ActionStatus },
        { actionId: "3", type: ActionType.EVALUATE_SAFE, status: "completed" as ActionStatus, extractedData },
      ],
      observation: searchResultsObs,
      extractedData,
    });

    expect(result.passed).toBe(true);
    expect(result.failedChecks).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Empty search results
  // ---------------------------------------------------------------------------
  it("6. Empty search results: detects zero-results page and reports truthful failure", () => {
    const emptySpec = EntityConstraintResolver.resolve({ rawInstruction: "search for xyzqwertyunrealproduct789 on google" });
    const plan = DynamicTaskPlanner.plan({ spec: emptySpec, targetUrl: "https://www.google.com" });

    const zeroResultsObs: PageObservation = {
      url: "https://www.google.com/search?q=xyzqwertyunrealproduct789",
      title: "xyzqwertyunrealproduct789 - Google Search",
      headings: ["Search Results"],
      interactiveElements: [],
      forms: [],
      dialogs: [],
      summary: "Your search - xyzqwertyunrealproduct789 - did not match any documents.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "search_results",
      isSettled: true,
    };

    const result = TaskVerifier.verifyTask({
      task: "search for xyzqwertyunrealproduct789 on google",
      plan,
      targetUrl: "https://www.google.com",
      completedSteps: [
        { actionId: "1", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: "xyzqwertyunrealproduct789" },
        { actionId: "2", type: ActionType.PRESS, status: "completed" as ActionStatus },
      ],
      observation: zeroResultsObs,
    });

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toContain("searchResultsNotEmpty");
    expect(result.reason).toContain("0 results were found");
  });

  // ---------------------------------------------------------------------------
  // 7. Search results unrelated to the requested query
  // ---------------------------------------------------------------------------
  it("7. Search results unrelated to the requested query: rejects page containing irrelevant content", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });

    // Page displays results for quantum mechanics instead of harry potter books
    const unrelatedObs: PageObservation = {
      url: "https://www.google.com/search?q=quantum+mechanics",
      title: "quantum mechanics - Google Search",
      headings: ["Search Results", "Introduction to Quantum Electrodynamics", "Schrodinger Wave Equation"],
      interactiveElements: [
        { id: "r1", role: "article", text: "Quantum Physics Lecture Notes - MIT OpenCourseWare", href: "https://ocw.mit.edu" },
      ],
      forms: [],
      dialogs: [],
      summary: "Search Results for theoretical physics and quantum mechanics.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "search_results",
      isSettled: true,
    };

    const unrelatedData = [
      { title: "Introduction to Quantum Electrodynamics", url: "https://example.com/physics" },
    ];

    const result = TaskVerifier.verifyTask({
      task: searchTask,
      plan,
      targetUrl: "https://www.google.com",
      completedSteps: [
        { actionId: "1", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
        { actionId: "2", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: "quantum mechanics" },
        { actionId: "3", type: ActionType.PRESS, status: "completed" as ActionStatus },
      ],
      observation: unrelatedObs,
      extractedData: unrelatedData,
    });

    expect(result.passed).toBe(false);
    expect(result.failedChecks.some((c) => c.includes("queryResultsFor"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 8. Google consent page
  // ---------------------------------------------------------------------------
  it("8. Google consent page: detects consent gate and prevents false success", () => {
    const consentObs: PageObservation = {
      url: "https://consent.google.com/m?continue=https://www.google.com/search%3Fq%3Dharry%2Bpotter",
      title: "Before you continue to Google",
      headings: ["Before you continue to Google"],
      interactiveElements: [
        { id: "accept", role: "button", text: "Accept all" },
        { id: "reject", role: "button", text: "Reject all" },
      ],
      forms: [],
      dialogs: [],
      summary: "PAGE: Before you continue to Google consent choice gate.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "consent",
      isSettled: true,
    };

    const challenge = ChallengeDetector.detect(consentObs);
    expect(challenge.isBlocked).toBe(true);
    expect(challenge.blockType).toBe("CONSENT_REQUIRED");
    expect(challenge.reason).toContain("consent.google.com");
  });

  // ---------------------------------------------------------------------------
  // 9. CAPTCHA or blocked search (google.com/sorry/)
  // ---------------------------------------------------------------------------
  it("9. CAPTCHA or blocked search: detects Google /sorry/ verification and halts safely as blocked", () => {
    const sorryObs: PageObservation = {
      url: "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dharry%2Bpotter%2Bbooks",
      title: "https://www.google.com/search?q=harry+potter+books",
      headings: ["About this page", "Our systems have detected unusual traffic from your computer network."],
      interactiveElements: [
        { id: "recaptcha", role: "button", text: "I'm not a robot" },
      ],
      forms: [],
      dialogs: [],
      summary: "PAGE: Google unusual traffic verification notice (google.com/sorry/).",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "challenge",
      isSettled: true,
    };

    const challenge = ChallengeDetector.detect(sorryObs);
    expect(challenge.isBlocked).toBe(true);
    expect(challenge.blockType).toBe("GOOGLE_UNUSUAL_TRAFFIC");
    expect(challenge.reason).toContain("google.com/sorry/");

    const verif = TaskVerifier.verifyTask({
      task: searchTask,
      observation: sorryObs,
      completedSteps: [],
    });

    expect(verif.passed).toBe(false);
    expect(verif.isBlocked).toBe(true);
    expect(verif.outcome).toBe("blocked");
  });

  // ---------------------------------------------------------------------------
  // 10. Duplicate search results
  // ---------------------------------------------------------------------------
  it("10. Duplicate search results: cleans and deduplicates result cards accurately", () => {
    const rawResults = [
      { title: "Harry Potter Box Set: Books 1-7", url: "https://example.com/books/hp" },
      { title: "Harry Potter Box Set: Books 1-7", url: "https://example.com/books/hp" }, // Duplicate
      { title: "Harry Potter and the Philosopher's Stone", url: "https://example.com/book-1" },
    ];

    const seen = new Set<string>();
    const deduplicated = rawResults.filter((r) => {
      if (seen.has(r.title)) return false;
      seen.add(r.title);
      return true;
    });

    expect(deduplicated).toHaveLength(2);
    expect(deduplicated[0].title).toBe("Harry Potter Box Set: Books 1-7");
    expect(deduplicated[1].title).toBe("Harry Potter and the Philosopher's Stone");
  });

  // ---------------------------------------------------------------------------
  // 11. Search results loaded through dynamic rendering
  // ---------------------------------------------------------------------------
  it("11. Search results loaded through dynamic rendering: verifies dynamically rendered result containers", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });
    const dynamicObs: PageObservation = {
      url: "https://www.google.com/search?q=harry+potter+books",
      title: "harry potter books - Google Search",
      headings: ["Search Results", "Harry Potter: Complete Collection"],
      interactiveElements: [
        { id: "dyn-card-1", role: "article", text: "Harry Potter Books Collection (Hardcover Boxed Set)", href: "https://example.com/dyn-hp" },
      ],
      forms: [],
      dialogs: [],
      summary: "Dynamically streamed and rendered search cards.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "search_results",
      isSettled: true,
    };

    const verif = TaskVerifier.verifyTask({
      task: searchTask,
      plan,
      targetUrl: "https://www.google.com",
      observation: dynamicObs,
      completedSteps: [
        { actionId: "nav", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
        { actionId: "1", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: searchQuery },
        { actionId: "2", type: ActionType.PRESS, status: "completed" as ActionStatus },
      ],
      extractedData: [{ title: "Harry Potter Books Collection", url: "https://example.com/dyn-hp" }],
    });

    expect(verif.passed).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 12. Search retry after a recoverable failure
  // ---------------------------------------------------------------------------
  it("12. Search retry after a recoverable failure: records recoveryAttempts and succeeds on second attempt", () => {
    const plan = DynamicTaskPlanner.plan({ spec: searchSpec, targetUrl: "https://www.google.com" });

    // Attempt 1: search entered but stalled on homepage
    const attempt1Observation: PageObservation = {
      url: "https://www.google.com/",
      title: "Google",
      headings: ["Search"],
      interactiveElements: [],
      forms: [],
      dialogs: [],
      summary: "Google homepage unsubmitted",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "normal",
      isSettled: true,
    };

    const verif1 = TaskVerifier.verifyTask({
      task: searchTask,
      plan,
      targetUrl: "https://www.google.com",
      observation: attempt1Observation,
      completedSteps: [
        { actionId: "nav", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
        { actionId: "1", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: searchQuery },
        { actionId: "2", type: ActionType.PRESS, status: "completed" as ActionStatus },
      ],
    });
    expect(verif1.passed).toBe(false);
    expect(verif1.failedChecks).toContain("searchSubmitted");

    // Recovery executed: recoveryAttempts incremented, search resubmitted, results loaded
    const recoveryAttempts = 1;
    const attempt2Observation: PageObservation = {
      url: "https://www.google.com/search?q=harry+potter+books",
      title: "harry potter books - Google Search",
      headings: ["Search Results", "Harry Potter: Complete Collection"],
      interactiveElements: [
        { id: "rec-1", role: "article", text: "Harry Potter Paperback Box Set (Books 1-7)", href: "https://example.com/rec-hp" },
      ],
      forms: [],
      dialogs: [],
      summary: "Google Search results loaded following recovery submission.",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
      pageType: "search_results",
      isSettled: true,
    };

    const verif2 = TaskVerifier.verifyTask({
      task: searchTask,
      plan,
      targetUrl: "https://www.google.com",
      observation: attempt2Observation,
      completedSteps: [
        { actionId: "nav", type: ActionType.NAVIGATE, status: "completed" as ActionStatus },
        { actionId: "1", type: ActionType.FILL, status: "completed" as ActionStatus, userIntent: searchQuery },
        { actionId: "2", type: ActionType.PRESS, status: "completed" as ActionStatus },
        { actionId: "3-rec", type: ActionType.CLICK, status: "completed" as ActionStatus },
      ],
      extractedData: [{ title: "Harry Potter Paperback Box Set (Books 1-7)", url: "https://example.com/rec-hp" }],
    });

    expect(verif2.passed).toBe(true);
    expect(recoveryAttempts).toBe(1);
  });
});
