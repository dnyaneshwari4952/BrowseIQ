import { Page, Locator } from "playwright";
import { Action, ActionExecutionResult, ActionStatus, ActionType } from "../types/actions";
import { AgentState, Plan, RouteDecision } from "../types/plans";
import { PageObservation } from "../types/browser";
import { ExecutionContext, DownloadedArtifact } from "../types/results";
import { ErrorCode, AgentError } from "../types/errors";
import { browserManager } from "../browser/browser-manager";
import { ActionExecutor } from "../browser/action-executor";
import { PageObserver } from "../browser/page-observer";
import { Planner } from "./planner";
import { TaskVerifier } from "./task-verifier";
import { RecoveryEngine, RecoveryDecision } from "./recovery-engine";
import { ApiRegistry } from "../api/api-registry";
import { ApiExecutor } from "../api/api-executor";
import { ExecutionEvent, ExecutionEventType } from "../observability/trace";
import { globalMetrics } from "../observability/metrics";
import { getConfig } from "../config";
import { SemanticDecomposer } from "./semantic-decomposer";
import { LocalSemanticReasoner } from "./local-semantic-reasoner";
import { PageCapabilityDetector } from "../browser/page-capability-detector";

export interface AgentRunOptions {
  task: string;
  targetUrl?: string;
  forceBrowser?: boolean;
  onEvent?: (event: ExecutionEvent) => void;
  onStateChange?: (state: AgentState, stepIndex?: number, actionName?: string) => void;
  abortSignal?: AbortSignal;
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
    const { task, targetUrl, forceBrowser, onEvent, onStateChange, abortSignal } = options;
    const config = getConfig();
    const taskId = `task-${Date.now()}`;
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

    const emitState = (state: AgentState, stepIndex = 0, actionName?: string) => {
      ctx.state = state;
      ctx.currentStepIndex = stepIndex;
      if (onStateChange) onStateChange(state, stepIndex, actionName);
    };

    const ctx: ExecutionContext = {
      taskId,
      originalTask: task,
      targetUrl,
      state: AgentState.IDLE,
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
      errors: [],
      startTime,
    };

    emitEvent("TASK_RECEIVED", `Agent received task: "${task}"`);

    // 1. UNDERSTANDING & PLANNING
    emitState(AgentState.UNDERSTANDING, 0, "Understanding task semantics");
    if (isAborted()) {
      clearTimeout(timeoutTimer);
      return isTimedOut ? await this.handleTimeout(ctx, emitEvent, emitState) : this.handleAbort(ctx, emitEvent, emitState);
    }

    // Phase 2A, 2M, 2N: Semantic Task Decomposition
    const taskIntent = SemanticDecomposer.decompose(task, null, targetUrl);
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


    emitState(AgentState.PLANNING, 0, "Synthesizing structured execution plan");
    emitEvent("PLANNING", "Evaluating task requirements and selecting route...");

    let plan: Plan;
    try {
      plan = await this.planner.plan({ task, targetUrl, forceBrowser });
      ctx.plan = plan;
      if (plan.routeDecision) {
        ctx.routeDecisions.push(plan.routeDecision);
      }
      emitEvent("PLAN_READY", `Generated plan with ${plan.actions.length} actions. Route: ${plan.routeDecision?.route.toUpperCase()}`);
    } catch (err: unknown) {
      clearTimeout(timeoutTimer);
      const message = err instanceof Error ? err.message : String(err);
      return this.handleFailure(ctx, `Planning failed: ${message}`, emitEvent, emitState);
    }

    // 2. CHECK API ROUTE VS BROWSER ROUTE
    const route = plan.routeDecision?.route ?? "browser";

