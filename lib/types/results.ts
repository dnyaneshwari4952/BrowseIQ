import { Action, ActionExecutionResult, ElementTarget } from "./actions";
import { BrowserTab, PageObservation } from "./browser";
import { AgentState, Plan, RouteDecision } from "./plans";
import { OperatingMode } from "./operating-mode";
import type { PlanningMetadata } from "../agent/gemini-planning-interface";

/**
 * Immutable record of an individual recovery attempt (Section 4)
 */
export interface RecoveryAttemptRecord {
  stepIndex: number;
  planRevision: number;
  originalAction: Action;
  originalTarget?: ElementTarget;
  proposedTarget?: ElementTarget;
  observationUsed?: PageObservation | null;
  failureCategory: string;
  recoveryReason: string;
  uniqueTargetFound: boolean;
  strategy: string;
  executionResult?: ActionExecutionResult;
  timestamp: string;
}

/**
 * Downloaded file metadata (Section 20)
 */
export interface DownloadedArtifact {
  id: string;
  originalFilename: string;
  savedPath: string;
  mimeType?: string;
  fileSizeBytes: number;
  downloadTime: string;
  verified: boolean;
}

/**
 * Task Execution Context (Section 16)
 */
export interface ExecutionContext {
  taskId: string;
  originalTask: string;
  targetUrl?: string;
  mode?: "live" | "test";
  /** Operating mode that was active when this task was created. */
  operatingMode?: OperatingMode;
  state: AgentState;
  lifecycleState?: string;
  currentUrl?: string;
  currentPageTitle?: string;
  plan?: Plan;
  currentStepIndex: number;
  completedSteps: ActionExecutionResult[];
  failedSteps: ActionExecutionResult[];
  extractedData: Record<string, unknown> | Array<Record<string, unknown>> | unknown;
  downloads: DownloadedArtifact[];
  screenshots: string[];
  browserTabs: BrowserTab[];
  browserWindow?: {
    taskId: string;
    isVisible: boolean;
    isOpen: boolean;
  };
  retries: number;
  replans: number;
  routeDecisions: RouteDecision[];
  recoveryHistory?: RecoveryAttemptRecord[];
  requiresUserConfirmation?: boolean;
  errors: Array<{
    timestamp: string;
    stepId?: string;
    code: string;
    message: string;
  }>;
  startTime: string;
  endTime?: string;
  finalStatus?:
    | "completed"
    | "partial_success"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "needs_clarification"
    | "unsupported_task"
    | "waiting_for_user"
    | "blocked";
  statusMessage?: string;
  taskVerification?: TaskVerificationResult;
  latestObservation?: PageObservation | null;
  /** Planning observability: records deterministic vs Gemini-assisted planning path. */
  planningMetadata?: PlanningMetadata;
  /** Structured constraints extracted during task understanding phase */
  taskConstraints?: Record<string, unknown>;
  /** Reference to the browser session managing this task's visible Chromium window */
  browserSessionId?: string;
  /** Final synthesized human-readable report for the user */
  finalReport?:
    | string
    | {
        summary: string;
        outcome: string;
        completedCount: number;
        failedCount: number;
        durationMs: number;
        details?: Record<string, unknown>;
      };
  /** Complete audit log of lifecycle transitions associated with this task */
  lifecycleHistory?: Array<{
    state: string;
    timestamp: string;
    stepIndex?: number;
    actionName?: string;
    details?: unknown;
  }>;
}

export type VerificationOutcome =
  | "success"
  | "partial_success"
  | "failed"
  | "blocked"
  | "needs_clarification"
  | "cancelled";

export interface VerificationEvidence {
  originalObjective: string;
  finalUrl?: string;
  observedStateSummary?: string;
  verifiedFields?: string[];
  verifiedItems?: unknown[];
  conditionsPassed: string[];
  conditionsFailed: string[];
  reason: string;
}

/**
 * Task-level verification result (Part 3 & Part 4 & Phase 3 Step 9)
 */
export interface TaskVerificationResult {
  passed: boolean;
  outcome?: VerificationOutcome;
  reason: string;
  missingOutputs: string[];
  failedChecks: string[];
  isBlocked?: boolean;
  blockReason?: string;
  evidence?: VerificationEvidence;
  details?: Record<string, unknown>;
}

/**
 * Execution Evaluation Metrics (Section 32 & 33 & Part 42)
 */
export interface ExecutionMetrics {
  totalTasks: number;
  successfulTasks: number;
  taskSuccessRate: number;
  totalPlannedActions: number;
  totalValidatedActions: number;
  totalRejectedActions: number;
  totalExecutedActions: number;
  incorrectlyExecutedActions: number;
  falseActionRate: number; // Section 33: rejected or incorrect / planned
  falseSuccesses: number; // Part 42: tasks incorrectly reported as successful
  falseSuccessRate: number; // Part 42: falseSuccesses / totalTasks
  totalRetries: number;
  totalReplans: number;
  avgTaskDurationMs: number;
  apiRouteCount: number;
  browserRouteCount: number;
}

/**
 * Phase 4 Comprehensive Generalization & Verification Metrics (Section 7)
 */
export interface Phase4EvaluationMetrics {
  totalTasks: number;
  successfulTasks: number;
  overallTaskSuccessRate: number; // successfulTasks / totalTasks
  partialSuccessTasks: number;
  partialSuccessRate: number; // partialSuccessTasks / totalTasks
  failedTasks: number;
  failureRate: number; // failedTasks / totalTasks
  blockedTasks: number;
  blockedTaskAccuracy: number; // correctly identified blocked / actual blocked
  clarificationTasks: number;
  clarificationAccuracy: number; // correctly identified clarification / actual ambiguous
  falseSuccesses: number;
  falseSuccessRate: number; // falseSuccesses / totalTasks (Must be 0.0)
  wrongTargetActions: number;
  wrongTargetActionRate: number; // wrongTargetActions / totalExecutedActions (Must be 0.0)
  constraintPreservationCount: number;
  constraintPreservationRate: number; // preservedConstraints / totalConstrainedTasks (Must be 1.0)
  unsupportedActionsCount: number;
  unsupportedActionRate: number;
  recoveryAttemptsCount: number;
  successfulRecoveriesCount: number;
  recoverySuccessRate: number; // successfulRecoveries / recoveryAttempts
  duplicateActionsCount: number;
  duplicateActionRate: number; // duplicateActions / totalExecutedActions
  medianDurationMs: number;
  p95DurationMs: number;
  averageActionsPerCompletedTask: number;
  cancellationResponsivenessMs: number;
  localFileResolutionSuccessRate: number;
  mediaPlaybackSuccessRate: number;
  categorySuccessRates: Record<string, { total: number; successful: number; rate: number }>;
}
