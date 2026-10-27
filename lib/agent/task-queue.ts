import { AgentError, ErrorCode } from "../types/errors";
import { logger } from "../observability/logger";
import { TaskLifecycleState, TaskRecord, assertValidTaskTransition } from "./task-lifecycle";

export interface QueuedTask<T> {
  id: string;
  instruction: string;
  mode: "live" | "test";
  createdAt: number;
  abortController: AbortController;
  execute: (signal: AbortSignal) => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Production Task Queue and Concurrency Controller (Phase 1, Section 6).
 * Enforces:
 * - Bounded queue capacity (prevents unbounded memory growth)
 * - Single active task lock on the browser session (prevents conflicting concurrent control)
 * - Per-task cancellation with abort signal propagation
 * - Guaranteed cleanup in finally blocks
 */
export class TaskQueue {
  private static instance: TaskQueue | null = null;
  private queue: QueuedTask<any>[] = [];
  private activeTask: QueuedTask<any> | null = null;
  private maxQueueSize = 10;
  private taskHistory: Map<string, TaskRecord> = new Map();

  constructor(maxQueueSize = 10) {
    this.maxQueueSize = maxQueueSize;
  }

  static getInstance(): TaskQueue {
    if (!TaskQueue.instance) {
      TaskQueue.instance = new TaskQueue();
    }
    return TaskQueue.instance;
  }

  /**
   * Enqueues and executes a task with single-task browser mutual exclusion.
   */
  async enqueue<T>(params: {
    taskId: string;
    instruction: string;
    mode?: "live" | "test";
    timeoutMs?: number;
    externalSignal?: AbortSignal;
    execute: (signal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const { taskId, instruction, mode = "live", timeoutMs = 180000, externalSignal, execute } = params;

    if (this.queue.length >= this.maxQueueSize) {
      throw new AgentError(
        `Task queue capacity exceeded (${this.maxQueueSize} maximum queued tasks). Please try again later.`,
        ErrorCode.QUEUE_FULL,
        true,
        { queueLength: this.queue.length }
      );
    }

    const abortController = new AbortController();

    // Link external cancellation if provided
    if (externalSignal) {
      if (externalSignal.aborted) {
        abortController.abort();
      } else {
        externalSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }
    }

    // Set overall task execution deadline
    let timeoutTimer: NodeJS.Timeout | null = null;
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        logger.warn(`Task ${taskId} reached execution deadline of ${timeoutMs}ms.`);
        abortController.abort();
      }, timeoutMs);
    }

    return new Promise<T>((resolve, reject) => {
      const queuedItem: QueuedTask<T> = {
        id: taskId,
        instruction,
        mode,
        createdAt: Date.now(),
        abortController,
        execute,
        resolve: (val) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          resolve(val);
        },
        reject: (err) => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          reject(err);
        },
      };

      this.queue.push(queuedItem);
      logger.info(`Task ${taskId} enqueued. Position: ${this.queue.length}`);

      // Attempt to pump the queue
      this.processNext();
    });
  }

  /**
   * Process the next task in the queue if no active task is running.
   */
  private async processNext(): Promise<void> {
    if (this.activeTask !== null || this.queue.length === 0) {
      return;
    }

    const current = this.queue.shift()!;
    this.activeTask = current;

    logger.info(`Starting execution of task ${current.id}. Mode: ${current.mode}`);

    try {
      if (current.abortController.signal.aborted) {
        throw new AgentError("Task was cancelled before execution started.", ErrorCode.CANCELLED, false);
      }

      const result = await current.execute(current.abortController.signal);
      current.resolve(result);
    } catch (err) {
      current.reject(err);
    } finally {
      this.activeTask = null;
      // Pump next queued task
      this.processNext();
    }
  }

  /**
   * Cancels a task by ID whether active or queued.
   */
  cancelTask(taskId: string, reason = "User requested cancellation"): boolean {
    // If active task
    if (this.activeTask?.id === taskId) {
      logger.info(`Aborting active task ${taskId}: ${reason}`);
      this.activeTask.abortController.abort();
      return true;
    }

    // If waiting in queue
    const index = this.queue.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      const [removed] = this.queue.splice(index, 1);
      logger.info(`Removed queued task ${taskId}: ${reason}`);
      removed.abortController.abort();
      removed.reject(
        new AgentError(`Task cancelled in queue: ${reason}`, ErrorCode.CANCELLED, false)
      );
      return true;
    }

    return false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getActiveTaskId(): string | null {
    return this.activeTask?.id || null;
  }

  isBusy(): boolean {
    return this.activeTask !== null;
  }

  clearQueue(): void {
    for (const item of this.queue) {
      item.abortController.abort();
      item.reject(new AgentError("Task queue was cleared.", ErrorCode.CANCELLED, false));
    }
    this.queue = [];
  }
}

export const taskQueue = TaskQueue.getInstance();
