import { ActionExecutionResult } from "./actions";
import { BrowserTab } from "./browser";
import { AgentState, Plan, RouteDecision } from "./plans";

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
  state: AgentState;
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
  retries: number;
  replans: number;
  routeDecisions: RouteDecision[];
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
    | "failed"
    | "cancelled"
    | "timed_out"
    | "needs_clarification"
    | "unsupported_task"
    | "waiting_for_user";
  statusMessage?: string;
  taskVerification?: TaskVerificationResult;
}

/**
 * Task-level verification result (Part 3 & Part 4)
 */
export interface TaskVerificationResult {
  passed: boolean;
  reason: string;
  missingOutputs: string[];
  failedChecks: string[];
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