    if (route === "api" && !forceBrowser) {
      emitState(AgentState.EXECUTING, 0, "Executing via fast API route");
      emitEvent("ACTION_STARTED", `Route: API. Querying API capability.`);

      const endpoint = ApiRegistry.getById(plan.routeDecision?.apiIntegrationId || "");
      if (endpoint) {
        const apiResult = await ApiExecutor.execute(endpoint, task);
        if (apiResult.success) {
          let extractedData = apiResult.data;
          // Format through LocalSemanticReasoner if API returns product catalog
          if (
            extractedData &&
            typeof extractedData === "object" &&
            Array.isArray((extractedData as Record<string, unknown>).products)
          ) {
            const rawProducts = (extractedData as { products: Array<Record<string, unknown>> }).products;
            if (
              taskIntent.comparison ||
              taskIntent.filter ||
              taskIntent.ordinal ||
              taskIntent.aggregation
            ) {
              extractedData = LocalSemanticReasoner.evaluate(rawProducts, taskIntent);
            }
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
            targetUrl,
            completedSteps: ctx.completedSteps,
            extractedData: ctx.extractedData,
            downloads: ctx.downloads,
          });

          ctx.taskVerification = taskVerif;
          clearTimeout(timeoutTimer);
          if (taskVerif.passed) {
            return this.handleSuccess(ctx, "Task verified successfully via API-first execution", emitEvent, emitState);
          } else {
            wasFalseSuccess = true;
            return this.handleFailure(ctx, taskVerif.reason, emitEvent, emitState);
          }
        } else if (apiResult.fallbackToBrowser) {
          // Log route transition
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
          const fallbackTargetUrl = apiResult.fallbackUrl || endpoint.browserFallbackUrl;
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
          return this.handleFailure(ctx, `API execution failed: ${apiResult.error?.message}`, emitEvent, emitState);
        }

      }
    }

    // 3. BROWSER AUTOMATION EXECUTION
    let activeTabId: string | null = null;
    let pageObservation: PageObservation | null = null;

    try {
      emitState(AgentState.OBSERVING, 0, "Initializing Playwright browser context");
      const tab = await browserManager.getActivePage();
      activeTabId = tab.tabId;
      ctx.browserTabs = browserManager.getTabs();

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
        const maxAttempts = action.retries?.maxRetries ?? config.MAX_ACTION_RETRIES;
        const stepFailedTargets = new Set<string>();
        if (action.target?.value) {
          stepFailedTargets.add(`${action.target.strategy || "any"}:${action.target.value.toLowerCase()}`);
        }

        while (actionAttempts < maxAttempts && !stepSuccess) {
          actionAttempts++;
          emitState(AgentState.EXECUTING, stepIndex, `Executing: ${action.type} (attempt ${actionAttempts})`);

          // Execute action with pre-validation and post-verification
          const execResponse = await ActionExecutor.execute({
            action,
            page: tab.page,
            tabId: activeTabId || "tab-0",
            beforeObservation: pageObservation,
            lastResolvedLocator,
          });

          pageObservation = execResponse.afterObservation;
          ctx.currentUrl = pageObservation.url;
          ctx.currentPageTitle = pageObservation.title;

          // Check for Page Capability Mismatch (Phase 6 & Phase 27)
          if (action.type === ActionType.NAVIGATE && pageObservation) {
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
              action.type === ActionType.NAVIGATE ||
              action.type === ActionType.SWITCH_TAB ||
              action.type === ActionType.OPEN_NEW_TAB
            ) {
              lastResolvedLocator = undefined;
            }
            ctx.completedSteps.push(execResponse.result);
            emitEvent("ACTION_SUCCESS", `Action ${action.type} completed and verified`);

            // Store extracted data
            if (execResponse.result.extractedData !== undefined) {
              if (action.type === ActionType.EVALUATE_SAFE) {
                if (Array.isArray(execResponse.result.extractedData)) {
                  const intent = SemanticDecomposer.decompose(task, pageObservation, targetUrl);
                  const evaluated = LocalSemanticReasoner.evaluate(execResponse.result.extractedData as any, intent);
                  ctx.extractedData = evaluated;
                  Object.assign(extractedItems, evaluated);
                } else {
                  ctx.extractedData = execResponse.result.extractedData;
                }
              } else if (action.type === ActionType.EXTRACT_TEXT && action.target) {
                const key = action.target.value || `data_${stepIndex}`;
                if (key.includes("title") || action.reason.toLowerCase().includes("title")) {
                  extractedItems.title = execResponse.result.extractedData;
                } else if (key.includes("price") || action.reason.toLowerCase().includes("price")) {
                  extractedItems.price = execResponse.result.extractedData;
                } else {
                  extractedItems[key] = execResponse.result.extractedData;
                }
              } else {
                ctx.extractedData = execResponse.result.extractedData;
              }
            }

            // Store downloads
            if (execResponse.result.downloadPath) {
              const artifact: DownloadedArtifact = {
                id: `download-${Date.now()}`,
                originalFilename: execResponse.result.downloadPath.split(/[/\\]/).pop() || "download",
                savedPath: execResponse.result.downloadPath,
                fileSizeBytes: 1024,
                downloadTime: new Date().toISOString(),
                verified: true,
              };
              ctx.downloads.push(artifact);
            }
          } else {
            // Action failed: Run Recovery Engine (Part 10 & 11)
            emitState(AgentState.RECOVERING, stepIndex, `Recovery: ${execResponse.result.error?.message}`);
            emitEvent("ACTION_FAILED", `Action failed: ${execResponse.result.error?.message}`, execResponse.result.error);

            if (action.target?.value) {
              stepFailedTargets.add(`${action.target.strategy || "any"}:${action.target.value.toLowerCase()}`);
            }

            ctx.errors.push({
              timestamp: new Date().toISOString(),
              stepId: action.id,
              code: execResponse.result.error?.code || ErrorCode.UNKNOWN_ERROR,
              message: execResponse.result.error?.message || "Action execution error",
            });

            const decision: RecoveryDecision = RecoveryEngine.determineRecovery({
              action,
              error: new AgentError(
                execResponse.result.error?.message || "Action failed",
                (execResponse.result.error?.code as any) || ErrorCode.UNKNOWN_ERROR
              ),
              attempt: actionAttempts,
              maxAttempts,
              replansUsed: ctx.replans,
              maxReplans: config.MAX_REPLANS,
              observation: pageObservation,
              plan,
              failedTargets: stepFailedTargets,
            });

            if (decision.strategy === "RETRY_WITH_ALTERNATIVE_LOCATOR" && decision.suggestedTarget) {
              emitEvent("RECOVERY_STARTED", `Adapting target selector: ${decision.reason}`);
              action.target = decision.suggestedTarget;
              stepFailedTargets.add(`${action.target.strategy || "any"}:${action.target.value.toLowerCase()}`);
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
              if (ctx.replans >= config.MAX_REPLANS) {
                return this.handleFailure(
                  ctx,
                  `Max replans reached (${config.MAX_REPLANS}). Unable to resolve step: ${decision.reason}`,
                  emitEvent,
                  emitState
                );
              }
              emitState(AgentState.REPLANNING, stepIndex, "Dynamic plan revision from live DOM");
              emitEvent("REPLAN_REQUESTED", `Replanning plan revision ${ctx.replans + 1}`);
              ctx.replans++;
              plan = await this.planner.replan({
                currentPlan: plan,
                failedStepIndex: stepIndex,
                observation: pageObservation,
                failureReason: decision.reason,
                failedTargets: stepFailedTargets,
              });
              ctx.plan = plan;
              emitEvent("PLAN_UPDATED", `Plan revised to ${plan.actions.length} actions.`);
              actionAttempts = 0;
              continue;
            }

            if (decision.strategy === "WAITING_FOR_USER") {
              emitState(AgentState.WAITING_FOR_USER, stepIndex, decision.reason);
              emitEvent("RECOVERY_STARTED", decision.reason);
              return this.handleFailure(ctx, decision.reason, emitEvent, emitState);
            }

            if (decision.terminal) {
              ctx.failedSteps.push(execResponse.result);
              return this.handleFailure(ctx, decision.reason, emitEvent, emitState);
            }
          }
        }

        if (!stepSuccess && actionAttempts >= maxAttempts) {
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
      // The browser is the source of truth. Task success must be strictly verified!
      emitState(AgentState.VERIFYING, plan.actions.length, "Verifying task completion criteria");
      emitEvent("TASK_VERIFICATION", "Checking task success criteria against live browser state...");

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

      if (!taskVerification.passed) {
        wasFalseSuccess = true;
        emitEvent("TASK_FAILED", `Task verification failed: ${taskVerification.reason}`, {
          missingOutputs: taskVerification.missingOutputs,
          failedChecks: taskVerification.failedChecks,
        });
        return this.handleFailure(ctx, taskVerification.reason, emitEvent, emitState);
      }

      return this.handleSuccess(
        ctx,
        `Task verified successfully. All required operations and outputs satisfied.`,
        emitEvent,
        emitState
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return this.handleFailure(ctx, `Runtime error in agent loop: ${message}`, emitEvent, emitState);
    } finally {
      clearTimeout(timeoutTimer);
      if (isTimedOut) {
        await browserManager.close().catch(() => {});
      }
      // Record metrics with accurate false success detection (Part 22)
      globalMetrics.recordTask({
        success: ctx.finalStatus === "completed",
        durationMs: Date.now() - startMs,
        plannedActions: ctx.plan?.actions.length || 0,
        validatedActions: ctx.completedSteps.length + ctx.failedSteps.length,
        rejectedActions: ctx.failedSteps.length,
        executedActions: ctx.completedSteps.length,
        incorrectlyExecutedActions: 0,
        retries: ctx.retries,
        replans: ctx.replans,
        route: (ctx.plan?.routeDecision?.route as "api" | "browser") || "browser",
        falseSuccess: wasFalseSuccess,
      });
    }
  }

  private handleSuccess(
    ctx: ExecutionContext,
    message: string,
    emitEvent: (t: ExecutionEventType, m: string) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    ctx.state = AgentState.COMPLETED;
    ctx.finalStatus = "completed";
    ctx.statusMessage = message;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.COMPLETED, ctx.plan?.actions.length || 0, "Completed");
    emitEvent("TASK_COMPLETED", message);
    return ctx;
  }

  private handleFailure(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    ctx.state = AgentState.FAILED;
    ctx.finalStatus = "failed";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.FAILED, ctx.currentStepIndex, "Failed");
    emitEvent("TASK_FAILED", reason);
    return ctx;
  }

  private handleClarification(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    ctx.state = AgentState.WAITING_FOR_USER;
    ctx.finalStatus = "needs_clarification";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.WAITING_FOR_USER, ctx.currentStepIndex, "Needs Clarification");
    emitEvent("CLARIFICATION_REQUIRED", reason);
    return ctx;
  }

  private handleUnsupported(
    ctx: ExecutionContext,
    reason: string,
    emitEvent: (t: ExecutionEventType, m: string, d?: unknown) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): ExecutionContext {
    ctx.state = AgentState.FAILED;
    ctx.finalStatus = "unsupported_task";
    ctx.statusMessage = reason;
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.FAILED, ctx.currentStepIndex, "Unsupported Task");
    emitEvent("TASK_FAILED", reason);
    return ctx;
  }


  private async handleTimeout(
    ctx: ExecutionContext,
    emitEvent: (t: ExecutionEventType, m: string) => void,
    emitState: (s: AgentState, idx?: number, name?: string) => void
  ): Promise<ExecutionContext> {
    await browserManager.close().catch(() => {});
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
    ctx.state = AgentState.CANCELLED;
    ctx.finalStatus = "cancelled";
    ctx.statusMessage = "Execution cancelled by user intervention.";
    ctx.endTime = new Date().toISOString();
    emitState(AgentState.CANCELLED, ctx.currentStepIndex, "Cancelled");
    emitEvent("CANCELLED", "Task execution cancelled by user");
    return ctx;
  }
}
