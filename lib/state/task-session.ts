import { AgentState, Plan } from "@/lib/types/plans";
import { PageObservation, BrowserTab } from "@/lib/types/browser";
import { ExecutionEvent } from "@/lib/observability/trace";
import { DownloadedArtifact, ExecutionContext, TaskVerificationResult, RecoveryAttemptRecord } from "@/lib/types/results";
import type { PlanningMetadata } from "@/lib/agent/gemini-planning-interface";

export interface TaskSessionState {
  taskPrompt: string;
  targetUrlInput: string;
  agentState: AgentState;
  lifecycleState?: string;
  finalStatus?: ExecutionContext["finalStatus"];
  statusMessage?: string;
  currentUrl?: string;
  currentPageTitle?: string;
  currentActionName?: string;
  startTime?: string;
  currentStepIndex: number;
  plan: Plan | null;
  observation: PageObservation | null;
  events: ExecutionEvent[];
  extractedData: unknown;
  downloads: DownloadedArtifact[];
  screenshots: string[];
  taskVerification: TaskVerificationResult | null;
  browserTabs: BrowserTab[];
  recoveryHistory: RecoveryAttemptRecord[];
  errorDetails: { code: string; message: string; stepId?: string } | null;
  waitingForUser: boolean;
  retriesCount: number;
  replansCount: number;
  activeTaskId?: string;
  planningMetadata?: PlanningMetadata;
  browserWindow: {
    taskId?: string;
    isVisible: boolean;
    isOpen: boolean;
  };
  isAdvancedOpen: boolean;
  advancedTab: "plan" | "page" | "trace" | "diagnostics";
}

export const INITIAL_TASK_SESSION_STATE: TaskSessionState = {
  taskPrompt: "",
  targetUrlInput: "",
  agentState: AgentState.IDLE,
  lifecycleState: undefined,
  finalStatus: undefined,
  statusMessage: undefined,
  currentUrl: undefined,
  currentPageTitle: undefined,
  currentActionName: undefined,
  startTime: undefined,
  currentStepIndex: 0,
  plan: null,
  observation: null,
  events: [],
  extractedData: null,
  downloads: [],
  screenshots: [],
  taskVerification: null,
  browserTabs: [],
  recoveryHistory: [],
  errorDetails: null,
  waitingForUser: false,
  retriesCount: 0,
  replansCount: 0,
  activeTaskId: undefined,
  planningMetadata: undefined,
  browserWindow: { isVisible: false, isOpen: false },
  isAdvancedOpen: false,
  advancedTab: "plan",
};

export type TaskSessionAction =
  | { type: "RESET_SESSION" }
  | { type: "SET_TASK_PROMPT"; payload: string }
  | { type: "SET_TARGET_URL"; payload: string }
  | {
      type: "START_TASK";
      payload: {
        task: string;
        targetUrl?: string;
        now: string;
      };
    }
  | { type: "APPEND_EVENT"; payload: ExecutionEvent }
  | {
      type: "UPDATE_STATE";
      payload: {
        state?: AgentState;
        lifecycleState?: string;
        stepIndex?: number;
        actionName?: string;
      };
    }
  | { type: "SET_PLAN"; payload: Plan }
  | { type: "SET_OBSERVATION"; payload: PageObservation }
  | {
      type: "SET_BROWSER_WINDOW";
      payload: { taskId?: string; isVisible: boolean; isOpen: boolean };
    }
  | { type: "SET_RESULT"; payload: ExecutionContext }
  | {
      type: "SET_ERROR";
      payload: { message: string; code?: string; stepId?: string };
    }
  | {
      type: "STOP_TASK";
      payload?: { taskId?: string; message?: string };
    }
  | { type: "SET_WAITING_FOR_USER"; payload: boolean }
  | { type: "SET_ADVANCED_OPEN"; payload: boolean }
  | { type: "SET_ADVANCED_TAB"; payload: "plan" | "page" | "trace" | "diagnostics" };

