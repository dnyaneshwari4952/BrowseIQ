import { describe, it, expect } from "vitest";
import { RecoveryEngine } from "@/lib/agent/recovery-engine";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { ActionType, LocatorStrategy } from "@/lib/types/actions";
import { PageObservation } from "@/lib/types/browser";

describe("RecoveryEngine (Part 10 & 11)", () => {
  it("classifies error types into the standard 17 ErrorCodes", () => {
    expect(RecoveryEngine.classifyError(new Error("Timeout 30000ms exceeded")).code).toBe(ErrorCode.TIMEOUT);
    expect(RecoveryEngine.classifyError(new Error("Cloudflare turnstile captcha detected")).code).toBe(
      ErrorCode.CAPTCHA_DETECTED
    );
    expect(RecoveryEngine.classifyError(new Error("Target element matches 3 ambiguous elements")).code).toBe(
      ErrorCode.ELEMENT_AMBIGUOUS
    );
    expect(RecoveryEngine.classifyError(new Error("net::ERR_CONNECTION_REFUSED")).code).toBe(
      ErrorCode.NETWORK_ERROR
    );
    expect(RecoveryEngine.classifyError(new Error("Button is disabled")).code).toBe(
      ErrorCode.ELEMENT_DISABLED
    );
  });

  it("triggers WAITING_FOR_USER on CAPTCHA detection", () => {
    const decision = RecoveryEngine.determineRecovery({
      action: { id: "a1", type: ActionType.CLICK, reason: "Click submit" },
      error: new AgentError("CAPTCHA required", ErrorCode.CAPTCHA_DETECTED),
      attempt: 1,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 3,
    });

    expect(decision.strategy).toBe("WAITING_FOR_USER");
    expect(decision.terminal).toBe(false);
  });

  it("finds alternative semantic locator when button text differs", () => {
    const observation: PageObservation = {
      url: "http://localhost:3000/test-fixtures/dom-change",
      title: "DOM Change Test",
      headings: [],
      interactiveElements: [
        {
          id: "btn-1",
          role: "button",
          tagName: "BUTTON",
          text: "Find Products",
          isVisible: true,
          isEnabled: true,
          locatorCandidates: [],
        },
      ],
      forms: [],
      dialogs: [],
      summary: "",
      timestamp: "",
      tabId: "tab-1",
    };

    const alternative = RecoveryEngine.findAlternativeLocator(
      { strategy: LocatorStrategy.TEXT, value: "Search" },
      observation
    );

    // "Find Products" matches search/find intent
    expect(alternative).toBeDefined();
    expect(alternative?.value).toBe("Find Products");
  });

  it("decides to REPLAN when max action attempts exceeded but replans remain", () => {
    const decision = RecoveryEngine.determineRecovery({
      action: { id: "a1", type: ActionType.CLICK, reason: "Click submit" },
      error: new AgentError("Locator failed", ErrorCode.ELEMENT_NOT_FOUND),
      attempt: 3,
      maxAttempts: 3,
      replansUsed: 0,
      maxReplans: 3,
    });

    expect(decision.strategy).toBe("REPLAN");
    expect(decision.terminal).toBe(false);
  });

  it("fails terminally when both attempts and replan revisions are exhausted", () => {
    const decision = RecoveryEngine.determineRecovery({
      action: { id: "a1", type: ActionType.CLICK, reason: "Click submit" },
      error: new AgentError("Locator failed", ErrorCode.ELEMENT_NOT_FOUND),
      attempt: 3,
      maxAttempts: 3,
      replansUsed: 3,
      maxReplans: 3,
    });

    expect(decision.strategy).toBe("FAIL");
    expect(decision.terminal).toBe(true);
  });
});
