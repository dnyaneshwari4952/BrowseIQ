import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, Browser, Page } from "playwright";
import { ChallengeDetector } from "@/lib/browser/challenge-detector";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { PageObserver } from "@/lib/browser/page-observer";
import { AgentLoop } from "@/lib/agent/agent-loop";
import { ActionType, ActionStatus, RiskLevel } from "@/lib/types/actions";
import { ErrorCode } from "@/lib/types/errors";
import { PageObservation } from "@/lib/types/browser";

describe("Challenge Detection, Task Verification & Outcome Separation", () => {
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

  describe("1. Challenge & Blocked Page Detection (Google /sorry/ & Cloudflare)", () => {
    it("detects Google unusual-traffic /sorry/ challenge page by URL and heading", () => {
      const googleSorryObs: PageObservation = {
        url: "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dcheapest%2Bschool%2Bbags",
        title: "Sorry...",
        headings: ["Our systems have detected unusual traffic from your computer network."],
        interactiveElements: [
          {
            id: "recaptcha-anchor",
            tagName: "INPUT",
            type: "checkbox",
            text: "I'm not a robot",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [{ action: "/sorry/index", inputs: ["q", "continue"] }],
        dialogs: [],
        summary: "PAGE: 'Sorry...' (URL: https://www.google.com/sorry/index). Headings: [Our systems have detected unusual traffic...].",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(googleSorryObs);
      expect(result.isBlocked).toBe(true);
      expect(result.blockType).toBe("GOOGLE_UNUSUAL_TRAFFIC");
      expect(result.reason).toContain("Google unusual-traffic verification (google.com/sorry/)");
    });

    it("detects Cloudflare bot challenge by title and heading", () => {
      const cloudflareObs: PageObservation = {
        url: "https://target-site.com/challenges",
        title: "Just a moment...",
        headings: ["Attention Required!", "Verify you are human"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "PAGE: 'Just a moment...' Checking your browser before accessing target-site.com.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(cloudflareObs);
      expect(result.isBlocked).toBe(true);
      expect(result.blockType).toBe("CLOUDFLARE_CHALLENGE");
      expect(result.reason).toContain("Cloudflare bot protection challenge");
    });

    it("detects Google consent wall by URL and heading", () => {
      const consentObs: PageObservation = {
        url: "https://consent.google.com/m?continue=https://www.google.com/search?q=school+bags&gl=US",
        title: "Before you continue to Google",
        headings: ["Before you continue to Google"],
        interactiveElements: [
          {
            id: "btn-accept",
            role: "button",
            tagName: "BUTTON",
            text: "Accept all",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Before you continue to Google. Choose your privacy settings.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(consentObs);
      expect(result.isBlocked).toBe(true);
      expect(result.blockType).toBe("CONSENT_REQUIRED");
      expect(result.reason).toContain("consent or privacy choice gate");
    });

    it("detects Google redirect notice page", () => {
      const redirectObs: PageObservation = {
        url: "https://www.google.com/url?sa=t&rct=j&q=&esrc=s&source=web&cd=&ved=2ahUKE",
        title: "Redirect Notice",
        headings: ["Redirect Notice"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Redirect notice: The page you were visiting is trying to send you to...",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const result = ChallengeDetector.detect(redirectObs);
      expect(result.isBlocked).toBe(true);
      expect(result.blockType).toBe("REDIRECT_BLOCKED");
      expect(result.reason).toContain("interstitial redirect notice");
    });

    it("TaskVerifier rejects Google /sorry/ as a BLOCKED outcome, NOT generic keyword mismatch", () => {
      const googleSorryObs: PageObservation = {
        url: "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dschool%2Bbags",
        title: "Sorry...",
        headings: ["Our systems have detected unusual traffic from your computer network."],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Unusual traffic detected.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-1",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 300,
            retriesUsed: 0,
            verified: true,
          },
          {
            actionId: "act-2",
            type: ActionType.PRESS,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: googleSorryObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.isBlocked).toBe(true);
      expect(verification.blockReason).toContain("google.com/sorry/");
      // MUST NOT misattribute to a missing keyword 'cheapesr' or 'cheapest'
      expect(verification.reason).not.toContain("does not contain a search interface or results matching");
      expect(verification.reason).toContain("google.com/sorry/");
    });
  });

  describe("2. Action Success vs Task Success Separation", () => {
    it("reports concrete actions as verified while task verification reports blocked", () => {
      const completedSteps = [
        {
          actionId: "step-nav",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 350,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "step-fill",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 120,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "step-press",
          type: ActionType.PRESS,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 40,
          retriesUsed: 0,
          verified: true,
        },
      ];

      // All concrete actions succeeded mechanically
      expect(completedSteps.every((s) => s.verified && s.status === ActionStatus.COMPLETED)).toBe(true);

      // But page transitioned to challenge
      const observation: PageObservation = {
        url: "https://www.google.com/sorry/index",
        title: "Sorry...",
        headings: ["Unusual traffic from your computer network"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Sorry page",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const taskResult = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps,
        latestObservation: observation,
      });

      // Task success is strictly separated from low-level action success
      expect(taskResult.passed).toBe(false);
      expect(taskResult.isBlocked).toBe(true);
    });
  });

  describe("3. Search Submission Followed by Unrelated Page Must Fail Verification", () => {
    it("fails verification when search is submitted but resulting page is unrelated and has no matching results", () => {
      const unrelatedObs: PageObservation = {
        url: "https://example.com/other-page",
        title: "Corporate News Portal",
        headings: ["Quarterly Earnings Report", "Executive Team Updates"],
        interactiveElements: [
          {
            id: "link-1",
            role: "link",
            tagName: "A",
            text: "Read more",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Corporate news portal with earnings reports.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        planActions: [
          {
            id: "act-fill",
            type: ActionType.FILL,
            target: { strategy: "name", value: "q" },
            value: "cheapest school bags",
            risk: RiskLevel.LOW,
            reason: "Enter search query",
          },
          {
            id: "act-press",
            type: ActionType.PRESS,
            value: "Enter",
            risk: RiskLevel.LOW,
            reason: "Submit search",
          },
        ],
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
          {
            actionId: "act-press",
            type: ActionType.PRESS,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 40,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: unrelatedObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.reason).toContain("Search was submitted for 'cheapest school bags', but the target page does not contain matching results.");
    });

    it("rejects unrelated page containing ONLY the modifier keyword 'cheapest' (e.g. hotel booking)", () => {
      const hotelPageObs: PageObservation = {
        url: "https://hotels.example.com/deals",
        title: "Cheapest Hotel Deals & Flight Booking",
        headings: ["Find the cheapest hotels and vacation packages", "Book Today"],
        interactiveElements: [
          {
            id: "btn-hotel",
            role: "button",
            tagName: "BUTTON",
            text: "Search cheapest hotels",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Cheapest hotel and flight booking portal.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: hotelPageObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.failedChecks).toContain("queryResultsFor:cheapest school bags");
    });

    it("rejects unrelated page containing ONLY the single keyword 'bags' (e.g. coffee beans)", () => {
      const coffeePageObs: PageObservation = {
        url: "https://coffee.example.com/products",
        title: "Artisan Coffee Roasters",
        headings: ["Whole Bean Coffee in 1kg bags", "Subscription Bags"],
        interactiveElements: [
          {
            id: "link-coffee",
            role: "link",
            tagName: "A",
            text: "Order coffee bags",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Artisan coffee beans available in 250g and 1kg bags.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: coffeePageObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.failedChecks).toContain("queryResultsFor:cheapest school bags");
    });

    it("rejects unrelated page containing ONLY the single keyword 'school' (e.g. university admissions)", () => {
      const universityPageObs: PageObservation = {
        url: "https://university.example.com/engineering",
        title: "School of Engineering - Graduate Programs",
        headings: ["Graduate Admissions - School of Engineering", "Academic Departments"],
        interactiveElements: [
          {
            id: "link-apply",
            role: "link",
            tagName: "A",
            text: "Apply to School of Engineering",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "University School of Engineering admissions portal.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: universityPageObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.failedChecks).toContain("queryResultsFor:cheapest school bags");
    });
  });

  describe("4. Genuine Search Result Page Must Pass Verification", () => {
    it("passes verification when search results matching query are present on the resulting page", () => {
      const searchResultObs: PageObservation = {
        url: "http://localhost:3000/test-fixtures/search",
        title: "Product Search Demo Shop",
        headings: ["Product Search Demo Shop", "Results for \"school bags\" (3)"],
        interactiveElements: [
          {
            id: "elem-1",
            tagName: "DIV",
            text: "Classic School Backpack - ₹699",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
          {
            id: "elem-2",
            tagName: "DIV",
            text: "Ergonomic Kids School Bag - ₹899",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [{ id: "search-form", inputs: ["q"] }],
        dialogs: [],
        summary: "Product search results for school bags: 3 products found.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        planActions: [
          {
            id: "act-fill",
            type: ActionType.FILL,
            target: { strategy: "name", value: "q" },
            value: "school bags",
            risk: RiskLevel.LOW,
            reason: "Enter search query",
          },
          {
            id: "act-press",
            type: ActionType.PRESS,
            value: "Enter",
            risk: RiskLevel.LOW,
            reason: "Submit search",
          },
        ],
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
          {
            actionId: "act-press",
            type: ActionType.PRESS,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: searchResultObs,
      });

      expect(verification.passed).toBe(true);
      expect(verification.failedChecks).toHaveLength(0);
    });
  });

  describe("5. Query Normalization Without Silently Mutating User Query", () => {
    it("preserves user typo 'cheapesr school bags' without corrupting or auto-mutating input", () => {
      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapesr school bags",
        completedSteps: [
          {
            actionId: "act-1",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 200,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: {
          url: "http://localhost:3000/empty",
          title: "Blank Page",
          headings: [],
          interactiveElements: [],
          forms: [],
          dialogs: [],
          summary: "Blank page with no controls.",
          timestamp: new Date().toISOString(),
          tabId: "tab-1",
        },
      });

      expect(verification.passed).toBe(false);
      // The user's intended query 'cheapesr school bags' is reported honestly without being silently mutated
      expect(verification.reason).toContain("cheapesr school bags");
    });
  });

  describe("6. Page Observation & Diagnostics Remain Available After Failure", () => {
    it("preserves latestObservation and detailed diagnostic errors in ExecutionContext", async () => {
      await page.setContent(`
        <!DOCTYPE html>
        <html>
          <head><title>Sorry...</title></head>
          <body>
            <h1>Our systems have detected unusual traffic from your computer network.</h1>
            <p>This page checks to see if it's really you sending the requests, and not a robot.</p>
            <form id="captcha-form" action="/sorry">
              <input type="checkbox" id="robot-check" />
              <label for="robot-check">I'm not a robot</label>
            </form>
          </body>
        </html>
      `);

      const obs = await PageObserver.observe(page, "tab-test");
      expect(obs.title).toBe("Sorry...");
      expect(obs.headings).toContain("Our systems have detected unusual traffic from your computer network.");
      expect(obs.interactiveElements.length).toBeGreaterThan(0);

      const challenge = ChallengeDetector.detect(obs);
      expect(challenge.isBlocked).toBe(true);

      // Verify that when TaskVerifier evaluates this, observation details are retained
      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-1",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 150,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: obs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.details).toBeDefined();
      expect(verification.details?.title).toBe("Sorry...");
      expect(verification.details?.blockType).toBe("GOOGLE_UNUSUAL_TRAFFIC");
    });
  });

  describe("7. Empty Search Results & Incomplete Page States", () => {
    it("fails verification with explicit zero-results error when search yields no documents", () => {
      const zeroResultsObs: PageObservation = {
        url: "https://www.google.com/search?q=cheapest+school+bags",
        title: "cheapest school bags - Google Search",
        headings: ["Your search - cheapest school bags - did not match any documents."],
        interactiveElements: [
          {
            id: "search-again",
            tagName: "INPUT",
            name: "q",
            value: "cheapest school bags",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Your search - cheapest school bags - did not match any documents. Suggestions: Make sure all words are spelled correctly.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-press",
            type: ActionType.PRESS,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 40,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: zeroResultsObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.reason).toContain("0 results were found for 'cheapest school bags'. The target page returned empty search results.");
      expect(verification.failedChecks).toContain("searchResultsNotEmpty");
    });

    it("fails verification with meaningful error when page settles with 0 interactive elements and 0 headings", () => {
      const blankObs: PageObservation = {
        url: "https://www.google.com/search?q=cheapest+school+bags",
        title: "Google Search",
        headings: [],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "PAGE: 'Google Search' (URL: https://www.google.com/search?q=cheapest+school+bags). Elements: 0 visible.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      };

      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-press",
            type: ActionType.PRESS,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 40,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: blankObs,
      });

      expect(verification.passed).toBe(false);
      expect(verification.reason).toContain("empty or incomplete state (0 interactive elements and 0 headings detected");
      expect(verification.failedChecks).toContain("pageNotEmpty");
    });
  });

  describe("8. Stale or Missing Page Observations", () => {
    it("fails verification when latestObservation is missing/null after browser actions were executed", () => {
      const verification = TaskVerifier.verifyTaskCompletion({
        taskDescription: "search for cheapest school bags",
        completedSteps: [
          {
            actionId: "act-nav",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 150,
            retriesUsed: 0,
            verified: true,
          },
        ],
        latestObservation: null,
      });

      expect(verification.passed).toBe(false);
      expect(verification.reason).toContain("No browser page observation was captured. Cannot verify task completion without live page state.");
      expect(verification.failedChecks).toContain("pageObserved");
    });
  });

  describe("9. LIVE FIXTURE E2E: Local Challenge Fixture Halts with Blocked Status", () => {
    it("halts safely on local challenge page with finalStatus: 'blocked' and CAPTCHA_DETECTED code", { timeout: 30000 }, async () => {
      const isServerUp = await fetch("http://localhost:3000/api/health").then((r) => r.ok).catch(() => false);
      if (!isServerUp) {
        console.log("Local fixture server is offline at localhost:3000. Skipping live network challenge test.");
        return;
      }
      const agent = new AgentLoop();
      const ctx = await agent.runTask({
        task: "search for cheapest school bags",
        targetUrl: "http://localhost:3000/test-fixtures/challenge",
        forceBrowser: true,
      });

      // Must be stopped cleanly
      expect(ctx.finalStatus).toBe("blocked");
      expect(ctx.statusMessage).toContain("Google unusual-traffic verification (google.com/sorry/)");

      // Observation must remain available after failure (Requirement 5)
      expect(ctx.latestObservation).toBeDefined();
      expect(ctx.latestObservation?.title).toBe("Sorry...");
      expect(ctx.latestObservation?.headings.length).toBeGreaterThan(0);
      expect(ctx.latestObservation?.interactiveElements.length).toBeGreaterThan(0);

      // Diagnostic errors must be recorded
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors[0].code).toBe(ErrorCode.CAPTCHA_DETECTED);

      // No retries/replans loops should be wasted on a blocked page (Requirement 6)
      expect(ctx.retries).toBe(0);
      expect(ctx.replans).toBe(0);
    });
  });

  describe("10. Price Normalization & Resilient Observation", () => {
    it("handles price ranges safely without digit concatenation into billions", async () => {
      const { LocalSemanticReasoner } = await import("@/lib/agent/local-semantic-reasoner");
      const parsedRange = LocalSemanticReasoner.parsePrice("₹65,000 - ₹75,000");
      expect(parsedRange).toBe(65000);

      const parsedDecimal = LocalSemanticReasoner.parsePrice("$1,299.99");
      expect(parsedDecimal).toBe(1299.99);

      const parsedPlain = LocalSemanticReasoner.parsePrice("₹45000");
      expect(parsedPlain).toBe(45000);
    });

    it("observes closed page safely without throwing unhandled exceptions", async () => {
      const closedPage = await browser.newPage();
      await closedPage.close();

      const obs = await PageObserver.observe(closedPage, "tab-closed");
      expect(obs.pageType).toBe("error");
      expect(obs.isSettled).toBe(false);
      expect(obs.summary).toContain("closed or unavailable");
    });
  });
});