export function taskSessionReducer(
  state: TaskSessionState,
  action: TaskSessionAction
): TaskSessionState {
  switch (action.type) {
    case "RESET_SESSION":
      return {
        ...INITIAL_TASK_SESSION_STATE,
      };

    case "SET_TASK_PROMPT":
      return {
        ...state,
        taskPrompt: action.payload,
      };

    case "SET_TARGET_URL":
      return {
        ...state,
        targetUrlInput: action.payload,
      };

    case "START_TASK":
      return {
        ...state,
        taskPrompt: action.payload.task,
        targetUrlInput: action.payload.targetUrl || "",
        agentState: AgentState.UNDERSTANDING,
        startTime: action.payload.now,
        currentUrl: action.payload.targetUrl,
        currentPageTitle: undefined,
        currentActionName: "Understanding task...",
        currentStepIndex: 0,
        plan: null,
        observation: null,
        extractedData: null,
        downloads: [],
        screenshots: [],
        finalStatus: undefined,
        statusMessage: undefined,
        taskVerification: null,
        browserTabs: [],
        recoveryHistory: [],
        errorDetails: null,
        waitingForUser: false,
        retriesCount: 0,
        replansCount: 0,
        planningMetadata: undefined,
        browserWindow: { isVisible: false, isOpen: false },
        lifecycleState: "interpreting",
        activeTaskId: undefined,
        events: [
          {
            id: `evt-${Date.now()}-init`,
            taskId: `task-${Date.now()}`,
            type: "TASK_RECEIVED",
            timestamp: action.payload.now,
            message: `Task received (Live Mode): "${action.payload.task}"`,
          },
        ],
      };

    case "APPEND_EVENT":
      return {
        ...state,
        activeTaskId: state.activeTaskId || action.payload.taskId,
        events: [...state.events, action.payload],
      };

    case "SET_PLAN":
      return {
        ...state,
        plan: action.payload,
      };

    case "SET_OBSERVATION":
      return {
        ...state,
        observation: action.payload,
      };

    case "SET_BROWSER_WINDOW":
      return {
        ...state,
        activeTaskId: state.activeTaskId || action.payload.taskId,
        browserWindow: action.payload,
      };

    case "UPDATE_STATE":
      return {
        ...state,
        ...(action.payload.state ? { agentState: action.payload.state } : {}),
        ...(action.payload.lifecycleState ? { lifecycleState: action.payload.lifecycleState } : {}),
        ...(typeof action.payload.stepIndex === "number" ? { currentStepIndex: action.payload.stepIndex } : {}),
        ...(action.payload.actionName ? { currentActionName: action.payload.actionName } : {}),
      };

    case "SET_RESULT": {
      const ctx = action.payload;
      const isNeedsClarification =
        ctx.finalStatus === "needs_clarification" ||
        ctx.finalStatus === "waiting_for_user" ||
        ctx.state === AgentState.WAITING_FOR_USER;
      const isFailedOrBlocked = ctx.finalStatus === "failed" || ctx.finalStatus === "blocked";
      const isBlocked = ctx.finalStatus === "blocked" || ctx.taskVerification?.isBlocked;

      let errorDetails = state.errorDetails;
      let waitingForUser = state.waitingForUser;

      if (isNeedsClarification) {
        waitingForUser = true;
        errorDetails = {
          code: "NEEDS_CLARIFICATION",
          message: ctx.statusMessage || "Target website or action clarification must be provided to proceed.",
        };
      } else if (isFailedOrBlocked) {
        errorDetails = {
          code: isBlocked
            ? "ACCESS_RESTRICTED"
            : ctx.taskVerification
            ? "TASK_VERIFICATION_FAILED"
            : "EXECUTION_FAILED",
          message: ctx.statusMessage || "The requested task could not be completed.",
        };
      }

      return {
        ...state,
        activeTaskId: ctx.taskId ?? state.activeTaskId,
        lifecycleState: ctx.lifecycleState ?? state.lifecycleState,
        plan: ctx.plan ?? state.plan,
        extractedData: ctx.extractedData ?? state.extractedData,
        downloads: ctx.downloads ?? state.downloads,
        screenshots: (ctx as any).screenshots ?? state.screenshots,
        currentUrl: ctx.currentUrl ?? state.currentUrl,
        currentPageTitle: ctx.currentPageTitle ?? state.currentPageTitle,
        observation: ctx.latestObservation ?? state.observation,
        taskVerification: ctx.taskVerification ?? state.taskVerification,
        browserTabs: ctx.browserTabs ?? state.browserTabs,
        browserWindow: ctx.browserWindow ?? state.browserWindow,
        recoveryHistory: ctx.recoveryHistory ?? state.recoveryHistory,
        planningMetadata: ctx.planningMetadata ?? state.planningMetadata,
        retriesCount: ctx.retries ?? state.retriesCount,
        replansCount: ctx.replans ?? state.replansCount,
        finalStatus: ctx.finalStatus,
        statusMessage: ctx.statusMessage,
        agentState: ctx.state ?? state.agentState,
        currentActionName: undefined,
        waitingForUser,
        errorDetails,
      };
    }

    case "SET_ERROR":
      return {
        ...state,
        agentState: AgentState.FAILED,
        finalStatus: "failed",
        statusMessage: action.payload.message,
        errorDetails: {
          code: action.payload.code || "AGENT_ERROR",
          message: action.payload.message,
          stepId: action.payload.stepId,
        },
      };

    case "STOP_TASK":
      return {
        ...state,
        agentState: AgentState.CANCELLED,
        lifecycleState: "cancelled",
        finalStatus: "cancelled",
        currentActionName: undefined,
        statusMessage: action.payload?.message || "Task stopped by user.",
        events: [
          ...state.events,
          {
            id: `evt-${Date.now()}-stop`,
            taskId: action.payload?.taskId || state.activeTaskId || "task-stopped",
            type: "CANCELLED",
            timestamp: new Date().toISOString(),
            message: "Execution cancelled by user request.",
          },
        ],
      };

    case "SET_WAITING_FOR_USER":
      return {
        ...state,
        waitingForUser: action.payload,
      };

    case "SET_ADVANCED_OPEN":
      return {
        ...state,
        isAdvancedOpen: action.payload,
      };

    case "SET_ADVANCED_TAB":
      return {
        ...state,
        advancedTab: action.payload,
      };

    default:
      return state;
  }
}

/**
 * Checks if the current task session has any active or completed execution data.
 */
export function hasSessionData(state: TaskSessionState): boolean {
  return Boolean(
    state.agentState !== AgentState.IDLE ||
      state.finalStatus ||
      state.lifecycleState ||
      state.statusMessage ||
      state.plan ||
      state.observation ||
      state.events.length > 0 ||
      state.extractedData !== null ||
      state.downloads.length > 0 ||
      state.screenshots.length > 0 ||
      state.taskVerification !== null ||
      state.recoveryHistory.length > 0 ||
      state.errorDetails !== null ||
      state.waitingForUser ||
      state.currentUrl ||
      state.currentPageTitle ||
      state.currentActionName ||
      state.startTime ||
      state.retriesCount > 0 ||
      state.replansCount > 0 ||
      state.browserTabs.length > 0 ||
      state.activeTaskId ||
      state.planningMetadata
  );
}

/**
 * Checks if the session is completely clean and idle.
 */
export function isCleanSession(state: TaskSessionState): boolean {
  return (
    !state.taskPrompt.trim() &&
    !state.targetUrlInput.trim() &&
    !hasSessionData(state)
  );
}
