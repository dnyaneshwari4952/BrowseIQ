import { describe, it, expect } from "vitest";
import { ActionSchema, ActionType, LocatorStrategy, RiskLevel } from "@/lib/types/actions";

describe("Action Schema Validation", () => {
  it("validates a compliant action", () => {
    const validAction = {
      id: "action-1",
      type: ActionType.CLICK,
      target: {
        strategy: LocatorStrategy.ROLE,
        value: "Search",
        role: "button",
      },
      reason: "Click search button to submit search query",
      risk: RiskLevel.LOW,
      expectedState: {
        elementAppears: ".search-results",
      },
      timeout: 10000,
    };

    const parsed = ActionSchema.safeParse(validAction);
    expect(parsed.success).toBe(true);
  });

  it("rejects an action without a reason (mandatory for auditability)", () => {
    const invalidAction = {
      id: "action-2",
      type: ActionType.CLICK,
      target: {
        strategy: LocatorStrategy.ROLE,
        value: "Submit",
      },
      // missing reason
    };

    const parsed = ActionSchema.safeParse(invalidAction);
    expect(parsed.success).toBe(false);
  });

  it("rejects an action with an unsupported action type", () => {
    const invalidAction = {
      id: "action-3",
      type: "arbitrary_eval_code", // prohibited!
      reason: "Malicious or hallucinated action",
    };

    const parsed = ActionSchema.safeParse(invalidAction);
    expect(parsed.success).toBe(false);
  });
});
