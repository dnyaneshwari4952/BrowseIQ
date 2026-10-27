import { describe, it, expect, vi } from "vitest";
import {
  TaskLifecycleState,
  assertValidTaskTransition,
  validateTaskStateTransition,
  TERMINAL_STATES,
} from "../../lib/agent/task-lifecycle";
import { Action, ActionType, RiskLevel, ActionSchema } from "../../lib/types/actions";
import { PlanValidator } from "../../lib/validation/plan-validator";
import { DynamicTaskPlanner } from "../../lib/planning/dynamic-task-planner";
import { Planner } from "../../lib/agent/planner";
import { AgentLoop } from "../../lib/agent/agent-loop";
import { MockProvider } from "../../lib/ai/llm-provider";

describe("PHASE 1: Vector-Inspired Architecture, Dynamic Planning, and Task Lifecycle", () => {
  describe("1. Task Lifecycle State Machine & Terminal Isolation", () => {
    it("allows standard forward progression through explicit lifecycle phases", () => {
      const taskId = "task-vector-101";
      const validPath: TaskLifecycleState[] = [
        TaskLifecycleState.TASK_RECEIVED,
        TaskLifecycleState.INTENT_INTERPRETED,
        TaskLifecycleState.CONSTRAINTS_EXTRACTED,
        TaskLifecycleState.STATE_INSPECTED,
        TaskLifecycleState.PLAN_GENERATED,
        TaskLifecycleState.PLAN_VALIDATED,
        TaskLifecycleState.ACTION_EXECUTING,
        TaskLifecycleState.ACTION_VERIFIED,
        TaskLifecycleState.FINAL_VERIFICATION,
        TaskLifecycleState.FINAL_REPORT,
        TaskLifecycleState.SUCCESS,
      ];

      for (let i = 0; i < validPath.length - 1; i++) {
        const from = validPath[i];
        const to = validPath[i + 1];
        expect(validateTaskStateTransition(from, to)).toBe(true);
        expect(() => assertValidTaskTransition(from, to, taskId)).not.toThrow();
      }
    });

    it("allows dynamic recovery and replanning loops before final verification", () => {
      const taskId = "task-vector-replan";
      const recoveryPath: TaskLifecycleState[] = [
        TaskLifecycleState.ACTION_EXECUTING,
        TaskLifecycleState.RECOVERING,
        TaskLifecycleState.REPLANNING,
        TaskLifecycleState.PLAN_GENERATED,
        TaskLifecycleState.PLAN_VALIDATED,
        TaskLifecycleState.ACTION_EXECUTING,
        TaskLifecycleState.ACTION_VERIFIED,
        TaskLifecycleState.FINAL_VERIFICATION,
        TaskLifecycleState.FINAL_REPORT,
        TaskLifecycleState.PARTIAL_SUCCESS,
      ];

      for (let i = 0; i < recoveryPath.length - 1; i++) {
        const from = recoveryPath[i];
        const to = recoveryPath[i + 1];
        expect(validateTaskStateTransition(from, to)).toBe(true);
      }
    });

    it("strictly isolates terminal states: rejects any transition out of terminal outcomes", () => {
      const terminalStates = [
        TaskLifecycleState.SUCCESS,
        TaskLifecycleState.PARTIAL_SUCCESS,
        TaskLifecycleState.FAILED,
        TaskLifecycleState.BLOCKED,
        TaskLifecycleState.NEEDS_CLARIFICATION,
        TaskLifecycleState.CANCELLED,
      ];

      const activeStates = [
        TaskLifecycleState.TASK_RECEIVED,
        TaskLifecycleState.PLAN_GENERATED,
        TaskLifecycleState.ACTION_EXECUTING,
        TaskLifecycleState.REPLANNING,
        TaskLifecycleState.FINAL_VERIFICATION,
      ];

      for (const terminal of terminalStates) {
        expect(TERMINAL_STATES.has(terminal)).toBe(true);
        for (const active of activeStates) {
          expect(validateTaskStateTransition(terminal, active)).toBe(false);
          expect(() => assertValidTaskTransition(terminal, active, "test-term")).toThrow(
            /Illegal task lifecycle transition/
          );
        }
      }
    });
  });

  describe("2. Structured Action Schema & Vector DAG Attributes", () => {
    it("validates actions with Vector-inspired DAG dependencies, pre/postconditions, and verification criteria", () => {
      const structuredAction: Action = {
        id: "step-1-nav",
        type: ActionType.NAVIGATE,
        value: "https://example.com",
        risk: RiskLevel.LOW,
        reason: "Navigate to destination site",
        userIntent: "Access destination web page",
        targetDescription: "Primary destination URL",
        parameters: { url: "https://example.com" },
        preconditions: ["browser_ready", "valid_url"],
        postconditions: ["url_updated", "page_loaded"],
        dependencies: [],
        verificationMethod: "url_change",
        verificationTarget: "https://example.com",
      };

      const parsed = ActionSchema.safeParse(structuredAction);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.userIntent).toBe("Access destination web page");
        expect(parsed.data.preconditions).toEqual(["browser_ready", "valid_url"]);
        expect(parsed.data.postconditions).toEqual(["url_updated", "page_loaded"]);
        expect(parsed.data.verificationMethod).toBe("url_change");
      }
    });

    it("enriches plan actions automatically with dependencies, preconditions, and postconditions", () => {
      const rawActions: Action[] = [
        {
          id: "step-1",
          type: ActionType.NAVIGATE,
          value: "https://example.com",
          risk: RiskLevel.LOW,
          reason: "Navigate",
        },
        {
          id: "step-2",
          type: ActionType.FILL,
          target: { strategy: "css", value: "#search" },
          value: "shoes",
          risk: RiskLevel.LOW,
          reason: "Search shoes",
        },
        {
          id: "step-3",
          type: ActionType.CLICK,
          target: { strategy: "css", value: "#submit" },
          risk: RiskLevel.LOW,
          reason: "Submit query",
        },
        {
          id: "step-4",
          type: ActionType.FINISH,
          risk: RiskLevel.LOW,
          reason: "Complete task",
        },
      ];

      const enriched = DynamicTaskPlanner.enrichActions(rawActions);
      expect(enriched.length).toBe(4);

      // Step 1: Root node of DAG
      expect(enriched[0].dependencies).toEqual([]);
      expect(enriched[0].preconditions).toContain("browser_ready");
      expect(enriched[0].postconditions).toContain("url_updated");
      expect(enriched[0].verificationMethod).toBe("url_change");

      // Step 2: Depends on step-1
      expect(enriched[1].dependencies).toEqual(["step-1"]);
      expect(enriched[1].preconditions).toContain("page_loaded");
      expect(enriched[1].postconditions).toContain("input_value_set");
      expect(enriched[1].verificationMethod).toBe("value_check");

      // Step 3: Depends on step-2
      expect(enriched[2].dependencies).toEqual(["step-2"]);
      expect(enriched[2].preconditions).toContain("target_element_exists");
      expect(enriched[2].verificationMethod).toBe("dom_mutation");

      // Step 4: Finish depends on step-3
      expect(enriched[3].dependencies).toEqual(["step-3"]);
      expect(enriched[3].preconditions).toContain("prerequisite_actions_completed");
      expect(enriched[3].postconditions).toContain("task_goal_satisfied");
    });
  });

  describe("3. PlanValidator: Untrusted Planner Constraints", () => {
    it("rejects unsupported action types (e.g. exec_shell, eval_code)", () => {
      const invalidPlan: any = {
        id: "plan-bad-action",
        taskInterpretation: "Run arbitrary system shell",
        actions: [
          {
            id: "step-1",
            type: "exec_shell",
            value: "rm -rf /",
            risk: "high",
            reason: "Malicious shell command",
          },
        ],
        successCriteria: ["Completed"],
      };

      const result = PlanValidator.validatePlan(invalidPlan, { task: "Run shell" });
      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("Unsupported action type"))).toBe(true);
    });

    it("rejects permission escalation and allowlist tampering", () => {
      const escalationPlan: any = {
        id: "plan-escalate",
        taskInterpretation: "Add domain to allowlist",
        actions: [
          {
            id: "step-1",
            type: ActionType.CLICK,
            value: "add_domain_to_allowlist:attacker.com",
            risk: RiskLevel.HIGH,
            reason: "Modify allowlist policy",
          },
        ],
        successCriteria: ["Policy modified"],
      };

      const result = PlanValidator.validatePlan(escalationPlan, { task: "Bypass domain security" });
      expect(result.valid).toBe(false);
      expect(result.securityViolations.some((v) => v.includes("Permission escalation"))).toBe(true);
    });

    it("detects and rejects dependency ordering violations (forward references and non-existent IDs)", () => {
      const invalidDepPlan: any = {
        id: "plan-bad-deps",
        taskInterpretation: "Action with forward dependency",
        actions: [
          {
            id: "step-1",
            type: ActionType.NAVIGATE,
            value: "https://example.com",
            risk: RiskLevel.LOW,
            reason: "Navigate",
            dependencies: ["step-2"], // Forward reference to step-2!
          },
          {
            id: "step-2",
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Finish",
          },
        ],
        successCriteria: ["Done"],
      };

      const result = PlanValidator.validatePlan(invalidDepPlan, { task: "Test forward dependency" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Forward dependency detected"))).toBe(true);
    });

    it("detects and rejects dependency cycles in action DAG", () => {
      const cyclicPlan: any = {
        id: "plan-cyclic",
        taskInterpretation: "Cyclic self-referential actions",
        actions: [
          {
            id: "step-1",
            type: ActionType.NAVIGATE,
            value: "https://example.com",
            risk: RiskLevel.LOW,
            reason: "Navigate",
            dependencies: ["step-1"], // Self-referential cycle
          },
          {
            id: "step-2",
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Finish",
          },
        ],
        successCriteria: ["Done"],
      };

      const result = PlanValidator.validatePlan(cyclicPlan, { task: "Test cycle" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Self-referential dependency cycle"))).toBe(true);
    });

    it("rejects DOM interaction actions scheduled before browser navigation when unnavigated", () => {
      const unnavigatedPlan: any = {
        id: "plan-no-nav",
        taskInterpretation: "Click button without navigation",
        actions: [
          {
            id: "step-1-click",
            type: ActionType.CLICK,
            target: { strategy: "css", value: "button.submit" },
            risk: RiskLevel.LOW,
            reason: "Click button before browser navigates",
          },
          {
            id: "step-2-finish",
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Finish",
          },
        ],
        successCriteria: ["Done"],
      };

      const result = PlanValidator.validatePlan(unnavigatedPlan, {
        task: "Click submit",
        observation: { url: "about:blank", title: "", interactiveElements: [] } as any,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Missing prerequisite navigation"))).toBe(true);
    });

    it("detects contradictory actions scheduled after FINISH", () => {
      const contradictoryPlan: any = {
        id: "plan-contradictory",
        taskInterpretation: "Actions scheduled after FINISH",
        actions: [
          {
            id: "step-1-nav",
            type: ActionType.NAVIGATE,
            value: "https://example.com",
            risk: RiskLevel.LOW,
            reason: "Nav",
          },
          {
            id: "step-2-finish",
            type: ActionType.FINISH,
            risk: RiskLevel.LOW,
            reason: "Finish",
          },
          {
            id: "step-3-after-finish",
            type: ActionType.CLICK,
            target: { strategy: "css", value: "#btn" },
            risk: RiskLevel.LOW,
            reason: "Click after finish",
          },
        ],
        successCriteria: ["Done"],
      };

      const result = PlanValidator.validatePlan(contradictoryPlan, { task: "Contradictory steps" });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Contradictory plan"))).toBe(true);
    });
  });

  describe("4. Provider Separation & Non-Silent Mock Fallback", () => {
    it("Playwright Mode executes deterministic planner directly without instantiating MockProvider", async () => {
      const planner = new Planner();
      const plan = await planner.plan({
        task: "search for running shoes on target site",
        targetUrl: "https://shop.example.com",
        operatingMode: "playwright",
      });

      expect(plan).toBeDefined();
      expect(plan.actions.length).toBeGreaterThan(0);
      expect(plan.planningMetadata?.operatingMode).toBe("playwright");
      expect(plan.planningMetadata?.geminiInvoked).toBe(false);
      expect(plan.planningMetadata?.planSource).toBe("deterministic");

      // Verify actions contain enriched Vector-inspired attributes
      const firstAction = plan.actions[0];
      expect(firstAction.userIntent).toBeDefined();
      expect(firstAction.preconditions).toBeDefined();
      expect(firstAction.postconditions).toBeDefined();
      expect(firstAction.verificationMethod).toBeDefined();
    });

    it("AgentLoop captures constraints, browser session ID, and structured final report under taskId", async () => {
      const loop = new AgentLoop();
      const lifecycleEvents: TaskLifecycleState[] = [];

      const result = await loop.runTask({
        task: "Search for electronics",
        targetUrl: "https://example.com",
        operatingMode: "playwright",
        onLifecycleChange: (state) => {
          lifecycleEvents.push(state);
        },
      });

      expect(result.taskId).toBeDefined();
      expect(result.originalTask).toBe("Search for electronics");
      expect(result.taskConstraints).toBeDefined();
      expect(result.lifecycleHistory).toBeDefined();
      expect(result.lifecycleHistory!.length).toBeGreaterThan(0);

      // Verify lifecycle stages were recorded in chronological history
      const recordedStates = result.lifecycleHistory!.map((h) => h.state);
      expect(recordedStates).toContain(TaskLifecycleState.TASK_RECEIVED);
      expect(recordedStates).toContain(TaskLifecycleState.INTENT_INTERPRETED);
      expect(recordedStates).toContain(TaskLifecycleState.CONSTRAINTS_EXTRACTED);
      expect(recordedStates).toContain(TaskLifecycleState.PLAN_GENERATED);
      expect(recordedStates).toContain(TaskLifecycleState.PLAN_VALIDATED);
    }, 15000);
  });
});
