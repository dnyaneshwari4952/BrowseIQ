import { NextRequest, NextResponse } from "next/server";
import { AgentLoop } from "@/lib/agent/agent-loop";
import { ExecutionEvent, redactSecrets } from "@/lib/observability/trace";
import { AgentState } from "@/lib/types/plans";
import { TaskLifecycleState } from "@/lib/agent/task-lifecycle";
import { taskQueue } from "@/lib/agent/task-queue";
import { getConfig } from "@/lib/config";
import { coerceOperatingMode, DEFAULT_OPERATING_MODE } from "@/lib/types/operating-mode";
import { browserManager } from "@/lib/browser/browser-manager";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { task, targetUrl, forceBrowser, settings, mode } = body;

    if (!task || typeof task !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'task' parameter in request body" },
        { status: 400 }
      );
    }

    // 1. Strict Live-Mode Enforcement: Test Mode is removed from the application
    if (mode && mode !== "live") {
      return NextResponse.json(
        { error: "Test Mode has been removed. The application operates exclusively in Live Mode." },
        { status: 400 }
      );
    }

    // 2. Isolate test fixtures: ordinary user tasks cannot use test fixtures as targets
    const isTargetingFixture =
      (typeof targetUrl === "string" && (targetUrl.includes("/test-fixtures") || targetUrl.includes("/api/test-fixtures"))) ||
      (typeof task === "string" && (task.includes("localhost:3000/test-fixtures") || task.includes("127.0.0.1:3000/test-fixtures")));

    if (isTargetingFixture) {
      return NextResponse.json(
        { error: "Test fixtures (/test-fixtures) cannot be used as live task targets. Live execution must target real websites or authorized resources." },
        { status: 400 }
      );
    }

    // 3. Strict Visible Browser Enforcement: Reject any request that attempts to enable headless mode
    if (body.headless === true || settings?.headless === true) {
      return NextResponse.json(
        { error: "Headless Browser Mode has been removed. All tasks execute in a visible browser window." },
        { status: 400 }
      );
    }

    const executionMode = "live" as const;
    const sanitizedSettings = settings
      ? {
          actionTimeout: settings.actionTimeout,
          maxRetries: settings.maxRetries,
          maxReplans: settings.maxReplans,
          requireConfirmation: settings.requireConfirmation,
          localFilesEnabled: typeof settings.localFilesEnabled === "boolean" ? settings.localFilesEnabled : undefined,
          approvedDirectory: typeof settings.approvedDirectory === "string" ? settings.approvedDirectory : undefined,
          accessMode: settings.accessMode === "whole_computer" || settings.accessMode === "selected_folders" ? settings.accessMode : undefined,
          wholeComputerConfirmed: typeof settings.wholeComputerConfirmed === "boolean" ? settings.wholeComputerConfirmed : undefined,
          approvedDirectories: Array.isArray(settings.approvedDirectories) ? settings.approvedDirectories : undefined,
        }
      : undefined;

    // Backend validates operating mode independently — frontend selection alone is not trusted
    const operatingMode = coerceOperatingMode(body.operatingMode ?? DEFAULT_OPERATING_MODE);
    const isSSE = request.headers.get("accept")?.includes("text/event-stream");
    const agent = new AgentLoop();
    const config = getConfig();
    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (isSSE) {
      const responseStream = new TransformStream();
      const writer = responseStream.writable.getWriter();
      const encoder = new TextEncoder();

      const sendSseMessage = async (eventType: string, data: unknown) => {
        try {
          const sanitized = redactSecrets(data);
          const payload = `event: ${eventType}\ndata: ${JSON.stringify(sanitized)}\n\n`;
          await writer.write(encoder.encode(payload));
        } catch {
          // Client may have disconnected
        }
      };

      // Run task through bounded TaskQueue with single-task browser mutual exclusion
      (async () => {
        try {
          await sendSseMessage("state", {
            state: AgentState.IDLE,
            lifecycleState: TaskLifecycleState.QUEUED,
            actionName: "Queued for browser execution",
          });

          const result = await taskQueue.enqueue({
            taskId,
            instruction: task,
            mode: executionMode,
            timeoutMs: config.TASK_TIMEOUT,
            externalSignal: request.signal,
            execute: async (signal) => {
              return agent.runTask({
                taskId,
                task,
                targetUrl,
                forceBrowser: Boolean(forceBrowser),
                mode: executionMode,
                operatingMode,
                settings: sanitizedSettings,
                onEvent: (event: ExecutionEvent) => {
                  sendSseMessage("event", event);
                },
                onStateChange: (state: AgentState, stepIndex?: number, actionName?: string) => {
                  sendSseMessage("state", { state, stepIndex, actionName });
                },
                onLifecycleChange: (lifecycleState: TaskLifecycleState, stepIndex?: number, actionName?: string) => {
                  sendSseMessage("lifecycle", { lifecycleState, stepIndex, actionName });
                },
                abortSignal: signal,
              });
            },
          });

          await sendSseMessage("result", result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await sendSseMessage("error", { message: redactSecrets(message) });
        } finally {
          await writer.close().catch(() => {});
        }
      })();

      return new Response(responseStream.readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // Standard synchronous JSON execution via TaskQueue
    const executionContext = await taskQueue.enqueue({
      taskId,
      instruction: task,
      mode: executionMode,
      timeoutMs: config.TASK_TIMEOUT,
      externalSignal: request.signal,
      execute: async (signal) => {
        return agent.runTask({
          taskId,
          task,
          targetUrl,
          forceBrowser: Boolean(forceBrowser),
          mode: executionMode,
          operatingMode,
          settings: sanitizedSettings,
          abortSignal: signal,
        });
      },
    });

    return NextResponse.json(redactSecrets(executionContext));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: redactSecrets(message) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId");
    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId parameter" }, { status: 400 });
    }
    const cancelled = taskQueue.cancelTask(taskId, "Cancelled via API DELETE request");
    const closeWindow = url.searchParams.get("closeWindow") === "true";
    if (closeWindow || cancelled) {
      await browserManager.closeTaskSession(taskId).catch(() => {});
    }
    return NextResponse.json({ success: true, taskId, cancelled });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: redactSecrets(message) }, { status: 500 });
  }
}
