import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { globalMetrics } from "@/lib/observability/metrics";

export async function GET() {
  try {
    const config = getConfig();

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      system: {
        nodeVersion: process.version,
        env: config.NODE_ENV,
        browserHeadless: config.BROWSER_HEADLESS,
        defaultTimeout: config.DEFAULT_ACTION_TIMEOUT,
        taskTimeout: config.TASK_TIMEOUT,
        llmProvider: config.LLM_PROVIDER,
        llmModel: config.LLM_MODEL,
      },
      metrics: globalMetrics.getMetrics(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Internal system error",
      },
      { status: 500 }
    );
  }
}
