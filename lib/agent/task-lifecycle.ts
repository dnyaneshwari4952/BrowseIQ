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
  PENDING: "pending",
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
  COMPLETED: "completed",
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
  TaskLifecycleState.COMPLETED,
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
  TaskLifecycleState.COMPLETED,
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
    TaskLifecycleState.PENDING,
    TaskLifecycleState.TASK_RECEIVED,
    TaskLifecycleState.INTERPRETING,
    TaskLifecycleState.INTENT_INTERPRETED,
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    ...TERMINAL_OUTCOMES,
  ]),
  [TaskLifecycleState.PENDING]: new Set([
    TaskLifecycleState.QUEUED,
    TaskLifecycleState.TASK_RECEIVED,
    TaskLifecycleState.INTERPRETING,
    TaskLifecycleState.INTENT_INTERPRETED,
    TaskLifecycleState.CONSTRAINTS_EXTRACTED,
    TaskLifecycleState.STATE_INSPECTED,
    TaskLifecycleState.PLANNING,
    TaskLifecycleState.PLAN_GENERATED,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.ACTION_EXECUTING,
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
    TaskLifecycleState.PLAYBACK_STARTED,
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
    TaskLifecycleState.PLAYBACK_STARTED,
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
    TaskLifecycleState.ACTION_VERIFIED,
    TaskLifecycleState.ACTION_EXECUTING,
    TaskLifecycleState.VERIFYING,
    TaskLifecycleState.FINAL_VERIFICATION,
    TaskLifecycleState.FINAL_REPORT,
    TaskLifecycleState.EXECUTING,
    TaskLifecycleState.PLAYBACK_FAILED,
    ...TERMINAL_OUTCOMES,
  ]),
  // Terminal states cannot transition to anything
  [TaskLifecycleState.SUCCESS]: new Set(),
  [TaskLifecycleState.COMPLETED]: new Set(),
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
 * Media playback status state machine: strictly separated from Task Lifecycle.
 * Represents playback lifecycle independent of agent task orchestration.
 */
export const MediaPlaybackStatus = {
  IDLE: "idle",
  LOADING: "loading",
  BUFFERING: "buffering",
  PLAYING: "playing",
  PAUSED: "paused",
  ENDED: "ended",
  BLOCKED: "blocked",
  ERROR: "error",
} as const;

export type MediaPlaybackStatus = (typeof MediaPlaybackStatus)[keyof typeof MediaPlaybackStatus];

export interface MediaPlaybackRecord {
  status: MediaPlaybackStatus;
  taskId: string;
  executionId?: string;
  currentTime?: number;
  duration?: number;
  isAdPlaying?: boolean;
  adCount?: number;
  error?: string | null;
  verified?: boolean;
  updatedAt: string;
}

export interface MediaPlaybackEvent {
  type?: "playback_status_change" | "playback_progress" | "playback_ad_state" | "playback_error";
  status: MediaPlaybackStatus;
  taskId: string;
  executionId: string;
  currentTime?: number;
  duration?: number;
  isAdPlaying?: boolean;
  adCount?: number;
  error?: string | null;
  timestamp?: string;
}

/**
 * Independent media playback status transitions.
 */
export const VALID_MEDIA_TRANSITIONS: Record<MediaPlaybackStatus, ReadonlySet<MediaPlaybackStatus>> = {
  [MediaPlaybackStatus.IDLE]: new Set([
    MediaPlaybackStatus.IDLE,
    MediaPlaybackStatus.LOADING,
    MediaPlaybackStatus.BUFFERING,
    MediaPlaybackStatus.PLAYING,
    MediaPlaybackStatus.PAUSED,
    MediaPlaybackStatus.BLOCKED,
    MediaPlaybackStatus.ERROR,
  ]),
  [MediaPlaybackStatus.LOADING]: new Set([
    MediaPlaybackStatus.LOADING,
    MediaPlaybackStatus.BUFFERING,
    MediaPlaybackStatus.PLAYING,
    MediaPlaybackStatus.PAUSED,
    MediaPlaybackStatus.BLOCKED,
    MediaPlaybackStatus.ERROR,
    MediaPlaybackStatus.IDLE,
  ]),
  [MediaPlaybackStatus.BUFFERING]: new Set([
    MediaPlaybackStatus.BUFFERING,
    MediaPlaybackStatus.LOADING,
    MediaPlaybackStatus.PLAYING,
    MediaPlaybackStatus.PAUSED,
    MediaPlaybackStatus.ERROR,
    MediaPlaybackStatus.BLOCKED,
    MediaPlaybackStatus.IDLE,
  ]),
  [MediaPlaybackStatus.PLAYING]: new Set([
    MediaPlaybackStatus.PLAYING,
    MediaPlaybackStatus.BUFFERING,
    MediaPlaybackStatus.PAUSED,
    MediaPlaybackStatus.ENDED,
    MediaPlaybackStatus.ERROR,
    MediaPlaybackStatus.BLOCKED,
    MediaPlaybackStatus.IDLE,
  ]),
  [MediaPlaybackStatus.PAUSED]: new Set([
    MediaPlaybackStatus.PAUSED,
    MediaPlaybackStatus.LOADING,
    MediaPlaybackStatus.BUFFERING,
    MediaPlaybackStatus.PLAYING,
    MediaPlaybackStatus.ENDED,
    MediaPlaybackStatus.ERROR,
    MediaPlaybackStatus.BLOCKED,
    MediaPlaybackStatus.IDLE,
  ]),
  [MediaPlaybackStatus.ENDED]: new Set([
    MediaPlaybackStatus.ENDED,
    MediaPlaybackStatus.IDLE,
    MediaPlaybackStatus.LOADING,
    MediaPlaybackStatus.PLAYING,
  ]),
  [MediaPlaybackStatus.BLOCKED]: new Set([
    MediaPlaybackStatus.BLOCKED,
    MediaPlaybackStatus.IDLE,
  ]),
  [MediaPlaybackStatus.ERROR]: new Set([
    MediaPlaybackStatus.ERROR,
    MediaPlaybackStatus.IDLE,
  ]),
};

