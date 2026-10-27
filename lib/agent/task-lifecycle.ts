import { z } from "zod";
import { Action, ActionExecutionResult } from "../types/actions";
import { BrowserTab } from "../types/browser";
import { VerificationEvidence } from "../types/results";

/**
 * Explicit Task Lifecycle States:
 * Task received -> Intent interpreted -> Task constraints extracted -> Current state inspected
 * -> Plan generated -> Plan validated -> Action executing -> Action outcome verified
 * -> Recovery or replanning -> Final task verification -> Final report -> Terminal outcomes
 */
export const TaskLifecycleState = {
  // Initial & Ingestion
  QUEUED: "queued",
  TASK_RECEIVED: "task_received",

  // Interpretation & Constraints
  INTERPRETING: "interpreting",
  INTENT_INTERPRETED: "intent_interpreted",
  CONSTRAINTS_EXTRACTED: "constraints_extracted",

  // Observation & Pre-flight Inspection
  STATE_INSPECTED: "state_inspected",

  // Planning & Validation
  PLANNING: "planning",
  PLAN_GENERATED: "plan_generated",
  PLAN_VALIDATED: "plan_validated",

  // Execution & Action Verification
  EXECUTING: "executing",
  ACTION_EXECUTING: "action_executing",
  ACTION_VERIFIED: "action_verified",

  // Dynamic Recovery & Replanning
  RECOVERING: "recovering",
  REPLANNING: "replanning",

  // Final Verification & Reporting
  VERIFYING: "verifying",
  FINAL_VERIFICATION: "final_verification",
  FINAL_REPORT: "final_report",

  // Explicit Terminal Outcomes
  SUCCESS: "success",
  PARTIAL_SUCCESS: "partial_success",
  FAILED: "failed",
  BLOCKED: "blocked",
  NEEDS_CLARIFICATION: "needs_clarification",
  CANCELLED: "cancelled",

  // Local File Progress & Outcome States (Requirement 6)
  LOCAL_PERMISSION_REQUIRED: "local_permission_required",
  SEARCHING_LOCAL_FILES: "searching_local_files",
  FILE_SELECTION_REQUIRED: "file_selection_required",
  PLAYBACK_STARTED: "playback_started",
  PLAYBACK_FAILED: "playback_failed",
} as const;

export type TaskLifecycleState = (typeof TaskLifecycleState)[keyof typeof TaskLifecycleState];

/**
 * Terminal states that cannot transition back to active execution states.
 */
export const TERMINAL_STATES: ReadonlySet<TaskLifecycleState> = new Set([
  TaskLifecycleState.SUCCESS,
  TaskLifecycleState.PARTIAL_SUCCESS,
  TaskLifecycleState.FAILED,
  TaskLifecycleState.BLOCKED,
  TaskLifecycleState.NEEDS_CLARIFICATION,
  TaskLifecycleState.CANCELLED,
  TaskLifecycleState.LOCAL_PERMISSION_REQUIRED,
  TaskLifecycleState.FILE_SELECTION_REQUIRED,
  TaskLifecycleState.PLAYBACK_FAILED,
]);

/** Standard terminal outcome set available to any active phase */
const TERMINAL_OUTCOMES: TaskLifecycleState[] = [
  TaskLifecycleState.FINAL_REPORT,
  TaskLifecycleState.SUCCESS,
  TaskLifecycleState.PARTIAL_SUCCESS,
  TaskLifecycleState.FAILED,
  TaskLifecycleState.BLOCKED,
  TaskLifecycleState.NEEDS_CLARIFICATION,
  TaskLifecycleState.CANCELLED,
  TaskLifecycleState.LOCAL_PERMISSION_REQUIRED,
  TaskLifecycleState.FILE_SELECTION_REQUIRED,
  TaskLifecycleState.PLAYBACK_FAILED,
];

/**
 * Allowed forward transitions for the task lifecycle.
 */
