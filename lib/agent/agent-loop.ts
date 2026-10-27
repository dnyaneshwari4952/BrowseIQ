import fs from "fs";
import { Page, Locator } from "playwright";
import { Action, ActionExecutionResult, ActionStatus, ActionType } from "../types/actions";
import { AgentState, Plan, RouteDecision } from "../types/plans";
import { PageObservation } from "../types/browser";
import { ExecutionContext, DownloadedArtifact, RecoveryAttemptRecord } from "../types/results";
import { LocalFileResolver } from "../local/local-file-resolver";
import { LocalFileSecurityManager, LocalAccessMode } from "../local/local-file-security-manager";
import { ErrorCode, AgentError } from "../types/errors";
import { browserManager } from "../browser/browser-manager";
import { ActionExecutor } from "../browser/action-executor";
import { PageObserver } from "../browser/page-observer";
import { Planner } from "./planner";
import { TaskVerifier } from "./task-verifier";
import { RecoveryEngine, RecoveryDecision } from "./recovery-engine";
import { ApiRegistry } from "../api/api-registry";
import { ApiExecutor, ApiErrorCode, ApiExecutionResult } from "../api/api-executor";
import { ExecutionEvent, ExecutionEventType } from "../observability/trace";
import { globalMetrics } from "../observability/metrics";
import { getConfig } from "../config";
import { SemanticDecomposer } from "./semantic-decomposer";
import { LocalSemanticReasoner } from "./local-semantic-reasoner";
import { PageCapabilityDetector } from "../browser/page-capability-detector";
import { ChallengeDetector } from "../browser/challenge-detector";
import { ApiRouter } from "../api/api-router";
import { validateUrlString } from "../validation/url-policy";
import { logger } from "../observability/logger";
import { TaskLifecycleState, assertValidTaskTransition } from "./task-lifecycle";
import { OperatingMode, DEFAULT_OPERATING_MODE, coerceOperatingMode } from "../types/operating-mode";
import { EntityConstraintResolver } from "../planning/entity-constraint-resolver";

export interface AgentRunOptions {
  taskId?: string;
  task: string;
  targetUrl?: string;
  forceBrowser?: boolean;
  mode?: "live" | "test";
  /** Operating mode for this task — always coerced to Playwright. */
  operatingMode?: OperatingMode | string;
  onEvent?: (event: ExecutionEvent) => void;
  onStateChange?: (state: AgentState, stepIndex?: number, actionName?: string) => void;
  onLifecycleChange?: (lifecycleState: TaskLifecycleState, stepIndex?: number, actionName?: string) => void;
  abortSignal?: AbortSignal;
  settings?: {
    actionTimeout?: number;
    maxRetries?: number;
    maxReplans?: number;
    requireConfirmation?: boolean;
    localFilesEnabled?: boolean;
    approvedDirectory?: string;
    accessMode?: LocalAccessMode;
    wholeComputerConfirmed?: boolean;
    approvedDirectories?: string[];
  };
}

export function mapAgentStateToLifecycle(state: AgentState, finalStatus?: string): TaskLifecycleState {
  switch (state) {
    case AgentState.IDLE:
      return TaskLifecycleState.QUEUED;
    case AgentState.UNDERSTANDING:
      return TaskLifecycleState.INTERPRETING;
    case AgentState.PLANNING:
    case AgentState.REPLANNING:
      return TaskLifecycleState.PLANNING;
    case AgentState.OBSERVING:
      return TaskLifecycleState.STATE_INSPECTED;
    case AgentState.VALIDATING:
    case AgentState.EXECUTING:
    case AgentState.RECOVERING:
      return TaskLifecycleState.EXECUTING;
    case AgentState.VERIFYING:
      return TaskLifecycleState.VERIFYING;
    case AgentState.COMPLETED:
      return finalStatus === "partial_success" ? TaskLifecycleState.PARTIAL_SUCCESS : TaskLifecycleState.SUCCESS;
    case AgentState.FAILED:
      if (finalStatus === "blocked") return TaskLifecycleState.BLOCKED;
      if (finalStatus === "playback_failed") return TaskLifecycleState.PLAYBACK_FAILED;
      if (finalStatus === "needs_clarification") return TaskLifecycleState.NEEDS_CLARIFICATION;
      return TaskLifecycleState.FAILED;
    case AgentState.WAITING_FOR_USER:
      if (finalStatus === "local_permission_required") return TaskLifecycleState.LOCAL_PERMISSION_REQUIRED;
      if (finalStatus === "file_selection_required") return TaskLifecycleState.FILE_SELECTION_REQUIRED;
      return TaskLifecycleState.NEEDS_CLARIFICATION;
    case AgentState.CANCELLED:
      return TaskLifecycleState.CANCELLED;
    default:
      return TaskLifecycleState.EXECUTING;
  }
}

export function mapLifecycleToAgentState(lifecycle: TaskLifecycleState): AgentState {
  switch (lifecycle) {
    case TaskLifecycleState.QUEUED:
    case TaskLifecycleState.TASK_RECEIVED:
      return AgentState.IDLE;
    case TaskLifecycleState.INTERPRETING:
    case TaskLifecycleState.INTENT_INTERPRETED:
    case TaskLifecycleState.CONSTRAINTS_EXTRACTED:
      return AgentState.UNDERSTANDING;
    case TaskLifecycleState.STATE_INSPECTED:
      return AgentState.OBSERVING;
    case TaskLifecycleState.PLANNING:
    case TaskLifecycleState.PLAN_GENERATED:
      return AgentState.PLANNING;
    case TaskLifecycleState.PLAN_VALIDATED:
      return AgentState.VALIDATING;
    case TaskLifecycleState.EXECUTING:
    case TaskLifecycleState.ACTION_EXECUTING:
    case TaskLifecycleState.SEARCHING_LOCAL_FILES:
    case TaskLifecycleState.PLAYBACK_STARTED:
      return AgentState.EXECUTING;
    case TaskLifecycleState.ACTION_VERIFIED:
      return AgentState.OBSERVING;
    case TaskLifecycleState.RECOVERING:
      return AgentState.RECOVERING;
    case TaskLifecycleState.REPLANNING:
      return AgentState.REPLANNING;
    case TaskLifecycleState.VERIFYING:
    case TaskLifecycleState.FINAL_VERIFICATION:
      return AgentState.VERIFYING;
    case TaskLifecycleState.FINAL_REPORT:
      return AgentState.COMPLETED;
    case TaskLifecycleState.SUCCESS:
    case TaskLifecycleState.PARTIAL_SUCCESS:
      return AgentState.COMPLETED;
    case TaskLifecycleState.FAILED:
    case TaskLifecycleState.BLOCKED:
    case TaskLifecycleState.PLAYBACK_FAILED:
      return AgentState.FAILED;
    case TaskLifecycleState.LOCAL_PERMISSION_REQUIRED:
    case TaskLifecycleState.FILE_SELECTION_REQUIRED:
    case TaskLifecycleState.NEEDS_CLARIFICATION:
      return AgentState.WAITING_FOR_USER;
    case TaskLifecycleState.CANCELLED:
      return AgentState.CANCELLED;
    default:
      return AgentState.EXECUTING;
  }
}