export function validateMediaPlaybackTransition(
  currentStatus: MediaPlaybackStatus,
  nextStatus: MediaPlaybackStatus
): boolean {
  if (currentStatus === nextStatus) return true;
  const allowed = VALID_MEDIA_TRANSITIONS[currentStatus];
  return allowed ? allowed.has(nextStatus) : false;
}

export interface ProcessPlaybackEventResult {
  accepted: boolean;
  ignored: boolean;
  reason?: string;
  status: MediaPlaybackStatus;
  record?: MediaPlaybackRecord;
}

/**
 * Dedicated Media Playback Manager that manages media states independently
 * from task lifecycle states, safeguarding against stale, duplicate, or post-terminal events.
 */
export class MediaPlaybackManager {
  private currentRecord: MediaPlaybackRecord;
  private isTerminalTask: boolean = false;

  constructor(taskId: string, executionId: string) {
    this.currentRecord = {
      status: MediaPlaybackStatus.IDLE,
      taskId,
      executionId,
      currentTime: 0,
      duration: 0,
      isAdPlaying: false,
      adCount: 0,
      error: null,
      verified: false,
      updatedAt: new Date().toISOString(),
    };
  }

  public getRecord(): Readonly<MediaPlaybackRecord> {
    return { ...this.currentRecord };
  }

  public getStatus(): MediaPlaybackStatus {
    return this.currentRecord.status;
  }

  public markTaskTerminal(): void {
    this.isTerminalTask = true;
  }

  public isTaskTerminal(): boolean {
    return this.isTerminalTask;
  }

  public processEvent(
    event: Partial<MediaPlaybackEvent> & { status: MediaPlaybackStatus; taskId: string; executionId: string }
  ): ProcessPlaybackEventResult {
    // 1. Task ID isolation: Reject events intended for other tasks
    if (event.taskId !== this.currentRecord.taskId) {
      return {
        accepted: false,
        ignored: true,
        reason: `Mismatched taskId: received '${event.taskId}', active is '${this.currentRecord.taskId}'`,
        status: this.currentRecord.status,
      };
    }

    // 2. Execution ID validation: Reject stale events from earlier executions
    if (event.executionId !== this.currentRecord.executionId) {
      return {
        accepted: false,
        ignored: true,
        reason: `Stale executionId: received '${event.executionId}', active is '${this.currentRecord.executionId}'`,
        status: this.currentRecord.status,
      };
    }

    // 3. Terminal isolation: Late playback events must not modify completed, failed, or cancelled tasks
    if (this.isTerminalTask) {
      return {
        accepted: false,
        ignored: true,
        reason: `Task is already in terminal state; late playback event '${event.status}' safely ignored`,
        status: this.currentRecord.status,
      };
    }

    // 4. Safe duplicate handling: Idempotent processing
    const isDuplicate =
      event.status === this.currentRecord.status &&
      (event.currentTime === undefined || event.currentTime === this.currentRecord.currentTime) &&
      (event.isAdPlaying === undefined || event.isAdPlaying === this.currentRecord.isAdPlaying) &&
      (event.error === undefined || event.error === this.currentRecord.error);

    if (isDuplicate) {
      return {
        accepted: true,
        ignored: false,
        reason: "Duplicate event acknowledged idempotently",
        status: this.currentRecord.status,
        record: { ...this.currentRecord },
      };
    }

    // 5. Update independent media playback record
    this.currentRecord.status = event.status;
    if (event.currentTime !== undefined) this.currentRecord.currentTime = event.currentTime;
    if (event.duration !== undefined) this.currentRecord.duration = event.duration;
    if (event.isAdPlaying !== undefined) {
      this.currentRecord.isAdPlaying = event.isAdPlaying;
      if (event.isAdPlaying && !this.currentRecord.adCount) {
        this.currentRecord.adCount = 1;
      }
    }
    if (event.adCount !== undefined) this.currentRecord.adCount = event.adCount;
    if (event.error !== undefined) this.currentRecord.error = event.error;
    if (event.status === MediaPlaybackStatus.PLAYING && (this.currentRecord.currentTime ?? 0) > 0) {
      this.currentRecord.verified = true;
    }
    this.currentRecord.updatedAt = event.timestamp || new Date().toISOString();

    return {
      accepted: true,
      ignored: false,
      status: this.currentRecord.status,
      record: { ...this.currentRecord },
    };
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
    TaskLifecycleState.PENDING,
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
    TaskLifecycleState.COMPLETED,
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
      TaskLifecycleState.COMPLETED,
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