const VALID_TRANSITIONS: Record<TaskLifecycleState, ReadonlySet<TaskLifecycleState>> = {
  [TaskLifecycleState.QUEUED]: new Set([
    TaskLifecycleState.TASK_RECEIVED,
    TaskLifecycleState.INTERPRETING,
    TaskLifecycleState.INTENT_INTERPRETED,
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.TASK_RECEIVED]: new Set([
    TaskLifecycleState.INTERPRETING,
    TaskLifecycleState.INTENT_INTERPRETED,
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.INTERPRETING]: new Set([
    TaskLifecycleState.INTENT_INTERPRETED,
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.INTENT_INTERPRETED]: new Set([
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.CONSTRAINTS_EXTRACTED]: new Set([
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.STATE_INSPECTED]: new Set([
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.PLAN_VALIDATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.PLANNING]: new Set([
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.PLAN_VALIDATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.PLAN_GENERATED]: new Set([
    TaskLifecycleState.PLAN_VALIDATED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.PLANNING, // Replan
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.PLAN_VALIDATED]: new Set([
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.PLANNING, // Replan if validation flagged corrections
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.EXECUTING]: new Set([
    TaskLifecycleState.EXECUTING, // Next action in sequence
    TaskLifecycleState.STATE_INSPECTED, // Page observation after action
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.ACTION_VERIFIED,
    TaskLifecycleState.RECOVERING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.ACTION_EXECUTING]: new Set([
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.STATE_INSPECTED, // Page observation during/after action
    TaskLifecycleState.ACTION_VERIFIED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.RECOVERING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.ACTION_VERIFIED]: new Set([
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.RECOVERING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.RECOVERING]: new Set([
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.REPLANNING]: new Set([
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.PLAN_VALIDATED,
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.VERIFYING]: new Set([
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    TaskLifecycleState.RECOVERING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.PLANNING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.FINAL_VERIFICATION]: new Set([
    TaskLifecycleState.FINAL_REPORT,
    TaskLifecycleState.RECOVERING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.PLANNING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.FINAL_REPORT]: new Set([
    ...TERMINAL_OUTCOMES,
  ]),
  // Local File Execution states
  [TaskLifecycleState.SEARCHING_LOCAL_FILES]: new Set([
    TaskLifecycleState.FILE_SELECTION_REQUIRED,
    TaskLifecycleState.PLAYBACK_STARTED,
    TaskLifecycleState.LOCAL_PERMISSION_REQUIRED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.VERIFYING,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.PLAYBACK_STARTED]: new Set([
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.PLAYBACK_FAILED,
    ...TERMINAL_OUTCOMES,
  ]),
  // Terminal states cannot transition to anything
  [TaskLifecycleState.SUCCESS]: new Set(),
  [TaskLifecycleState.PARTIAL_SUCCESS]: new Set(),
  [TaskLifecycleState.FAILED]: new Set(),
  [TaskLifecycleState.BLOCKED]: new Set(),
  [TaskLifecycleState.NEEDS_CLARIFICATION]: new Set(),
  [TaskLifecycleState.CANCELLED]: new Set(),
  [TaskLifecycleState.LOCAL_PERMISSION_REQUIRED]: new Set(),
  [TaskLifecycleState.FILE_SELECTION_REQUIRED]: new Set(),
  [TaskLifecycleState.PLAYBACK_FAILED]: new Set(),
};

/**
 * Validates whether a state transition is legal.
 * Terminal states must not accidentally return to active states.
 */
export function validateTaskStateTransition(
  currentState: TaskLifecycleState,
  nextState: TaskLifecycleState
): boolean {
  if (currentState === nextState) {
    return true; // No-op transition
  }

  // Once in a terminal state, no further transitions are allowed
  if (TERMINAL_STATES.has(currentState)) {
    return false;
  }

  const allowed = VALID_TRANSITIONS[currentState];
  return allowed ? allowed.has(nextState) : false;
}

/**
 * Enforces a state transition, throwing an error if illegal.
 */
export function assertValidTaskTransition(
  currentState: TaskLifecycleState,
  nextState: TaskLifecycleState,
  taskId?: string
): void {
  if (!validateTaskStateTransition(currentState, nextState)) {
    throw new Error(
      `Illegal task lifecycle transition from '${currentState}' to '${nextState}'${
        taskId ? ` for task ${taskId}` : ""
      }. Terminal states cannot return to active execution.`
    );
  }
}

/**
 * Action lifecycle stage within action history.
 */
export type ActionExecutionStage = "proposed" | "attempted" | "completed" | "failed" | "skipped";

export interface ActionRecord {
  action: Action;
  stage: ActionExecutionStage;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  result?: ActionExecutionResult;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Shared Task Model required by Section 5.
 */
export interface TaskRecord {
  taskId: string;
  originalInstruction: string;
  mode: "live" | "test";
  createdAt: string;
  completedAt?: string;
  state: TaskLifecycleState;
  currentStep?: number;
  totalSteps?: number;
  currentUrl?: string;
  pageTitle?: string;
  tabs: BrowserTab[];
  actionHistory: ActionRecord[];
  verificationEvidence?: VerificationEvidence;
  errorClassification?: string;
  sanitizedErrorDetails?: {
    code: string;
    message: string;
    details?: unknown;
  };
  cancellationStatus: {
    isCancelled: boolean;
    reason?: string;
    cancelledAt?: string;
  };
  finalOutcome?: TaskLifecycleState;
  explanation?: string;
  taskConstraints?: Record<string, unknown>;
  browserSessionId?: string;
  plan?: any;
  finalReport?: string;
}

export const TaskRecordSchema = z.object({
  taskId: z.string(),
  originalInstruction: z.string(),
  mode: z.enum(["live", "test"]),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  state: z.enum([
    TaskLifecycleState.QUEUED,
    TaskLifecycleState.TASK_RECEIVED,
    TaskLifecycleState.INTERPRETING,
    TaskLifecycleState.INTENT_INTERPRETED,
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.PLAN_VALIDATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.ACTION_VERIFIED,
    TaskLifecycleState.RECOVERING,
    TaskLifecycleState.REPLANNING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    TaskLifecycleState.SUCCESS,
    TaskLifecycleState.PARTIAL_SUCCESS,
    TaskLifecycleState.FAILED,
    TaskLifecycleState.BLOCKED,
    TaskLifecycleState.NEEDS_CLARIFICATION,
    TaskLifecycleState.CANCELLED,
    TaskLifecycleState.LOCAL_PERMISSION_REQUIRED,
    TaskLifecycleState.SEARCHING_LOCAL_FILES,
    TaskLifecycleState.FILE_SELECTION_REQUIRED,
    TaskLifecycleState.PLAYBACK_STARTED,
    TaskLifecycleState.PLAYBACK_FAILED,
  ]),
  currentStep: z.number().int().nonnegative().optional(),
  totalSteps: z.number().int().nonnegative().optional(),
  currentUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  tabs: z.array(z.any()).default([]),
  actionHistory: z.array(z.any()).default([]),
  verificationEvidence: z.any().optional(),
  errorClassification: z.string().optional(),
  sanitizedErrorDetails: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
  cancellationStatus: z.object({
    isCancelled: z.boolean(),
    reason: z.string().optional(),
    cancelledAt: z.string().optional(),
  }),
  finalOutcome: z
    .enum([
      TaskLifecycleState.SUCCESS,
      TaskLifecycleState.PARTIAL_SUCCESS,
      TaskLifecycleState.FAILED,
      TaskLifecycleState.BLOCKED,
      TaskLifecycleState.NEEDS_CLARIFICATION,
      TaskLifecycleState.CANCELLED,
      TaskLifecycleState.LOCAL_PERMISSION_REQUIRED,
      TaskLifecycleState.FILE_SELECTION_REQUIRED,
      TaskLifecycleState.PLAYBACK_FAILED,
    ])
    .optional(),
  explanation: z.string().optional(),
  taskConstraints: z.record(z.unknown()).optional(),
  browserSessionId: z.string().optional(),
  plan: z.any().optional(),
  finalReport: z.string().optional(),
});
