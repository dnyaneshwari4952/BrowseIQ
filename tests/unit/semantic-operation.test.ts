import { describe, it, expect } from "vitest";
import { SemanticOperationVerifier } from "@/lib/agent/semantic-operation-verifier";
import { TaskVerifier } from "@/lib/agent/task-verifier";
import { ActionType, ActionStatus } from "@/lib/types/actions";

describe("SemanticOperationVerifier (Requirements 1, 2, 3, 4, 5)", () => {
  // Case 1
  it("Case 1: requiredOperation = submit, completed action = click submit button → PASS", () => {
    const result = SemanticOperationVerifier.isOperationAccomplished({
      operation: "submit",
      completedSteps: [
        {
          actionId: "act-submit",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          target: { strategy: "role", role: "button", value: "Submit Contact Form" },
          reason: "Submit form",
          verified: true,
        },
      ],
    });
    expect(result).toBe(true);
  });

  // Case 2
  it("Case 2: requiredOperation = submit, completed action = press Enter inside form → PASS when form context confirms submission", () => {
    const result = SemanticOperationVerifier.isOperationAccomplished({
      operation: "submit",
      completedSteps: [
        {
          actionId: "act-enter",
          type: ActionType.PRESS,
          status: ActionStatus.COMPLETED,
          value: "Enter",
          reason: "Submit form via Enter keypress",
          verified: true,
        },
      ],
    });
    expect(result).toBe(true);
  });

  // Case 3
  it("Case 3: requiredOperation = submit, completed action = click Cancel → FAIL", () => {
    const result = SemanticOperationVerifier.isOperationAccomplished({
      operation: "submit",
      completedSteps: [
        {
          actionId: "act-cancel",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          target: { strategy: "text", value: "Cancel" },
          reason: "Dismiss modal by clicking cancel",
          verified: true,
        },
      ],
    });
    expect(result).toBe(false);
  });

  // Case 4
  it("Case 4: requiredOperation = submit, completed action = click Next → FAIL", () => {
    const result = SemanticOperationVerifier.isOperationAccomplished({
      operation: "submit",
      completedSteps: [
        {
          actionId: "act-next",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          target: { strategy: "text", value: "Next" },
          reason: "Go to next step in pagination",
          verified: true,
        },
      ],
    });
    expect(result).toBe(false);
  });

  // Case 5
  it("Case 5: requiredOperation = submit, completed action = click generic button → FAIL unless contextual evidence proves submission", () => {
    // 5a: Generic click without evidence → FAIL
    const withoutEvidence = SemanticOperationVerifier.isOperationAccomplished({
      operation: "submit",
      completedSteps: [
        {
          actionId: "act-generic",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          target: { strategy: "css", value: "#action-btn" },
          reason: "Click button",
          verified: true,
        },
      ],
      observation: {
        url: "http://localhost:3000/form",
        title: "Contact Form",
        headings: ["Contact Form"],
        interactiveElements: [],
        forms: [],
        dialogs: [],
        summary: "Form awaiting submission.",
        timestamp: "",
        tabId: "tab-1",
      },
    });
    expect(withoutEvidence).toBe(false);

    // 5b: Generic click with confirmation state evidence → PASS
    const withConfirmationEvidence = SemanticOperationVerifier.isOperationAccomplished({
      operation: "submit",
      completedSteps: [
        {
          actionId: "act-generic",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          target: { strategy: "css", value: "#action-btn" },
          reason: "Click button",
          verified: true,
        },
      ],
      observation: {
        url: "http://localhost:3000/form",
        title: "Contact Form",
        headings: ["Form submitted successfully!"],
        interactiveElements: [
          {
            id: "submission-confirmation",
            tagName: "DIV",
            text: "Form submitted successfully!",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Form submitted successfully!",
        timestamp: "",
        tabId: "tab-1",
      },
    });
    expect(withConfirmationEvidence).toBe(true);
  });

  // Case 6
  it("Case 6: requiredOperation = search, completed actions = fill + click → PASS", () => {
    const result = SemanticOperationVerifier.isOperationAccomplished({
      operation: "search",
      completedSteps: [
        {
          actionId: "act-fill",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          target: { strategy: "placeholder", value: "Search products..." },
          value: "laptop",
          reason: "Enter search query",
          verified: true,
        },
        {
          actionId: "act-click",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          target: { strategy: "role", role: "button", value: "Search" },
          reason: "Execute search query",
          verified: true,
        },
      ],
    });
    expect(result).toBe(true);
  });

  // Case 7
  it("Case 7: requiredOperation = extract, completed action = extract_text → PASS", () => {
    const result = SemanticOperationVerifier.isOperationAccomplished({
      operation: "extract",
      completedSteps: [
        {
          actionId: "act-extract",
          type: ActionType.EXTRACT_TEXT,
          status: ActionStatus.COMPLETED,
          extractedData: "Laptop Pro 16",
          verified: true,
        },
      ],
    });
    expect(result).toBe(true);
  });
});

describe("Negation Safety & Form Submission in TaskVerifier (Requirement 6)", () => {
  it("PASSES 'Fill the form and submit' when fill + submit click occurs", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Fill the contact form with name and email, then submit.",
      criteria: {
        requiredOperations: ["navigate", "fill", "submit"],
        requiredOutputs: [],
        verificationChecks: ["formSubmitted"],
      },
      planActions: [
        { id: "nav-1", type: ActionType.NAVIGATE, value: "http://localhost:3000/test-fixtures/form", reason: "Navigate to form" },
        { id: "fill-name", type: ActionType.FILL, target: { strategy: "name", value: "fullName" }, value: "Alex Rivera", reason: "Fill name" },
        { id: "fill-email", type: ActionType.FILL, target: { strategy: "name", value: "email" }, value: "alex@example.com", reason: "Fill email" },
        { id: "click-submit", type: ActionType.CLICK, target: { strategy: "role", role: "button", value: "Submit Contact Form" }, reason: "Submit form" },
      ],
      completedSteps: [
        {
          actionId: "nav-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "fill-name",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "fill-email",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "click-submit",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 80,
          retriesUsed: 0,
          verified: true,
        },
      ],
      latestObservation: {
        url: "http://localhost:3000/test-fixtures/form",
        title: "Contact Form Submission",
        headings: ["Contact Form Submission"],
        interactiveElements: [
          {
            id: "submission-confirmation",
            tagName: "DIV",
            text: "Form submitted successfully!",
            isVisible: true,
            isEnabled: true,
            locatorCandidates: [],
          },
        ],
        forms: [],
        dialogs: [],
        summary: "Form submitted successfully!",
        timestamp: "",
        tabId: "tab-1",
      },
    });

    expect(result.passed).toBe(true);
    expect(result.failedChecks).toHaveLength(0);
  });

  it("PASSES 'Fill the form but do NOT submit' when fill occurs and submit is withheld", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Fill the contact form with name and email, but do not submit.",
      criteria: {
        requiredOperations: ["navigate", "fill"],
        requiredOutputs: [],
        verificationChecks: ["submissionOmitted"],
      },
      planActions: [
        { id: "nav-1", type: ActionType.NAVIGATE, value: "http://localhost:3000/test-fixtures/form", reason: "Navigate to form" },
        { id: "fill-name", type: ActionType.FILL, target: { strategy: "name", value: "fullName" }, value: "Alex Rivera", reason: "Fill name" },
        { id: "fill-email", type: ActionType.FILL, target: { strategy: "name", value: "email" }, value: "alex@example.com", reason: "Fill email" },
      ],
      completedSteps: [
        {
          actionId: "nav-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "fill-name",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "fill-email",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.failedChecks).not.toContain("requiredOperation:submit");
    expect(result.failedChecks).not.toContain("formSubmitted");
  });

  it("FAILS 'Fill the form but do NOT submit' if agent mistakenly clicks submit", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Fill the contact form with name and email, but do not submit.",
      criteria: {
        requiredOperations: ["navigate", "fill"],
        requiredOutputs: [],
        verificationChecks: ["submissionOmitted"],
      },
      planActions: [
        { id: "fill-name", type: ActionType.FILL, target: { strategy: "name", value: "fullName" }, reason: "Fill name" },
        { id: "click-submit", type: ActionType.CLICK, target: { strategy: "role", role: "button", value: "Submit Contact Form" }, reason: "Submit form" },
      ],
      completedSteps: [
        {
          actionId: "fill-name",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "click-submit",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toContain("submissionForbidden");
  });

  it("FAILS 'Fill the form and save draft' if agent mistakenly clicks submit instead of saving draft", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Fill the form and save draft.",
      criteria: {
        requiredOperations: ["navigate", "fill"],
        requiredOutputs: [],
        verificationChecks: [],
      },
      planActions: [
        { id: "click-submit", type: ActionType.CLICK, target: { strategy: "role", role: "button", value: "Submit Application" }, reason: "Submit form" },
      ],
      completedSteps: [
        {
          actionId: "click-submit",
          type: ActionType.CLICK,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failedChecks).toContain("submissionForbidden");
  });

  it("PASSES 'Fill the form but don\\'t click submit' when submit is withheld", () => {
    const result = TaskVerifier.verifyTaskCompletion({
      taskDescription: "Fill the form but don't click submit.",
      criteria: {
        requiredOperations: ["navigate", "fill"],
        requiredOutputs: [],
        verificationChecks: ["submissionOmitted"],
      },
      planActions: [
        { id: "nav-1", type: ActionType.NAVIGATE, value: "http://localhost:3000/test-fixtures/form", reason: "Navigate to form" },
        { id: "fill-name", type: ActionType.FILL, target: { strategy: "name", value: "fullName" }, value: "Alex Rivera", reason: "Fill name" },
      ],
      completedSteps: [
        {
          actionId: "nav-1",
          type: ActionType.NAVIGATE,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 100,
          retriesUsed: 0,
          verified: true,
        },
        {
          actionId: "fill-name",
          type: ActionType.FILL,
          status: ActionStatus.COMPLETED,
          startTime: "",
          endTime: "",
          durationMs: 50,
          retriesUsed: 0,
          verified: true,
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.failedChecks).not.toContain("requiredOperation:submit");
    expect(result.failedChecks).not.toContain("formSubmitted");
    expect(result.failedChecks).not.toContain("submissionForbidden");
  });
});

