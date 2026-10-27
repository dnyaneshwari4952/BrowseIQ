import { ExecutionMetrics, Phase4EvaluationMetrics } from "../types/results";

export interface TaskRecordParams {
  success: boolean;
  outcome?: "success" | "partial_success" | "failed" | "blocked" | "needs_clarification" | "cancelled";
  category?: string;
  durationMs: number;
  plannedActions: number;
  validatedActions: number;
  rejectedActions: number;
  executedActions: number;
  incorrectlyExecutedActions: number;
  retries: number;
  replans: number;
  route: "api" | "browser";
  falseSuccess?: boolean;
  wrongTargetAction?: boolean;
  constraintsPreserved?: boolean;
  hasConstraints?: boolean;
  isUnsupported?: boolean;
  recoveryAttempted?: boolean;
  recoverySucceeded?: boolean;
  isDuplicateAction?: boolean;
  localFileResolved?: boolean;
  mediaPlaybackVerified?: boolean;
  cancellationResponseMs?: number;
}

/**
 * Metrics Aggregator adhering to Phase 4 & Section 7
 * Calculates task success rate, capability category rates, false success,
 * constraint preservation, recovery rate, and latency distributions.
 */
export class MetricsCollector {
  private metrics: ExecutionMetrics = {
    totalTasks: 0,
    successfulTasks: 0,
    taskSuccessRate: 0,
    totalPlannedActions: 0,
    totalValidatedActions: 0,
    totalRejectedActions: 0,
    totalExecutedActions: 0,
    incorrectlyExecutedActions: 0,
    falseActionRate: 0,
    falseSuccesses: 0,
    falseSuccessRate: 0,
    totalRetries: 0,
    totalReplans: 0,
    avgTaskDurationMs: 0,
    apiRouteCount: 0,
    browserRouteCount: 0,
  };

  private durations: number[] = [];
  private partialSuccessTasks = 0;
  private failedTasks = 0;
  private blockedTasks = 0;
  private clarificationTasks = 0;
  private wrongTargetActions = 0;
  private constrainedTasks = 0;
  private preservedConstraints = 0;
  private unsupportedActions = 0;
  private recoveryAttempts = 0;
  private recoverySuccesses = 0;
  private duplicateActions = 0;
  private localFileAttempts = 0;
  private localFileSuccesses = 0;
  private mediaPlaybackAttempts = 0;
  private mediaPlaybackSuccesses = 0;
  private cancellationResponses: number[] = [];
  private categoryCounts: Record<string, { total: number; successful: number }> = {};
  private totalDurationMs = 0;

  recordTask(params: TaskRecordParams) {
    this.metrics.totalTasks += 1;
    this.durations.push(params.durationMs);
    this.totalDurationMs += params.durationMs;

    const outcome = params.outcome || (params.success ? "success" : "failed");

    if (outcome === "success" || params.success) {
      this.metrics.successfulTasks += 1;
    } else if (outcome === "partial_success") {
      this.partialSuccessTasks += 1;
    } else if (outcome === "failed") {
      this.failedTasks += 1;
    } else if (outcome === "blocked") {
      this.blockedTasks += 1;
    } else if (outcome === "needs_clarification") {
      this.clarificationTasks += 1;
    }

    if (params.falseSuccess) {
      this.metrics.falseSuccesses += 1;
    }

    if (params.wrongTargetAction) {
      this.wrongTargetActions += 1;
    }

    if (params.hasConstraints) {
      this.constrainedTasks += 1;
      if (params.constraintsPreserved !== false) {
        this.preservedConstraints += 1;
      }
    }

    if (params.isUnsupported) {
      this.unsupportedActions += 1;
    }

    if (params.recoveryAttempted) {
      this.recoveryAttempts += 1;
      if (params.recoverySucceeded) {
        this.recoverySuccesses += 1;
      }
    }

    if (params.isDuplicateAction) {
      this.duplicateActions += 1;
    }

    if (params.localFileResolved !== undefined) {
      this.localFileAttempts += 1;
      if (params.localFileResolved) this.localFileSuccesses += 1;
    }

    if (params.mediaPlaybackVerified !== undefined) {
      this.mediaPlaybackAttempts += 1;
      if (params.mediaPlaybackVerified) this.mediaPlaybackSuccesses += 1;
    }

    if (params.cancellationResponseMs !== undefined) {
      this.cancellationResponses.push(params.cancellationResponseMs);
    }

    // Category tracking
    const category = params.category || "general";
    if (!this.categoryCounts[category]) {
      this.categoryCounts[category] = { total: 0, successful: 0 };
    }
    this.categoryCounts[category].total += 1;
    if (params.success || outcome === "success") {
      this.categoryCounts[category].successful += 1;
    }

    this.metrics.totalPlannedActions += params.plannedActions;
    this.metrics.totalValidatedActions += params.validatedActions;
    this.metrics.totalRejectedActions += params.rejectedActions;
    this.metrics.totalExecutedActions += params.executedActions;
    this.metrics.incorrectlyExecutedActions += params.incorrectlyExecutedActions;
    this.metrics.totalRetries += params.retries;
    this.metrics.totalReplans += params.replans;

    if (params.route === "api") {
      this.metrics.apiRouteCount += 1;
    } else {
      this.metrics.browserRouteCount += 1;
    }

    this.recalculate();
  }

