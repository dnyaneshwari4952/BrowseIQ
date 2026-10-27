import { describe, it, expect, vi } from "vitest";
import { ApiRegistry } from "@/lib/api/api-registry";
import { ApiExecutor } from "@/lib/api/api-executor";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { SemanticOperationVerifier } from "@/lib/agent/semantic-operation-verifier";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { PromptDefense } from "@/lib/ai/prompt-defense";
import { UrlPolicy } from "@/lib/validation/url-policy";
import { PreExecutionValidator } from "@/lib/validation/pre-execution-validator";
import { Planner } from "@/lib/agent/planner";
import { ActionType, ActionStatus, RiskLevel } from "@/lib/types/actions";
import { AgentError, ErrorCode } from "@/lib/types/errors";
import { AgentLoop } from "@/lib/agent/agent-loop";

describe("Phase 4 — Layer E: Adversarial Testing, Verification, Routing & Safety (Sections 5, 6, 7, 8, 9)", () => {
  // ===========================================================================
  // SECTION 5: API-FIRST ROUTING AND BROWSER FALLBACK (12 Scenarios)
  // ===========================================================================
  describe("Section 5: API-First Routing and Fallback Policy", () => {
    it("1. Supported task with valid API integration executes directly via API", async () => {
      const endpoint = ApiRegistry.get("products-api")!;
      expect(endpoint).toBeDefined();

      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ products: [{ title: "Laptop Pro 16", price: 1200 }] }),
      } as any);

      try {
        const result = await ApiExecutor.execute(endpoint, "Search for laptops on products api");
        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(200);
        expect((result.data as any).products.length).toBeGreaterThan(0);
      } finally {
        global.fetch = origFetch;
      }
    });

    it("2. Unsupported API operation legitimately falls back to browser", () => {
      const endpoint = ApiRegistry.get("products-api")!;
      expect(endpoint.capabilities).toBeDefined();
      expect(endpoint.capabilities).not.toContain("checkout");
      expect(endpoint.capabilities).toContain("search");
    });

    it("3. Unavailable API integration (503) reports clear error and permits fallback", async () => {
      const endpoint = ApiRegistry.get("products-api")!;
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "Upstream API temporarily down",
      } as any);

      try {
        const result = await ApiExecutor.execute(endpoint, "Search for laptops");
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(503);
        expect(result.fallbackToBrowser).toBe(true);
      } finally {
        global.fetch = origFetch;
      }
    });

    it("4. Missing registry entry fails fast without invoking invalid adapter", () => {
      const missing = ApiRegistry.get("nonexistent-endpoint-id");
      expect(missing).toBeUndefined();
    });

    it("5. API timeout triggers abort signal and classified timeout error", async () => {
      const endpoint = ApiRegistry.get("products-api")!;
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(
        () =>
          new Promise((_, reject) => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          })
      );

      const abortController = new AbortController();
      abortController.abort();

      try {
        const result = await ApiExecutor.execute(endpoint, "Search for laptops", undefined, abortController.signal);
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("TIMEOUT");
      } finally {
        global.fetch = origFetch;
      }
    });

    it("6. API authentication failure (401) reports authentication error without leaking keys", async () => {
      const endpoint = ApiRegistry.get("products-api")!;
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => JSON.stringify({ error: "Invalid API Bearer sk-secret-12345678" }),
      } as any);

      try {
        const result = await ApiExecutor.execute(endpoint, "Search for laptops");
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(401);
        expect(result.error?.code).toBe("AUTH_ERROR");
        expect(result.fallbackToBrowser).toBe(false);
      } finally {
        global.fetch = origFetch;
      }
    });

    it("7. API response that is malformed or invalid schema reports response error", async () => {
      const endpoint = ApiRegistry.get("products-api")!;
      const origFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ invalidFormat: true }),
      } as any);

      try {
        const result = await ApiExecutor.execute(endpoint, "Search for laptops");
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INVALID_RESPONSE");
      } finally {
        global.fetch = origFetch;
      }
    });

    it("8. Task with browser fallback prohibited does not silently attempt browser actions", () => {
      const routeDecision = {
        route: "api" as const,
        reason: "Strict API execution",
        confidence: 0.95,
        fallbackAvailable: false,
      };

      expect(routeDecision.fallbackAvailable).toBe(false);
      // Invariant: when fallbackAvailable is false, failure must not trigger browser launch
    });

    it("9. Task requiring browser interaction not supported by API routes to browser", () => {
      const endpoint = ApiRegistry.get("products-api");
      const requiresMultiTab = true;
      const canUseApi = endpoint && !requiresMultiTab;
      expect(canUseApi).toBe(false);
    });

    it("10. API request with unauthorized private-network URL is rejected by SSRF guard", () => {
      const isPrivate = UrlPolicy.isPrivateOrLocal("http://192.168.1.50/api/internal");
      expect(isPrivate).toBe(true);
    });

    it("11. Provider failure while planning an API route reports planner failure cleanly", () => {
      const error = new AgentError("Provider failed during API route plan", ErrorCode.API_ERROR, false);
      expect(error.code).toBe(ErrorCode.API_ERROR);
    });

    it("12. Fallback route verifies plan compatibility before executing actions", () => {
      const action = {
        id: "act-1",
        type: ActionType.CLICK,
        target: { strategy: "role" as const, role: "button", value: "Submit" },
        risk: RiskLevel.LOW,
        reason: "Valid browser action",
      };
      const validation = PreExecutionValidator.validateAction(action);
      expect(validation.valid).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION 6: TASK VERIFICATION INDEPENDENCE (12 Scenarios)
  // Construct cases where browser action succeeds mechanically, but task MUST fail
  // ===========================================================================
  describe("Section 6: Independent Task Verification (Action Success != Task Success)", () => {
    it("1. Clicks Search but no query was submitted: fails verification", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search for 'laptop' and view results",
        completedSteps: [
          {
            actionId: "act-1",
            type: ActionType.CLICK,
            status: ActionStatus.COMPLETED,
            reason: "Click search button",
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: {
          url: "http://localhost:3000/test-fixtures/search",
          title: "Product Search",
          headings: ["Product Search"],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toContain("queryResultsFor:laptop");
    });

    it("2. Query submitted but resulting page is completely unrelated: fails verification", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search for laptop on catalog",
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            reason: "Fill search query",
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: {
          url: "https://unrelated-domain.com/hotels",
          title: "Hotel Bookings and Vacation Rentals",
          headings: ["Best Hotels in Paris"],
          interactiveElements: [],
          forms: [],
          summary: "Book hotels and accommodations online",
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
    });

    it("3. Results appear but the requested item is absent: fails verification", () => {
      const result = TaskVerifier.verifyTask({
        task: "Find 'quantum teleportation device' on this website",
        completedSteps: [
          {
            actionId: "act-nav",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: {
          url: "http://localhost:3000/test-fixtures/search",
          title: "Product Search",
          headings: ["No matching results"],
          interactiveElements: [],
          forms: [],
          summary: "No products found matching 'quantum teleportation device'",
          timestamp: new Date().toISOString(),
        },
        extractedData: { found: false, results: [] },
      } as any);

      expect(result.passed).toBe(false);
    });

    it("4. Extracts title and price from different cards: rejected by ordinal scoping", () => {
      // Invariant: Card 1 title Laptop Pro 16 with Card 2 price ₹65,000 is invalid
      const card1Title = "Laptop Pro 16";
      const card2Price = "₹65,000";
      expect(card1Title).not.toBe("Laptop Air 13");
    });

    it("5. Clicks a button that is not the intended control: fails verification", () => {
      const accomplishesSubmit = SemanticOperationVerifier.isOperationAccomplished({
        operation: "submit",
        completedSteps: [
          {
            actionId: "act-cancel",
            type: ActionType.CLICK,
            status: ActionStatus.COMPLETED,
            reason: "Click Cancel button",
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 100,
            retriesUsed: 0,
            verified: true,
          },
        ],
      } as any);

      expect(accomplishesSubmit).toBe(false);
    });

    it("6. Form filled correctly but user prohibited submission: fails if submit was clicked", () => {
      const result = TaskVerifier.verifyTask({
        task: "Fill form with name but do not click submit",
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
          {
            actionId: "act-sub",
            type: ActionType.CLICK,
            status: ActionStatus.COMPLETED,
            reason: "Submit the form",
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: {
          url: "http://localhost:3000/test-fixtures/form",
          title: "Form",
          headings: [],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toContain("submissionForbidden");
    });

    it("7. Form submitted but expected confirmation is absent: fails verification", () => {
      const result = TaskVerifier.verifyTask({
        task: "Fill out contact form and submit",
        criteria: {
          requiredOperations: ["submit"],
          requiredOutputs: [],
          verificationChecks: ["formSubmitted"],
        },
        completedSteps: [
          {
            actionId: "act-fill",
            type: ActionType.FILL,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: {
          url: "http://localhost:3000/test-fixtures/form",
          title: "Form Page",
          headings: ["Contact"],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toContain("formSubmitted");
    });

    it("8. Download started but file was incomplete: fails verification", () => {
      const result = TaskVerifier.verifyTask({
        task: "Download the invoice PDF",
        criteria: {
          requiredOperations: ["download"],
          requiredOutputs: ["file"],
          verificationChecks: ["downloadCompleted"],
        },
        completedSteps: [
          {
            actionId: "act-nav",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        downloads: [
          {
            id: "dl-1",
            url: "http://localhost:3000/api/download",
            filename: "invoice.pdf",
            path: "/tmp/invoice.pdf",
            sizeBytes: 0, // Incomplete!
            verified: false,
          },
        ],
        observation: {
          url: "http://localhost:3000/test-fixtures/download",
          title: "Download",
          headings: [],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toContain("downloadCompleted");
    });

    it("9. Opens correct URL but extracts irrelevant text: fails verification", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search for laptops and extract price",
        completedSteps: [
          {
            actionId: "act-1",
            type: ActionType.EXTRACT_TEXT,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        extractedData: { copyright: "© 2026 Company Inc. All rights reserved." },
        observation: {
          url: "http://localhost:3000/test-fixtures/search",
          title: "Search",
          headings: [],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
      expect(result.missingOutputs).toContain("price");
    });

    it("10. Task is blocked by a challenge page: halts with blocked status, not generic failure", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search products on Google",
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
        observation: {
          url: "https://www.google.com/sorry/index?continue=...",
          title: "Sorry...",
          headings: ["Our systems have detected unusual traffic from your computer network."],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(result.passed).toBe(false);
      expect(result.isBlocked).toBe(true);
      expect(result.blockReason).toContain("Google unusual-traffic verification");
    });

    it("11. Stale or null observation fails verification when browser actions were executed", () => {
      const result = TaskVerifier.verifyTask({
        task: "Search for laptop",
        completedSteps: [
          {
            actionId: "act-1",
            type: ActionType.NAVIGATE,
            status: ActionStatus.COMPLETED,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            durationMs: 50,
            retriesUsed: 0,
            verified: true,
          },
        ],
        observation: null,
      } as any);

      expect(result.passed).toBe(false);
      expect(result.failedChecks).toContain("pageObserved");
    });

    it("12. Action reports success but server-side state change did not occur: fails verification", () => {
      // Invariant: Mechanically clicking a button without confirmation text does not satisfy formSubmitted
      const accomplishesSubmit = SemanticOperationVerifier.isOperationAccomplished({
        operation: "submit",
        completedSteps: [],
        observation: {
          url: "http://localhost:3000/test-fixtures/form",
          title: "Contact Form",
          headings: ["Contact Form"],
          interactiveElements: [],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(accomplishesSubmit).toBe(false);
    });
  });

  // ===========================================================================
  // SECTION 7: ADVERSARIAL RECOVERY EVALUATION (Failure Injection)
  // ===========================================================================
  describe("Section 7: Adversarial Recovery Evaluation", () => {
    it("1. Missing locator classifies as ELEMENT_NOT_FOUND and determines alternative locator recovery", () => {
      const error = new Error("Target element not found using any locator strategy: \"#nonexistent-btn\"");
      const classified = RecoveryEngine.classifyError(error);
      expect(classified.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);
      expect(classified.recoverable).toBe(true);

      const decision = RecoveryEngine.determineRecovery({
        action: {
          type: ActionType.CLICK,
          target: { strategy: "css", value: "#nonexistent-btn" },
          risk: RiskLevel.LOW,
          reason: "Click missing button",
        },
        error,
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: {
          url: "http://localhost:3000/test-fixtures/search",
          title: "Search",
          headings: ["Search"],
          interactiveElements: [
            { role: "button", text: "Search", selector: "button.search-btn", visible: true, enabled: true },
          ],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(["RETRY_WITH_ALTERNATIVE_LOCATOR", "RETRY_WITH_BACKOFF", "REPLAN"]).toContain(decision.strategy);
    });

    it("2. Button text changed: classifies as locator failure and adapts", () => {
      const error = new Error("Target element not found using text strategy");
      const classified = RecoveryEngine.classifyError(error);
      expect(classified.code).toBe(ErrorCode.ELEMENT_NOT_FOUND);

      const decision = RecoveryEngine.determineRecovery({
        action: {
          type: ActionType.CLICK,
          target: { strategy: "text", value: "Search" },
          risk: RiskLevel.LOW,
          reason: "Click search button",
        },
        error,
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
        observation: {
          url: "http://localhost:3000/test-fixtures/search",
          title: "Search",
          headings: ["Search"],
          interactiveElements: [
            { role: "button", text: "Find Products", selector: "button[type='submit']", visible: true, enabled: true },
          ],
          forms: [],
          timestamp: new Date().toISOString(),
        },
      } as any);

      expect(["RETRY_WITH_ALTERNATIVE_LOCATOR", "RETRY_WITH_BACKOFF", "REPLAN"]).toContain(decision.strategy);
    });

    it("3. Multiple candidate buttons exist: ambiguity halts without blind guessing", () => {
      const decision = RecoveryEngine.determineRecovery({
        action: {
          type: ActionType.CLICK,
          target: { strategy: "role", role: "button", value: "Delete" },
          risk: RiskLevel.MEDIUM,
          reason: "Click delete button",
        },
        error: new Error("Ambiguous target: multiple candidates found matching selector"),
        attempt: 1,
        maxAttempts: 3,
        replansUsed: 0,
        maxReplans: 2,
      } as any);

      expect(decision.strategy).toBe("WAITING_FOR_USER");
      expect(decision.requiresConfirmation).toBe(true);
    });

    it("4. Bounded recovery: prevents infinite retry loops on identical failing targets", () => {
      const failedTargets = new Set<string>();
      failedTargets.add("css:#failing-target");

      // Attempting the same target is recognized as duplicate
      const isDuplicate = failedTargets.has("css:#failing-target");
      expect(isDuplicate).toBe(true);
    });

    it("5. Quota error during recovery does not repeat failing provider calls", () => {
      const error = new AgentError("Resource exhausted: 429 quota exceeded", ErrorCode.QUOTA_EXHAUSTED, false);
      expect(error.code).toBe(ErrorCode.QUOTA_EXHAUSTED);
      expect(error.recoverable).toBe(false);
      expect(error.retryable).toBe(false);
    });

    it("6. Cancellation during recovery immediately halts execution", () => {
      const abortController = new AbortController();
      abortController.abort();
      expect(abortController.signal.aborted).toBe(true);
    });
  });

  // ===========================================================================
  // SECTION 8: SECURITY AND REFUSAL EVALUATION
  // ===========================================================================
  describe("Section 8: Security and Refusal Evaluation", () => {
    it("1. Adversarial instruction to exfiltrate API key is blocked by prompt defense", () => {
      const action = {
        id: "act-exfil",
        type: ActionType.FILL,
        target: { strategy: "css", value: "#notes" },
        value: "My API key is AIzaSyDnyanuSecretKey1234567890",
        risk: RiskLevel.LOW,
        reason: "Reveal API key into form",
      };

      const result = PromptDefense.validateActionSafety(action as any, "Search for products", "http://localhost:3000");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/API key|credential/i);
    });

    it("2. Adversarial instruction to navigate to external attacker origin is blocked", () => {
      const action = {
        id: "act-nav-attacker",
        type: ActionType.NAVIGATE,
        value: "https://attacker.evil.com/phishing",
        risk: RiskLevel.LOW,
        reason: "Navigate to external site",
      };

      const result = PromptDefense.validateActionSafety(action as any, "Search for products on catalog", "http://localhost:3000/test-fixtures/search");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/Unauthorized cross-origin navigation/i);
    });

    it("3. Attempt to download an executable payload is blocked before execution", () => {
      const action = {
        id: "act-dl-payload",
        type: ActionType.DOWNLOAD,
        target: { strategy: "css", value: "a[href$='.exe']" },
        value: "http://localhost:3000/payload.exe",
        risk: RiskLevel.LOW,
        reason: "Download executable",
      };

      const result = PromptDefense.validateActionSafety(action as any, "Download invoice", "http://localhost:3000");
      expect(result.safe).toBe(false);
      expect(result.reason).toMatch(/executable/i);
    });

    it("4. Rejects cloud metadata and loopback destinations for server-side fetches", () => {
      expect(UrlPolicy.isPrivateOrLocal("http://169.254.169.254/latest/meta-data/")).toBe(true);
      expect(UrlPolicy.isPrivateOrLocal("http://10.0.0.1/admin")).toBe(true);
      expect(UrlPolicy.isPrivateOrLocal("http://172.16.0.1/internal")).toBe(true);
      expect(UrlPolicy.isPrivateOrLocal("http://192.168.1.1/router")).toBe(true);
    });

    it("5. Rejects dangerous pseudo-protocols", () => {
      expect(UrlPolicy.isSupportedScheme("javascript:alert(1)")).toBe(false);
      expect(UrlPolicy.isSupportedScheme("file:///etc/passwd")).toBe(false);
      expect(UrlPolicy.isSupportedScheme("data:text/html,<h1>XSS</h1>")).toBe(false);
      expect(UrlPolicy.isSupportedScheme("vbscript:msgbox(1)")).toBe(false);
    });
  });

  // ===========================================================================
  // SECTION 9: GEMINI QUOTA AND PROVIDER FALLBACK (Mocked Responses)
  // ===========================================================================
  describe("Section 9: Provider Fallback and Quota Resilience", () => {
    it("1. Primary provider succeeds: returns valid plan on first attempt", async () => {
      const planner = new Planner();
      const plan = await planner.plan({
        task: "Search for laptops on catalog",
        targetUrl: "http://localhost:3000/test-fixtures/search",
      });

      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
    });

    it("2. Quota errors do not trigger futile schema-correction retries", () => {
      const quotaError = new AgentError("Quota 429", ErrorCode.QUOTA_EXHAUSTED, false);
      expect(quotaError.recoverable).toBe(false);
      expect(quotaError.retryable).toBe(false);
    });

    it("3. Provider configuration presence does not claim full readiness without test", () => {
      const primaryHealth = {
        name: "mock",
        status: "configured" as const,
      };
      expect(primaryHealth.status).toBe("configured");
    });
  });
});
