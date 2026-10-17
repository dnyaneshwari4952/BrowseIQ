import { describe, it, expect } from "vitest";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { ActionVerifier } from "@/lib/agent/action-verifier";
import { ActionType, ActionStatus } from "@/lib/types/actions";

describe("TaskVerifier & False-Success Prevention (Part 2, 3, 4)", () => {
  it("REJECTS false success when searching for laptop on example.com returns generic 'Example Domain'", () => {
    // The exact bug described by the user in Part 2:
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Open the search page, query for 'laptop', and extract the title and price of the first result.",
      targetUrl: "https://example.com",
      criteria: {
        requiredOperations: ["navigate", "search", "extract"],
        requiredOutputs: ["title", "price"],
        verificationChecks: ["searchSubmitted", "resultsExist", "titleExtracted", "priceExtracted"],
      },
      completedSteps: [
        {
          actionId: "step-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 400,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "step-2",
          type: ActionType.EXTRACT_TEXT,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 150,
          extractedData: "Example Domain",
          retriesUsed: 0,
          verified: true,
        },
      ],
      extractedData: {
        title: "Example Domain",
        url: "https://example.com",
      },
      latestObservation: {
        url: "https://example.com",
        title: "Example Domain",
        headings: ["Example Domain"],
        interactiveElements: [
          {
            id: "link-1",
            role: "link",
            tagName: "A",
            text: "More information...",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [{ strategy: "role", value: "link: More information...", confidence: 0.95 }],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Example Domain page with one link.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      },
    });

    // MUST NOT pass!
    expect(result.passed).toBe(false);
    expect(result.missingOutputs).toContain("price");
    expect(result.reason).toContain("does not contain a search interface or results matching 'laptop'");
  });

  it("REJECTS task when requested download was not completed", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Download the monthly invoice PDF from the billing page",
      completedSteps: [
        {
          actionId: "step-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 300,
          retriesUsed: 0,
          verified: true,
        },
      ],
      extractedData: null,
    });

    expect(result.passed).toBe(false);
    expect(result.missingOutputs).toContain("downloadedFile");
  });

  it("PASSES when all required operations, outputs, and checks are satisfied", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Search for laptop and extract the title and price of the first result.",
      criteria: {
        requiredOperations: ["navigate", "search", "extract"],
        requiredOutputs: ["title", "price"],
        verificationChecks: ["searchSubmitted", "resultsExist"],
      },
      completedSteps: [
        {
          actionId: "step-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 350,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "step-2",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 120,
          retriesUsed: 0,
          verified: true,
          ...({ value: "laptop" } as any),
        },
        {
          actionId: "step-3",
          type: ActionType.EXTRACT_TEXT,
          status: ActionStatus.COMPLETED,
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        },
      ],
      extractedData: {
        title: "Laptop Pro 16",
        price: "₹75,000",
        rating: 4.8,
      },
      latestObservation: {
        url: "http://localhost:3000/test-fixtures/search?q=laptop",
        title: "Product Search - Laptop",
        headings: ["Search Results for 'laptop'"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Search results with 3 laptop products.",
        timestamp: new Date().toISOString(),
        tabId: "tab-1",
      },
    });

    expect(result.passed).toBe(true);
    expect(result.missingOutputs).toHaveLength(0);
  });
});

describe("ActionVerifier", () => {
  it("verifies fill action value against observation", () => {
    const afterObs = {
      url: "https://example.com/login",
      title: "Login",
      headings: [],
      interactiveElements: [
        {
          id: "email-input",
          name: "email",
          tagName: "INPUT",
          value: "test@example.com",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
      ],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const result = ActionVerifier.verifyAction({
      action: {
        id: "act-1",
        type: ActionType.FILL,
        target: { strategy: "name", value: "email" },
        value: "test@example.com",
        reason: "Enter email address",
      },
      afterObservation: afterObs,
    });

    expect(result.verified).toBe(true);
  });

  it("fails when fill value does not match expected value", () => {
    const afterObs = {
      url: "https://example.com/login",
      title: "Login",
      headings: [],
      interactiveElements: [
        {
          id: "email-input",
          name: "email",
          tagName: "INPUT",
          value: "wrong@example.com",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
      ],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: new Date().toISOString(),
      tabId: "tab-1",
    };

    const result = ActionVerifier.verifyAction({
      action: {
        id: "act-1",
        type: ActionType.FILL,
        target: { strategy: "name", value: "email" },
        value: "test@example.com",
        reason: "Enter email address",
      },
      afterObservation: afterObs,
    });

    expect(result.verified).toBe(false);
    expect(result.reason).toContain("does not match expected");
  });
});