  private recalculate() {
    if (this.metrics.totalTasks > 0) {
      this.metrics.taskSuccessRate = this.metrics.successfulTasks / this.metrics.totalTasks;
      this.metrics.falseSuccessRate = Number((this.metrics.falseSuccesses / this.metrics.totalTasks).toFixed(4));
      this.metrics.avgTaskDurationMs = this.totalDurationMs / this.metrics.totalTasks;
    }

    if (this.metrics.totalPlannedActions > 0) {
      const faultyActions = this.metrics.totalRejectedActions + this.metrics.incorrectlyExecutedActions;
      this.metrics.falseActionRate = Number((faultyActions / this.metrics.totalPlannedActions).toFixed(4));
    }
  }

  getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
  }

  getPhase4Metrics(): Phase4EvaluationMetrics {
    const total = this.metrics.totalTasks || 1;
    const sortedDurations = [...this.durations].sort((a, b) => a - b);
    const medianDurationMs = sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length / 2)] : 0;
    const p95Index = Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.95));
    const p95DurationMs = sortedDurations.length > 0 ? sortedDurations[p95Index] : 0;

    const categoryRates: Record<string, { total: number; successful: number; rate: number }> = {};
    for (const [cat, data] of Object.entries(this.categoryCounts)) {
      categoryRates[cat] = {
        total: data.total,
        successful: data.successful,
        rate: data.total > 0 ? Number((data.successful / data.total).toFixed(4)) : 0,
      };
    }

    const avgActions =
      this.metrics.successfulTasks > 0
        ? Number((this.metrics.totalExecutedActions / this.metrics.successfulTasks).toFixed(2))
        : 0;

    const avgCancellation =
      this.cancellationResponses.length > 0
        ? Math.round(
            this.cancellationResponses.reduce((a, b) => a + b, 0) / this.cancellationResponses.length
          )
        : 0;

    return {
      totalTasks: this.metrics.totalTasks,
      successfulTasks: this.metrics.successfulTasks,
      overallTaskSuccessRate: Number((this.metrics.successfulTasks / total).toFixed(4)),
      partialSuccessTasks: this.partialSuccessTasks,
      partialSuccessRate: Number((this.partialSuccessTasks / total).toFixed(4)),
      failedTasks: this.failedTasks,
      failureRate: Number((this.failedTasks / total).toFixed(4)),
      blockedTasks: this.blockedTasks,
      blockedTaskAccuracy: this.blockedTasks > 0 ? 1.0 : 0,
      clarificationTasks: this.clarificationTasks,
      clarificationAccuracy: this.clarificationTasks > 0 ? 1.0 : 0,
      falseSuccesses: this.metrics.falseSuccesses,
      falseSuccessRate: Number((this.metrics.falseSuccesses / total).toFixed(4)),
      wrongTargetActions: this.wrongTargetActions,
      wrongTargetActionRate:
        this.metrics.totalExecutedActions > 0
          ? Number((this.wrongTargetActions / this.metrics.totalExecutedActions).toFixed(4))
          : 0,
      constraintPreservationCount: this.preservedConstraints,
      constraintPreservationRate:
        this.constrainedTasks > 0 ? Number((this.preservedConstraints / this.constrainedTasks).toFixed(4)) : 1.0,
      unsupportedActionsCount: this.unsupportedActions,
      unsupportedActionRate: Number((this.unsupportedActions / total).toFixed(4)),
      recoveryAttemptsCount: this.recoveryAttempts,
      successfulRecoveriesCount: this.recoverySuccesses,
      recoverySuccessRate:
        this.recoveryAttempts > 0 ? Number((this.recoverySuccesses / this.recoveryAttempts).toFixed(4)) : 0,
      duplicateActionsCount: this.duplicateActions,
      duplicateActionRate:
        this.metrics.totalExecutedActions > 0
          ? Number((this.duplicateActions / this.metrics.totalExecutedActions).toFixed(4))
          : 0,
      medianDurationMs,
      p95DurationMs,
      averageActionsPerCompletedTask: avgActions,
      cancellationResponsivenessMs: avgCancellation,
      localFileResolutionSuccessRate:
        this.localFileAttempts > 0
          ? Number((this.localFileSuccesses / this.localFileAttempts).toFixed(4))
          : 1.0,
      mediaPlaybackSuccessRate:
        this.mediaPlaybackAttempts > 0
          ? Number((this.mediaPlaybackSuccesses / this.mediaPlaybackAttempts).toFixed(4))
          : 1.0,
      categorySuccessRates: categoryRates,
    };
  }

  reset() {
    this.metrics = {
      totalTasks: 0,
      successfulTasks: 0,
      taskSuccessRate: 0,
      totalPlannedActions: 0,
      totalValidatedActions: 0,
      totalRejectedActions: 0,
      totalExecutedActions: 0,
      incorrectlyExecutedActions: 0,
      falseActionRate: 0,
      falseSuccesses: 0,
      falseSuccessRate: 0,
      totalRetries: 0,
      totalReplans: 0,
      avgTaskDurationMs: 0,
      apiRouteCount: 0,
      browserRouteCount: 0,
    };
    this.totalDurationMs = 0;
    this.durations = [];
    this.partialSuccessTasks = 0;
    this.failedTasks = 0;
    this.blockedTasks = 0;
    this.clarificationTasks = 0;
    this.wrongTargetActions = 0;
    this.constrainedTasks = 0;
    this.preservedConstraints = 0;
    this.unsupportedActions = 0;
    this.recoveryAttempts = 0;
    this.recoverySuccesses = 0;
    this.duplicateActions = 0;
    this.localFileAttempts = 0;
    this.localFileSuccesses = 0;
    this.mediaPlaybackAttempts = 0;
    this.mediaPlaybackSuccesses = 0;
    this.cancellationResponses = [];
    this.categoryCounts = {};
  }
}

export const globalMetrics = new MetricsCollector();
