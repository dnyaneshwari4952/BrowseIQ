import { NextRequest, NextResponse } from "next/server";
import { AgentLoop } from "@/lib/agent/agent-loop";
import { ExecutionEvent } from "@/lib/observability/trace";
import { AgentState } from "@/lib/types/plans";


export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { task, targetUrl, forceBrowser } = body;

    if (!task || typeof task !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'task' parameter in request body" },
        { status: 400 }
      );
    }

    const isSSE = request.headers.get("accept")?.includes("text/event-stream");
    const agent = new AgentLoop();

    if (isSSE) {
      const responseStream = new TransformStream();
      const writer = responseStream.writable.getWriter();
      const encoder = new TextEncoder();

      const sendSseMessage = async (eventType: string, data: unknown) => {
        try {
          const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
          await writer.write(encoder.encode(payload));
        } catch {
          // Client may have disconnected
        }
      };

      // Run task asynchronously and stream events
      (async () => {
        try {
          const result = await agent.runTask({
            task,
            targetUrl,
            forceBrowser: Boolean(forceBrowser),
            onEvent: (event: ExecutionEvent) => {
              sendSseMessage("event", event);
            },
            onStateChange: (state: AgentState, stepIndex?: number, actionName?: string) => {
              sendSseMessage("state", { state, stepIndex, actionName });
            },
            abortSignal: request.signal,
          });

          await sendSseMessage("result", result);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await sendSseMessage("error", { message });
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

    // Standard synchronous JSON execution
    const executionContext = await agent.runTask({
      task,
      targetUrl,
      forceBrowser: Boolean(forceBrowser),
      abortSignal: request.signal,
    });

    return NextResponse.json(executionContext);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
