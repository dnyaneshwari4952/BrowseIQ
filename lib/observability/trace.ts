/**
 * Execution Tracing & Event Streaming System
 * Section 24 (Observability) & Section 26 (Streaming Execution)
 */

export const ExecutionEventType = {
  TASK_RECEIVED: "TASK_RECEIVED",
  UNDERSTANDING: "UNDERSTANDING",
  PLANNING: "PLANNING",
  PLAN_READY: "PLAN_READY",
  OBSERVING: "OBSERVING",
  VALIDATING: "VALIDATING",
  VALIDATION_PASSED: "VALIDATION_PASSED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  ACTION_STARTED: "ACTION_STARTED",
  ACTION_COMPLETED: "ACTION_COMPLETED",
  ACTION_SUCCESS: "ACTION_SUCCESS",
  ACTION_FAILED: "ACTION_FAILED",
  ACTION_VERIFICATION: "ACTION_VERIFICATION",
  VERIFICATION: "VERIFICATION",
  VERIFICATION_PASSED: "VERIFICATION_PASSED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  RETRYING: "RETRYING",
  RECOVERY_STARTED: "RECOVERY_STARTED",
  PAGE_REOBSERVED: "PAGE_REOBSERVED",
  REPLANNING: "REPLANNING",
  REPLAN_REQUESTED: "REPLAN_REQUESTED",
  PLAN_UPDATED: "PLAN_UPDATED",
  TASK_VERIFICATION: "TASK_VERIFICATION",
  TASK_COMPLETED: "TASK_COMPLETED",
  TASK_FAILED: "TASK_FAILED",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  CLARIFICATION_REQUIRED: "CLARIFICATION_REQUIRED",
  ROUTE_DECIDED: "ROUTE_DECIDED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  TASK_TIMEOUT: "TASK_TIMEOUT",
} as const;

export type ExecutionEventType = (typeof ExecutionEventType)[keyof typeof ExecutionEventType];

export interface ExecutionEvent {
  id: string;
  taskId: string;
  type: ExecutionEventType;
  timestamp: string;
  message: string;
  data?: Record<string, unknown>;
}

export type EventListener = (event: ExecutionEvent) => void;

export class ExecutionTracer {
  private taskId: string;
  private events: ExecutionEvent[] = [];
  private listeners: Set<EventListener> = new Set();
  private startTime: number;

  constructor(taskId: string) {
    this.taskId = taskId;
    this.startTime = Date.now();
  }

  emit(type: ExecutionEventType, message: string, data?: Record<string, unknown>): ExecutionEvent {
    const event: ExecutionEvent = {
      id: `${this.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId: this.taskId,
      type,
      timestamp: new Date().toISOString(),
      message,
      data,
    };

    this.events.push(event);

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in event listener:", err);
      }
    }

    return event;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getEvents(): ExecutionEvent[] {
    return [...this.events];
  }

  getDurationMs(): number {
    return Date.now() - this.startTime;
  }

  exportTraceSummary(): {
    taskId: string;
    totalEvents: number;
    durationMs: number;
    events: ExecutionEvent[];
  } {
    return {
      taskId: this.taskId,
      totalEvents: this.events.length,
      durationMs: this.getDurationMs(),
      events: this.events,
    };
  }
}
