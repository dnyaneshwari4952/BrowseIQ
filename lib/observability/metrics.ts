import { ExecutionMetrics } from "../types/results";

/**
 * Metrics Aggregator adhering to Section 32 & Section 33
 * Calculates task success rate, false action rate, retries, replans, and route distributions
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

  private totalDurationMs = 0;

  recordTask(params: {
    success: boolean;
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
  }) {
    this.metrics.totalTasks += 1;
    if (params.success) {
      this.metrics.successfulTasks += 1;
    }

    if (params.falseSuccess) {
      this.metrics.falseSuccesses += 1;
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

    this.totalDurationMs += params.durationMs;

    this.recalculate();
  }

  private recalculate() {
    if (this.metrics.totalTasks > 0) {
      this.metrics.taskSuccessRate = this.metrics.successfulTasks / this.metrics.totalTasks;
      this.metrics.falseSuccessRate = Number((this.metrics.falseSuccesses / this.metrics.totalTasks).toFixed(4));
      this.metrics.avgTaskDurationMs = this.totalDurationMs / this.metrics.totalTasks;
    }

    // Section 33: False Action Rate = (Rejected Actions + Incorrectly Executed Actions) / Total Planned Actions
    if (this.metrics.totalPlannedActions > 0) {
      const faultyActions = this.metrics.totalRejectedActions + this.metrics.incorrectlyExecutedActions;
      this.metrics.falseActionRate = Number((faultyActions / this.metrics.totalPlannedActions).toFixed(4));
    }
  }

  getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
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
  }
}

export const globalMetrics = new MetricsCollector();