export class AgentLoop {
  private planner: Planner;

  constructor() {
    this.planner = new Planner();
  }

  /**
   * Executes a user task from understanding to verified completion
   */
  async runTask(options: AgentRunOptions): Promise<ExecutionContext> {
    const { task, targetUrl, forceBrowser, onEvent, onStateChange, onLifecycleChange, abortSignal, settings } = options;
    // Configure local file security permissions if supplied in settings
    if (settings?.localFilesEnabled !== undefined) {
      LocalFileSecurityManager.setPermission(settings.localFilesEnabled, {
        directory: settings.approvedDirectory,
        accessMode: settings.accessMode,
        wholeComputerConfirmed: settings.wholeComputerConfirmed,
        approvedDirectories: settings.approvedDirectories,
      });
    }
    // Validate and coerce operating mode — backend enforces this independently of frontend
    const operatingMode: OperatingMode = coerceOperatingMode(options.operatingMode);
    const config = getConfig();
    const effectiveMaxRetries = Math.min(5, Math.max(0, settings?.maxRetries ?? config.MAX_ACTION_RETRIES));
    const effectiveMaxReplans = Math.min(5, Math.max(0, settings?.maxReplans ?? config.MAX_REPLANS));
    const effectiveActionTimeout = Math.min(60000, Math.max(1000, settings?.actionTimeout ?? config.DEFAULT_ACTION_TIMEOUT));

    const taskId = options.taskId || `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = new Date().toISOString();
    const startMs = Date.now();

    // Active Global Task Timeout Controller (Part 23)
    const timeoutController = new AbortController();
    let isTimedOut = false;
    const timeoutTimer = setTimeout(() => {
      isTimedOut = true;
      timeoutController.abort();
    }, config.TASK_TIMEOUT);

    const isAborted = () => Boolean(abortSignal?.aborted || timeoutController.signal.aborted);

    let wasFalseSuccess = false;

    const emitEvent = (type: ExecutionEventType, message: string, details?: unknown) => {
      const evt: ExecutionEvent = {
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        taskId,
        type,
        timestamp: new Date().toISOString(),
        message,
        data: details as Record<string, unknown> | undefined,
      };
      if (onEvent) onEvent(evt);
    };

    let currentLifecycle: TaskLifecycleState = TaskLifecycleState.QUEUED;

    const emitLifecycle = (nextLifecycle: TaskLifecycleState, stepIndex = 0, actionName?: string) => {
      // If transitioning to a terminal success/partial/failure state and not yet reported, emit FINAL_REPORT first
      if (
        (nextLifecycle === TaskLifecycleState.SUCCESS ||
          nextLifecycle === TaskLifecycleState.PARTIAL_SUCCESS ||
          nextLifecycle === TaskLifecycleState.FAILED) &&
        currentLifecycle !== TaskLifecycleState.FINAL_REPORT &&
        currentLifecycle !== nextLifecycle
      ) {
        if (!ctx.finalReport) {
          const durationMs = Date.now() - new Date(ctx.startTime).getTime();
          ctx.finalReport = {
            summary: ctx.statusMessage || `Task concluded with status ${nextLifecycle}`,
            outcome: nextLifecycle,
            completedCount: ctx.completedSteps?.length || 0,
            failedCount: ctx.failedSteps?.length || 0,
            durationMs,
            details: {
              extractedData: ctx.extractedData,
              artifactsCount: ctx.downloads?.length || 0,
            },
          };
        }
        emitLifecycle(TaskLifecycleState.FINAL_REPORT, stepIndex, "Final report generated");
      }

      if (nextLifecycle !== currentLifecycle) {
        assertValidTaskTransition(currentLifecycle, nextLifecycle, taskId);
        currentLifecycle = nextLifecycle;
      }
      ctx.lifecycleState = currentLifecycle;
      ctx.currentStepIndex = stepIndex;
      if (!ctx.lifecycleHistory) {
        ctx.lifecycleHistory = [];
      }
      ctx.lifecycleHistory.push({
        state: currentLifecycle,
        timestamp: new Date().toISOString(),
        stepIndex,
        actionName,
      });

      const agentState = mapLifecycleToAgentState(currentLifecycle);
      ctx.state = agentState;
      if (onStateChange) onStateChange(agentState, stepIndex, actionName);
      if (onLifecycleChange) onLifecycleChange(currentLifecycle, stepIndex, actionName);
    };

    const emitState = (state: AgentState, stepIndex = 0, actionName?: string) => {
      const nextLifecycle = mapAgentStateToLifecycle(state, ctx.finalStatus);
      emitLifecycle(nextLifecycle, stepIndex, actionName);
    };

    // Resolve initial target destination from options or task text
    let effectiveTargetUrl = targetUrl;
    let effectiveTargetWebsite: string | undefined;
    let urlClarificationNeeded = false;
    let urlSafetyError: AgentError | undefined;

    try {
      const urlResolution = EntityConstraintResolver.resolveTargetUrl(task, targetUrl);
      if (urlResolution.targetUrl) {
        effectiveTargetUrl = urlResolution.targetUrl;
        effectiveTargetWebsite = urlResolution.targetWebsite;
      } else if (urlResolution.urlClarificationNeeded) {
        urlClarificationNeeded = true;
        effectiveTargetWebsite = urlResolution.targetWebsite;
      }
    } catch (urlErr: unknown) {
      if (urlErr instanceof AgentError) {
        urlSafetyError = urlErr;
      } else {
        urlClarificationNeeded = true;
      }
    }

    const ctx: ExecutionContext = {
      taskId,
      originalTask: task,
      targetUrl: effectiveTargetUrl,
      mode: "live",
      operatingMode,
      state: AgentState.IDLE,
      lifecycleState: TaskLifecycleState.QUEUED,
      currentStepIndex: 0,
      completedSteps: [],
      failedSteps: [],
      extractedData: null,
      downloads: [],
      screenshots: [],
      browserTabs: [],
      retries: 0,
      replans: 0,
      routeDecisions: [],
      recoveryHistory: [],
      errors: [],
      startTime,
      latestObservation: null,
      taskConstraints: {},
      lifecycleHistory: [],
    };

    emitEvent("TASK_RECEIVED", `Agent received task: "${task}" [mode: ${operatingMode}]`);
    emitLifecycle(TaskLifecycleState.TASK_RECEIVED, 0, `Task received: "${task}"`);

    // OUTER TASK LIFECYCLE BOUNDARY (Section 7)
    try {
      // 0. Initial Safety and Clarification Guards
      if (urlSafetyError) {
        clearTimeout(timeoutTimer);
        return this.handleFailure(
          ctx,
          `URL Safety Policy violation: ${urlSafetyError.message}`,
          emitEvent,
          emitState,
          { code: urlSafetyError.code }
        );
      }

      if (urlClarificationNeeded) {
        clearTimeout(timeoutTimer);
        const reason = `Destination website "${effectiveTargetWebsite || "requested"}" mentioned without a valid web address. Target website must be provided to proceed.`;
        return this.handleClarification(ctx, reason, emitEvent, emitState);
      }

      // 1. UNDERSTANDING & PLANNING
      emitState(AgentState.UNDERSTANDING, 0, "Understanding task semantics");
      if (isAborted()) {
        clearTimeout(timeoutTimer);
        return isTimedOut ? await this.handleTimeout(ctx, emitEvent, emitState) : this.handleAbort(ctx, emitEvent, emitState);
      }

      // Semantic Task Decomposition & Intent Interpretation
      const taskIntent = SemanticDecomposer.decompose(task, null, effectiveTargetUrl);
      emitLifecycle(TaskLifecycleState.INTENT_INTERPRETED, 0, `Intent interpreted: ${taskIntent.intentType}`);

      // Extract and associate task constraints
      ctx.taskConstraints = {
        intentType: taskIntent.intentType,
        entity: taskIntent.entity,
        query: taskIntent.query,
        ordinal: taskIntent.ordinal,
        negation: taskIntent.negation,
        requestedOutputs: taskIntent.requestedOutputs,
        maxRetries: effectiveMaxRetries,
        maxReplans: effectiveMaxReplans,
        actionTimeout: effectiveActionTimeout,
      };
      emitLifecycle(TaskLifecycleState.CONSTRAINTS_EXTRACTED, 0, "Task constraints extracted");

      if (taskIntent.taskScope === "local_file" || taskIntent.intentType === "LOCAL_MEDIA_PLAY") {
        emitLifecycle(TaskLifecycleState.SEARCHING_LOCAL_FILES, 0, "Searching approved local directory for audio files");
      }

      if (taskIntent.requiresClarification) {
        clearTimeout(timeoutTimer);
        const reason = taskIntent.clarificationReason || "Ambiguous action requested. Clarification required.";
        return this.handleClarification(ctx, reason, emitEvent, emitState);
      }

      if (taskIntent.isUnsupported) {
        clearTimeout(timeoutTimer);
        const reason = taskIntent.unsupportedReason || "Task requested an unsupported or restricted operation.";
        return this.handleUnsupported(ctx, reason, emitEvent, emitState);
      }

      // Pre-navigation observation grounding for browser route when targetUrl is provided
      let activeTabId: string | null = null;
      let pageObservation: PageObservation | null = null;
      let activeTab: { page: Page; tabId: string } | null = null;

      const initialRouteDecision = ApiRouter.decideRoute(task, { targetUrl: effectiveTargetUrl, forceBrowser });

      if (initialRouteDecision.route === "browser" && effectiveTargetUrl) {
        try {
          validateUrlString(effectiveTargetUrl, "initial target navigation");
          emitState(AgentState.OBSERVING, 0, "Opening visible Playwright browser window");
          const session = await browserManager.createTaskSession(taskId);
          activeTab = { page: session.page, tabId: session.tabId };
          activeTabId = activeTab.tabId;
          ctx.browserSessionId = session.taskId;
          ctx.browserTabs = browserManager.getTabs(taskId);
          ctx.browserWindow = {
            taskId,
            isVisible: true,
            isOpen: true,
          };
          emitEvent("BROWSER_LAUNCHED", `Visible browser window opened for task ${taskId}`, {
            taskId,
            isVisible: true,
            isOpen: true,
          });

          const navResp = await activeTab.page.goto(effectiveTargetUrl, {
            waitUntil: "domcontentloaded",
            timeout: effectiveActionTimeout,
          });

          if (navResp && navResp.status() === 404) {
            clearTimeout(timeoutTimer);
            return this.handleFailure(
              ctx,
              `Navigation failed: Page at ${effectiveTargetUrl} returned HTTP 404 (Not Found)`,
              emitEvent,
              emitState,
              { code: ErrorCode.NAVIGATION_FAILED }
            );
          }

          pageObservation = await PageObserver.observe(activeTab.page, activeTabId || "tab-0");
          ctx.currentUrl = pageObservation.url;
          ctx.currentPageTitle = pageObservation.title;
          ctx.latestObservation = pageObservation;
          emitLifecycle(TaskLifecycleState.STATE_INSPECTED, 0, `Current page state inspected: ${pageObservation.url}`);

          const initialChallenge = ChallengeDetector.detect(pageObservation);
          if (initialChallenge.isBlocked) {
            clearTimeout(timeoutTimer);
            return this.handleBlocked(ctx, initialChallenge.reason || "Access restricted by challenge page.", emitEvent, emitState);
          }

          // Re-evaluate semantic intent grounded in live page DOM observation (Phase 2 Step 4)
          const liveGroundedIntent = SemanticDecomposer.decompose(task, pageObservation, targetUrl);
          if (liveGroundedIntent.requiresClarification) {
            clearTimeout(timeoutTimer);
            return this.handleClarification(
              ctx,
              liveGroundedIntent.clarificationReason || "Ambiguous action requested. Clarification required.",
              emitEvent,
              emitState
            );
          }
          if (liveGroundedIntent.isUnsupported) {
            clearTimeout(timeoutTimer);
            return this.handleUnsupported(
              ctx,
              liveGroundedIntent.unsupportedReason || "Task requested an unsupported or unavailable operation on current page.",
              emitEvent,
              emitState
            );
          }
        } catch (initNavErr) {
          if (initNavErr instanceof AgentError) throw initNavErr;
          logger.warn(`Initial observation navigation threw: ${initNavErr}`);
        }
      }

      emitLifecycle(
        TaskLifecycleState.PLAN_GENERATED,
        0,
        "Synthesizing execution plan"
      );
      emitEvent("PLANNING", "Evaluating task requirements and selecting route... [execution engine: Playwright]");

      let plan: Plan;
      try {
        const planResult = await this.planner.plan({
          task,
          targetUrl: effectiveTargetUrl,
          observation: pageObservation || undefined,
          forceBrowser,
          operatingMode,
          abortSignal,
        });
        plan = planResult;
        ctx.plan = plan;
        emitLifecycle(TaskLifecycleState.PLAN_VALIDATED, 0, `Plan validated with ${plan.actions.length} actions`);
        // Record planning metadata for observability
        if ((planResult as any).planningMetadata) {
          ctx.planningMetadata = (planResult as any).planningMetadata;
        }
        if (plan.routeDecision) {
          ctx.routeDecisions.push(plan.routeDecision);
        }
        const firstAction = plan.actions[0];
        if (firstAction?.type === ActionType.REQUEST_CLARIFICATION) {
          if (firstAction.reason?.includes("LOCAL_PERMISSION_REQUIRED")) {
            ctx.finalStatus = "needs_clarification";
            ctx.lifecycleState = TaskLifecycleState.LOCAL_PERMISSION_REQUIRED;
            emitLifecycle(TaskLifecycleState.LOCAL_PERMISSION_REQUIRED, 0, firstAction.reason);
            clearTimeout(timeoutTimer);
            return this.handleClarification(ctx, firstAction.reason, emitEvent, emitState);
          }
          if (firstAction.reason?.includes("FILE_SELECTION_REQUIRED")) {
            ctx.finalStatus = "needs_clarification";
            ctx.lifecycleState = TaskLifecycleState.FILE_SELECTION_REQUIRED;
            emitLifecycle(TaskLifecycleState.FILE_SELECTION_REQUIRED, 0, firstAction.reason);
            clearTimeout(timeoutTimer);
            return this.handleClarification(ctx, firstAction.reason, emitEvent, emitState);
          }
        }

        const planSource = ctx.planningMetadata?.planSource ?? "deterministic";
        const geminiNote = ctx.planningMetadata?.geminiInvoked ? " [Gemini-assisted planning]" : " [Deterministic planning]";
        emitEvent(
          "PLAN_READY",
          `Generated plan with ${plan.actions.length} actions. Route: ${plan.routeDecision?.route.toUpperCase()}${geminiNote}`,
          { planningMetadata: ctx.planningMetadata }
        );
      } catch (err: unknown) {
        clearTimeout(timeoutTimer);
        if (err instanceof AgentError) {
          ctx.errors.push({
            timestamp: new Date().toISOString(),
            code: err.code,
            message: err.message,
            stepId: "planning",
          });
          return this.handleFailure(
            ctx,
            `Planning failed: ${err.message}`,
            emitEvent,
            emitState,
            {
              code: err.code,
              provider: err.provider,
              retryable: err.retryable,
              details: err.context?.details,
            }
          );
        }
        const message = err instanceof Error ? err.message : String(err);
        return this.handleFailure(ctx, `Planning failed: ${message}`, emitEvent, emitState);
      }

      // 2. CHECK API ROUTE VS BROWSER ROUTE
      const route = plan.routeDecision?.route ?? "browser";

      if (route === "api" && !forceBrowser) {
        if (isAborted()) {
          clearTimeout(timeoutTimer);
          return isTimedOut ? await this.handleTimeout(ctx, emitEvent, emitState) : this.handleAbort(ctx, emitEvent, emitState);
        }

        emitState(AgentState.EXECUTING, 0, "Executing via fast API route");
        emitEvent("ACTION_STARTED", `Route: API. Querying API capability.`);

        const endpoint = ApiRegistry.getById(plan.routeDecision?.apiIntegrationId || "");
        if (endpoint) {
          let apiResult: ApiExecutionResult;
          try {
            apiResult = await ApiExecutor.execute(endpoint, task, undefined, timeoutController.signal);
          } catch (apiErr: unknown) {
            const errMessage = apiErr instanceof Error ? apiErr.message : String(apiErr);
            apiResult = {
              success: false,
              endpointId: endpoint.id,
              error: {
                code: ApiErrorCode.UNKNOWN_API_ERROR,
                message: `API execution threw unexpected error: ${errMessage}`,
              },
              fallbackToBrowser: false,
              durationMs: 0,
            };
          }

          if (apiResult.success) {
            let extractedData = apiResult.data;
            if (
              extractedData &&
              typeof extractedData === "object" &&
              Array.isArray((extractedData as Record<string, unknown>).products)
            ) {
              const rawProducts = (extractedData as { products: Array<Record<string, unknown>> }).products;
              extractedData = LocalSemanticReasoner.evaluate(rawProducts, taskIntent);
            }
            ctx.extractedData = extractedData;
            emitEvent("ACTION_SUCCESS", "API execution returned valid structured response", { data: extractedData });

            ctx.completedSteps.push({
              actionId: `api-${Date.now()}`,
              type: ActionType.FINISH,
              status: ActionStatus.COMPLETED,
              startTime: ctx.startTime,
              endTime: new Date().toISOString(),
              durationMs: apiResult.durationMs,
              extractedData: ctx.extractedData,
              retriesUsed: 0,
              verified: true,
            });

            // Run Task Verification on API Result
            emitState(AgentState.VERIFYING, 1, "Verifying task completion criteria");
            const taskVerif = TaskVerifier.verifyTask({
              task,
              plan,
              targetUrl: effectiveTargetUrl,
              completedSteps: ctx.completedSteps,
              extractedData: ctx.extractedData,
              downloads: ctx.downloads,
            });

            ctx.taskVerification = taskVerif;
            clearTimeout(timeoutTimer);
            if (taskVerif.passed) {
              return this.handleSuccess(ctx, "Task verified successfully via API-first execution", emitEvent, emitState);
            } else if (taskVerif.outcome === "partial_success") {
              return this.handlePartialSuccess(ctx, taskVerif.reason, emitEvent, emitState);
            } else {
              wasFalseSuccess = true;
              return this.handleFailure(ctx, taskVerif.reason, emitEvent, emitState);
            }
          } else if (apiResult.fallbackToBrowser && plan.routeDecision?.fallbackAvailable !== false) {
            emitEvent(
              "RECOVERY_STARTED",
              `API returned ${apiResult.error?.code}. Gracefully falling back to browser automation route.`
            );
            ctx.routeDecisions.push({
              route: "browser",
              reason: `Fallback from API failure (${apiResult.error?.code}) to Browser automation`,
              confidence: 0.85,
              fallbackAvailable: false,
            });
            let fallbackTargetUrl = apiResult.fallbackUrl || endpoint.browserFallbackUrl || effectiveTargetUrl;
            if (fallbackTargetUrl && fallbackTargetUrl.startsWith("/")) {
              fallbackTargetUrl = `http://localhost:3000${fallbackTargetUrl}`;
            }
            try {
              plan = await this.planner.plan({
                task,
                targetUrl: fallbackTargetUrl,
                forceBrowser: true,
              });
              ctx.plan = plan;
              emitEvent("PLAN_READY", `Generated fallback browser plan with ${plan.actions.length} actions.`);
            } catch (planErr) {
              clearTimeout(timeoutTimer);
              return this.handleFailure(ctx, `Browser fallback planning failed: ${planErr instanceof Error ? planErr.message : String(planErr)}`, emitEvent, emitState);
            }
            // Continue to Browser execution below!
          } else {
            clearTimeout(timeoutTimer);
            return this.handleFailure(ctx, `API execution failed: ${apiResult.error?.message}`, emitEvent, emitState, {
              code: apiResult.error?.code,
            });
          }
        } else {
          // API endpoint missing from registry! (Section 6)
          if (plan.routeDecision?.fallbackAvailable) {
            emitEvent(
              "RECOVERY_STARTED",
              `API integration '${plan.routeDecision.apiIntegrationId}' missing from registry. Falling back to browser automation.`
            );
            ctx.routeDecisions.push({
              route: "browser",
              reason: `Fallback from missing API integration (${plan.routeDecision.apiIntegrationId}) to Browser automation`,
              confidence: 0.85,
              fallbackAvailable: false,
            });
            try {
              plan = await this.planner.plan({
                task,
                targetUrl: effectiveTargetUrl,
                forceBrowser: true,
              });
              ctx.plan = plan;
              emitEvent("PLAN_READY", `Generated fallback browser plan with ${plan.actions.length} actions.`);
            } catch (planErr) {
              clearTimeout(timeoutTimer);
              return this.handleFailure(ctx, `Browser fallback planning failed: ${planErr instanceof Error ? planErr.message : String(planErr)}`, emitEvent, emitState);
            }
            // Continue to Browser execution below!
          } else {
            clearTimeout(timeoutTimer);
            return this.handleFailure(
              ctx,
              `API integration '${plan.routeDecision?.apiIntegrationId}' was not found in registry and browser fallback is not permitted.`,
              emitEvent,
              emitState,
              { code: ErrorCode.CONFIG_ERROR }
            );
          }
        }
      }

      // 3. BROWSER AUTOMATION EXECUTION
      if (!activeTab) {
        emitState(AgentState.OBSERVING, 0, "Opening visible Playwright browser window");
        const session = await browserManager.createTaskSession(taskId);
        activeTab = { page: session.page, tabId: session.tabId };
        activeTabId = activeTab.tabId;
        ctx.browserSessionId = session.taskId;
        ctx.browserTabs = browserManager.getTabs(taskId);
        ctx.browserWindow = {
          taskId,
          isVisible: true,
          isOpen: true,
        };
        emitEvent("BROWSER_LAUNCHED", `Visible browser window opened for task ${taskId}`, {
          taskId,
          isVisible: true,
          isOpen: true,
        });
      }
      const tab = activeTab;

      const extractedItems: Record<string, unknown> = {};
      let stepIndex = 0;
      let lastResolvedLocator: Locator | undefined = undefined;

      while (stepIndex < plan.actions.length) {
        if (isAborted()) {
          clearTimeout(timeoutTimer);
          return isTimedOut ? await this.handleTimeout(ctx, emitEvent, emitState) : this.handleAbort(ctx, emitEvent, emitState);
        }

        const action = plan.actions[stepIndex];
        emitState(AgentState.VALIDATING, stepIndex, `Validating step ${stepIndex + 1}: ${action.type}`);
        emitEvent("ACTION_STARTED", `Step ${stepIndex + 1}/${plan.actions.length}: ${action.type} - ${action.reason}`);

        let stepSuccess = false;
        let actionAttempts = 0;
        // Section 2: maxRetries contract (0 retries = 1 initial attempt; 1 retry = 2 attempts)
        const actionMaxRetries = action.retries?.maxRetries !== undefined
          ? Math.min(5, Math.max(0, action.retries.maxRetries))
          : effectiveMaxRetries;
        const maxAttempts = 1 + actionMaxRetries;

        if (!action.timeout) {
          action.timeout = effectiveActionTimeout;
        }
        const stepFailedTargets = new Set<string>();
        if (action.target?.value) {
          stepFailedTargets.add(`${action.target.strategy || "any"}:${action.target.value.toLowerCase()}`);
        }

        let currentAttemptAction = { ...action };

        while (actionAttempts < maxAttempts && !stepSuccess) {
          if (isAborted()) {
            clearTimeout(timeoutTimer);
            return isTimedOut ? await this.handleTimeout(ctx, emitEvent, emitState) : this.handleAbort(ctx, emitEvent, emitState);
          }

          actionAttempts++;
          emitLifecycle(TaskLifecycleState.ACTION_EXECUTING, stepIndex, `Executing: ${currentAttemptAction.type} (attempt ${actionAttempts}/${maxAttempts})`);

          // Execute action with pre-validation and post-verification
          const execResponse = await ActionExecutor.execute({
            action: currentAttemptAction,
            page: tab.page,
            tabId: activeTabId || "tab-0",
            beforeObservation: pageObservation,
            lastResolvedLocator,
            authorizedTask: task,
            initialTargetUrl: targetUrl,
            taskId,
            stepIndex,
          });

          pageObservation = execResponse.afterObservation;
          ctx.currentUrl = pageObservation.url;
          ctx.currentPageTitle = pageObservation.title;
          ctx.latestObservation = pageObservation;

          // Check for Challenge / Access Restriction (Google /sorry/, Cloudflare, CAPTCHA)
          const challenge = ChallengeDetector.detect(pageObservation);
          if (challenge.isBlocked) {
            clearTimeout(timeoutTimer);
            const reason = challenge.reason || "Access restricted by challenge page.";
            emitEvent("ACTION_FAILED", reason, {
              blockType: challenge.blockType,
              url: pageObservation.url,
            });
            return this.handleBlocked(ctx, reason, emitEvent, emitState);
          }

          // Check for Page Capability Mismatch (Phase 6 & Phase 27)
          if (currentAttemptAction.type === ActionType.NAVIGATE && pageObservation) {
            const capabilityCheck = PageCapabilityDetector.detectMismatch(taskIntent, pageObservation);
            if (capabilityCheck.hasMismatch) {
              clearTimeout(timeoutTimer);
              const explanation = capabilityCheck.explanation || "Page capability mismatch detected.";
              emitEvent("ACTION_FAILED", explanation, {
                requiredCapability: capabilityCheck.requiredCapability,
                availableCapabilities: capabilityCheck.availableCapabilities,
              });
              return this.handleClarification(ctx, explanation, emitEvent, emitState);
            }
          }

          if (execResponse.result.status === ActionStatus.COMPLETED) {
            stepSuccess = true;
            if (execResponse.resolvedLocator) {
              lastResolvedLocator = execResponse.resolvedLocator;
            }
            if (
              currentAttemptAction.type === ActionType.NAVIGATE ||
              currentAttemptAction.type === ActionType.SWITCH_TAB ||
              currentAttemptAction.type === ActionType.OPEN_NEW_TAB
            ) {
              lastResolvedLocator = undefined;
            }
            ctx.completedSteps.push(execResponse.result);
            if (
              (currentAttemptAction.type === ActionType.CLICK && currentAttemptAction.target?.value === "audio-play-button") ||
              currentAttemptAction.type === ActionType.MEDIA_PLAY
            ) {
              emitLifecycle(TaskLifecycleState.PLAYBACK_STARTED, stepIndex, "Local audio playback started");
            }
            emitLifecycle(TaskLifecycleState.ACTION_VERIFIED, stepIndex, `Action ${currentAttemptAction.type} completed and verified`);
            emitEvent("ACTION_SUCCESS", `Action ${currentAttemptAction.type} completed and verified`);

            // Store extracted data
            if (execResponse.result.extractedData !== undefined) {
              if (currentAttemptAction.type === ActionType.EVALUATE_SAFE) {
                if (Array.isArray(execResponse.result.extractedData)) {
                  const intent = SemanticDecomposer.decompose(task, pageObservation, targetUrl);
                  const evaluated = LocalSemanticReasoner.evaluate(execResponse.result.extractedData as any, intent);
                  ctx.extractedData = evaluated;
                  execResponse.result.extractedData = evaluated;
                  Object.assign(extractedItems, evaluated);
                } else {
                  ctx.extractedData = execResponse.result.extractedData;
                }
              } else if (currentAttemptAction.type === ActionType.EXTRACT_TEXT && currentAttemptAction.target) {
                const key = currentAttemptAction.target.value || `data_${stepIndex}`;
                if (key.includes("title") || currentAttemptAction.reason.toLowerCase().includes("title")) {
                  extractedItems.title = execResponse.result.extractedData;
                } else if (key.includes("price") || currentAttemptAction.reason.toLowerCase().includes("price")) {
                  extractedItems.price = execResponse.result.extractedData;
                } else {
                  extractedItems[key] = execResponse.result.extractedData;
                }
              } else {
                ctx.extractedData = execResponse.result.extractedData;
              }
            }

            // Store downloads with real disk verification
            if (execResponse.result.downloadPath) {
              const dlPath = execResponse.result.downloadPath;
              const exists = fs.existsSync(dlPath);
              const stat = exists ? fs.statSync(dlPath) : null;
              const isNonEmpty = Boolean(stat && stat.size > 0);
              const pathCheck = LocalFileResolver.isPermittedPath(dlPath);
              const artifact: DownloadedArtifact = {
                id: `download-${Date.now()}`,
                originalFilename: dlPath.split(/[/\\]/).pop() || "download",
                savedPath: dlPath,
                fileSizeBytes: stat ? stat.size : 0,
                downloadTime: new Date().toISOString(),
                verified: exists && isNonEmpty && pathCheck.permitted,
              };
              ctx.downloads.push(artifact);
            }
          } else {
            // Action failed: Run Recovery Engine (Part 10 & 11)
            emitLifecycle(TaskLifecycleState.RECOVERING, stepIndex, `Recovery: ${execResponse.result.error?.message}`);
            emitEvent("ACTION_FAILED", `Action failed: ${execResponse.result.error?.message}`, execResponse.result.error);

            if (currentAttemptAction.target?.value) {
              stepFailedTargets.add(`${currentAttemptAction.target.strategy || "any"}:${currentAttemptAction.target.value.toLowerCase()}`);
            }

            ctx.errors.push({
              timestamp: new Date().toISOString(),
              stepId: action.id,
              code: execResponse.result.error?.code || ErrorCode.UNKNOWN_ERROR,
              message: execResponse.result.error?.message || "Action execution error",
            });

            const rawErr = new AgentError(
              execResponse.result.error?.message || "Action failed",
              (execResponse.result.error?.code as any) || ErrorCode.UNKNOWN_ERROR,
              execResponse.result.error?.recoverable ?? true
            );

            // Access Restrictions & Challenges: Stop automated execution safely as blocked, preserving browser window
            if (rawErr.code === ErrorCode.AUTH_REQUIRED || rawErr.code === ErrorCode.CAPTCHA_DETECTED) {
              ctx.failedSteps.push(execResponse.result);
              clearTimeout(timeoutTimer);
              const reason = rawErr.message;
              ctx.latestObservation = pageObservation;
              return this.handleBlocked(ctx, reason, emitEvent, emitState);
            }

            // Retries allowed only if failure is classified as recoverable (Section 2)
            if (!rawErr.recoverable) {
              ctx.failedSteps.push(execResponse.result);
              clearTimeout(timeoutTimer);
              return this.handleFailure(
                ctx,
                `Unrecoverable action failure in step ${stepIndex + 1} (${action.type}): ${rawErr.message}`,
                emitEvent,
                emitState,
                { code: rawErr.code }
              );
            }

            const decision: RecoveryDecision = RecoveryEngine.determineRecovery({
              action: currentAttemptAction,
              error: rawErr,
              attempt: actionAttempts,
              maxAttempts,
              replansUsed: ctx.replans,
              maxReplans: effectiveMaxReplans,
              observation: pageObservation,
              plan,
              failedTargets: stepFailedTargets,
            });

            // Record recovery history without in-place mutation of plan (Section 4)
            ctx.recoveryHistory = ctx.recoveryHistory || [];
            ctx.recoveryHistory.push({
              stepIndex,
              planRevision: plan.revision || 0,
              originalAction: action,
              originalTarget: action.target,
              proposedTarget: decision.suggestedTarget,
              observationUsed: pageObservation,
              failureCategory: execResponse.result.error?.code || ErrorCode.UNKNOWN_ERROR,
              recoveryReason: decision.reason,
              uniqueTargetFound: Boolean(decision.suggestedTarget),
              strategy: decision.strategy,
              executionResult: execResponse.result,
              timestamp: new Date().toISOString(),
            });

            if (decision.strategy === "RETRY_WITH_ALTERNATIVE_LOCATOR" && decision.suggestedTarget) {
              emitEvent("RECOVERY_STARTED", `Adapting target selector: ${decision.reason}`);
              // Use cloned attempt action with alternative target (preserving original action selector in plan)
              currentAttemptAction = {
                ...action,
                target: decision.suggestedTarget,
              };
              stepFailedTargets.add(`${decision.suggestedTarget.strategy || "any"}:${decision.suggestedTarget.value.toLowerCase()}`);
              continue;
            }

            if (decision.strategy === "RETRY_WITH_BACKOFF") {
              const waitMs = decision.backoffMs ?? 500;
              emitEvent("RECOVERY_STARTED", `Retrying with ${waitMs}ms backoff...`);
              ctx.retries++;
              await new Promise((r) => setTimeout(r, waitMs));
              continue;
            }

            if (decision.strategy === "REPLAN") {
              if (ctx.replans >= effectiveMaxReplans) {
                ctx.failedSteps.push(execResponse.result);
                clearTimeout(timeoutTimer);
                return this.handleFailure(
                  ctx,
                  `Max replans reached (${effectiveMaxReplans}). Unable to resolve step: ${decision.reason}`,
                  emitEvent,
                  emitState
                );
              }
              emitLifecycle(TaskLifecycleState.REPLANNING, stepIndex, "Dynamic plan revision from live DOM");
              emitEvent("REPLAN_REQUESTED", `Replanning plan revision ${ctx.replans + 1}`);
              ctx.replans++;
              try {
                plan = await this.planner.replan({
                  currentPlan: plan,
                  failedStepIndex: stepIndex,
                  observation: pageObservation!,
                  failureReason: decision.reason,
                  failedTargets: stepFailedTargets,
                });
                ctx.plan = plan;
                emitEvent("PLAN_UPDATED", `Plan revised to ${plan.actions.length} actions.`);
                actionAttempts = 0;
                continue;
              } catch (replanErr: unknown) {
                ctx.failedSteps.push(execResponse.result);
                clearTimeout(timeoutTimer);
                const replanMsg = replanErr instanceof Error ? replanErr.message : String(replanErr);
                const replanCode = replanErr instanceof AgentError ? replanErr.code : ErrorCode.PLANNING_FAILED;
                return this.handleFailure(ctx, `Replanning failed: ${replanMsg}`, emitEvent, emitState, { code: replanCode });
              }
            }

            if (decision.strategy === "WAITING_FOR_USER") {
              clearTimeout(timeoutTimer);
              return this.handleWaitingForUser(ctx, decision.reason, emitEvent, emitState, decision.requiresConfirmation ?? true);
            }

            if (decision.terminal) {
              ctx.failedSteps.push(execResponse.result);
              clearTimeout(timeoutTimer);
              return this.handleFailure(ctx, decision.reason, emitEvent, emitState);
            }
          }
        }

        if (!stepSuccess && actionAttempts >= maxAttempts) {
          clearTimeout(timeoutTimer);
          return this.handleFailure(
            ctx,
            `Step ${stepIndex + 1} (${action.type}) failed after ${actionAttempts} attempts`,
            emitEvent,
            emitState
          );
        }

        stepIndex++;
      }

      if (Object.keys(extractedItems).length > 0) {
        ctx.extractedData = extractedItems;
      }

      // 4. TASK-LEVEL VERIFICATION (Part 2 & Part 3)
      emitLifecycle(TaskLifecycleState.FINAL_VERIFICATION, plan.actions.length, "Verifying task completion criteria");
      emitEvent("TASK_VERIFICATION", "Checking task success criteria against live browser state...");

      // Capture settled final page state before verification
      if (tab?.page) {
        try {
          await tab.page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
          await tab.page.waitForTimeout(400);
          pageObservation = await PageObserver.observe(tab.page, activeTabId || "tab-0");
          ctx.currentUrl = pageObservation.url;
          ctx.currentPageTitle = pageObservation.title;
          ctx.latestObservation = pageObservation;
        } catch {
          // Keep previous observation if page navigation in-flight or detached
        }
      }

      // Check for challenge / bot wall on settled page
      const postExecutionChallenge = ChallengeDetector.detect(pageObservation);
      if (postExecutionChallenge.isBlocked) {
        clearTimeout(timeoutTimer);
        const reason = postExecutionChallenge.reason || "Access restricted by challenge page.";
        ctx.latestObservation = pageObservation;
        emitEvent("ACTION_FAILED", reason, {
          blockType: postExecutionChallenge.blockType,
          url: pageObservation?.url,
        });
        return this.handleBlocked(ctx, reason, emitEvent, emitState);
      }

      const taskVerification = TaskVerifier.verifyTask({
        task,
        plan,
        targetUrl,
        completedSteps: ctx.completedSteps,
        observation: pageObservation,
        extractedData: ctx.extractedData,
        downloads: ctx.downloads,
      });

      ctx.taskVerification = taskVerification;
      ctx.latestObservation = pageObservation;

      if (!taskVerification.passed) {
        clearTimeout(timeoutTimer);
        if (taskVerification.isBlocked || taskVerification.outcome === "blocked") {
          return this.handleBlocked(ctx, taskVerification.reason, emitEvent, emitState);
        }
        if (taskVerification.outcome === "partial_success") {
          return this.handlePartialSuccess(ctx, taskVerification.reason, emitEvent, emitState);
        }
        wasFalseSuccess = true;
        emitEvent("TASK_FAILED", `Task verification failed: ${taskVerification.reason}`, {
          missingOutputs: taskVerification.missingOutputs,
          failedChecks: taskVerification.failedChecks,
        });
        return this.handleFailure(ctx, taskVerification.reason, emitEvent, emitState);
      }

      clearTimeout(timeoutTimer);
      return this.handleSuccess(
        ctx,
        `Task verified successfully. All required operations and outputs satisfied.`,
        emitEvent,
        emitState
      );
    } catch (err: unknown) {
      clearTimeout(timeoutTimer);
      const message = err instanceof Error ? err.message : String(err);
      return this.handleFailure(ctx, `Runtime error in agent loop: ${message}`, emitEvent, emitState);
    } finally {
      clearTimeout(timeoutTimer);
      if (isTimedOut) {
        await browserManager.closeTaskSession(ctx.taskId).catch(() => {});
      }
      // Record metrics with accurate false success detection (Part 22 & Section 12)
      const totalExecuted = ctx.completedSteps.length + ctx.failedSteps.length;
      const incorrectActions = ctx.failedSteps.length + (wasFalseSuccess ? 1 : 0);

      globalMetrics.recordTask({
        success: ctx.finalStatus === "completed",
        durationMs: Date.now() - startMs,
        plannedActions: ctx.plan?.actions.length || 0,
        validatedActions: totalExecuted,
        rejectedActions: ctx.failedSteps.length,
        executedActions: ctx.completedSteps.length,
        incorrectlyExecutedActions: incorrectActions,
        retries: ctx.retries,
        replans: ctx.replans,
        route: (ctx.plan?.routeDecision?.route as "api" | "browser") || "browser",
        falseSuccess: wasFalseSuccess,
      });
    }
  }

  private markFinalized(ctx: ExecutionContext): boolean {
    if ((ctx as any)._isFinalized) {
      return false;
    }
    (ctx as any)._isFinalized = true;
    return true;
  }

  private handleSuccess(
    ctx: ExecutionContext,
    message: string,
    emitEvent: (t: ExecutionEventType, m: string) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    browserManager.completeTaskSession(ctx.taskId, "completed");
    if (ctx.browserWindow) {
      ctx.browserWindow.isOpen = browserManager.isWindowOpen(ctx.taskId);
    }
    ctx.state = AgentState.COMPLETED;
    ctx.finalStatus = "completed";
    ctx.statusMessage = message;
    ctx.endTime = new Date().toISOString();
    const durationMs = Date.now() - new Date(ctx.startTime).getTime();
    ctx.finalReport = {
      summary: message,
      outcome: "success",
      completedCount: ctx.completedSteps?.length || 0,
      failedCount: ctx.failedSteps?.length || 0,
      durationMs,
      details: {
        extractedData: ctx.extractedData,
        artifactsCount: ctx.downloads?.length || 0,
      },
    };
    emitState(AgentState.COMPLETED, ctx.plan?.actions.length || 0, "Completed");
    emitEvent("TASK_COMPLETED", message);
    return ctx;
  }

  private handlePartialSuccess(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    browserManager.completeTaskSession(ctx.taskId, "completed");
    if (ctx.browserWindow) {
      ctx.browserWindow.isOpen = browserManager.isWindowOpen(ctx.taskId);
    }
    ctx.state = AgentState.COMPLETED;
    ctx.finalStatus = "partial_success";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    const durationMs = Date.now() - new Date(ctx.startTime).getTime();
    ctx.finalReport = {
      summary: reason,
      outcome: "partial_success",
      completedCount: ctx.completedSteps?.length || 0,
      failedCount: ctx.failedSteps?.length || 0,
      durationMs,
      details: {
        extractedData: ctx.extractedData,
      },
    };
    emitState(AgentState.COMPLETED, ctx.currentStepIndex, "Partial Success");
    emitEvent("TASK_COMPLETED", `Task completed with partial verification: ${reason}`, { isPartial: true });
    return ctx;
  }

  private handleFailure(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void,
    errorDetails?: Record<string, unknown>
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    browserManager.completeTaskSession(ctx.taskId, "failed");
    if (ctx.browserWindow) {
      ctx.browserWindow.isOpen = browserManager.isWindowOpen(ctx.taskId);
    }
    ctx.state = AgentState.FAILED;
    ctx.finalStatus = "failed";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    const durationMs = Date.now() - new Date(ctx.startTime).getTime();
    ctx.finalReport = {
      summary: reason,
      outcome: "failed",
      completedCount: ctx.completedSteps?.length || 0,
      failedCount: ctx.failedSteps?.length || 0,
      durationMs,
      details: errorDetails,
    };
    emitState(AgentState.FAILED, ctx.currentStepIndex, "Failed");
    emitEvent("TASK_FAILED", reason, errorDetails);
    return ctx;
  }

  private handleClarification(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    ctx.state = AgentState.WAITING_FOR_USER;
    ctx.finalStatus = "needs_clarification";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.WAITING_FOR_USER, ctx.currentStepIndex, "Needs Clarification");
    emitEvent("CLARIFICATION_REQUIRED", reason);
    return ctx;
  }

  private handleWaitingForUser(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void,
    requiresConfirmation = true
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    ctx.state = AgentState.WAITING_FOR_USER;
    ctx.finalStatus = "needs_clarification";
    ctx.statusMessage = reason;
    ctx.requiresUserConfirmation = requiresConfirmation;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.WAITING_FOR_USER, ctx.currentStepIndex, "Needs Clarification");
    emitEvent("CLARIFICATION_REQUIRED", reason, { requiresConfirmation });
    return ctx;
  }

  private handleUnsupported(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    ctx.state = AgentState.FAILED;
    ctx.finalStatus = "unsupported_task";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.FAILED, ctx.currentStepIndex, "Unsupported Task");
    emitEvent("TASK_FAILED", reason);
    return ctx;
  }

  private handleBlocked(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    browserManager.completeTaskSession(ctx.taskId, "blocked");
    if (ctx.browserWindow) {
      ctx.browserWindow.isOpen = browserManager.isWindowOpen(ctx.taskId);
    }
    ctx.state = AgentState.FAILED;
    ctx.finalStatus = "blocked";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    const isAuth = /sign[- ]in|login|auth|subscription|premium/i.test(reason);
    const code = isAuth ? ErrorCode.AUTH_REQUIRED : ErrorCode.CAPTCHA_DETECTED;
    if (!ctx.taskVerification) {
      ctx.taskVerification = {
        passed: false,
        outcome: "blocked",
        isBlocked: true,
        reason,
        missingOutputs: [],
        failedChecks: [isAuth ? "AUTH_REQUIRED" : "BOT_CHALLENGE"],
        details: {
          mediaPlayback: {
            trackFound: Boolean(ctx.completedSteps?.some((s) => s.type === ActionType.CLICK || s.type === ActionType.NAVIGATE)),
            trackOpened: Boolean(ctx.latestObservation?.url?.includes("/track") || ctx.completedSteps?.some((s) => s.type === ActionType.CLICK)),
            playbackAttempted: true,
            playbackVerified: false,
            playbackBlocked: true,
            blockType: isAuth ? "AUTH_REQUIRED" : "BOT_CHALLENGE",
            blockReason: reason,
          },
        },
      };
    }
    const durationMs = Date.now() - new Date(ctx.startTime).getTime();
    ctx.finalReport = {
      summary: reason,
      outcome: "blocked",
      completedCount: ctx.completedSteps?.length || 0,
      failedCount: ctx.failedSteps?.length || 0,
      durationMs,
      details: {
        isBlocked: true,
        blockType: isAuth ? "AUTH_REQUIRED" : "BOT_CHALLENGE",
        mediaPlayback: (ctx.taskVerification?.details as any)?.mediaPlayback,
      },
    };
    ctx.errors.push({
      timestamp: new Date().toISOString(),
      code,
      message: reason,
    });
    emitState(AgentState.FAILED, ctx.currentStepIndex, "Access Blocked");
    emitEvent("TASK_FAILED", reason, { code, isBlocked: true });
    return ctx;
  }

  private async handleTimeout(
    ctx: ExecutionContext,
    emitEvent: (t: ExecutionEventType, m: string) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): Promise<ExecutionContext> {
    if (!this.markFinalized(ctx)) return ctx;
    await browserManager.closeTaskSession(ctx.taskId).catch(() => {});
    await browserManager.close().catch(() => {});
    if (ctx.browserWindow) {
      ctx.browserWindow.isOpen = false;
    }
    ctx.state = AgentState.FAILED;
    ctx.finalStatus = "timed_out";
    ctx.statusMessage = "Task execution timed out. Aborting browser session.";
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.FAILED, ctx.currentStepIndex, "Timed Out");
    emitEvent(ExecutionEventType.TASK_TIMEOUT, "Task execution timed out");
    return ctx;
  }

  private handleAbort(
    ctx: ExecutionContext,
    emitEvent: (t: ExecutionEventType, m: string) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    if (!this.markFinalized(ctx)) return ctx;
    browserManager.closeTaskSession(ctx.taskId).catch(() => {});
    if (ctx.browserWindow) {
      ctx.browserWindow.isOpen = false;
    }
    ctx.state = AgentState.CANCELLED;
    ctx.finalStatus = "cancelled";
    ctx.statusMessage = "Execution cancelled by user intervention.";
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.CANCELLED, ctx.currentStepIndex, "Cancelled");
    emitEvent("CANCELLED", "Task execution cancelled by user");
    return ctx;
  }
}
