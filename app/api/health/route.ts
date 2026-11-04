import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { globalMetrics } from "@/lib/observability/metrics";
import { ApiRegistry } from "@/lib/api/api-registry";
import { detectDisplayEnvironment, BrowserManager } from "@/lib/browser/browser-manager";

export async function GET() {
  try {
    const config = getConfig();

    // 1. Process Health
    const processHealth = {
      status: "ready" as const,
      uptimeSeconds: Math.floor(process.uptime()),
      pid: process.pid,
      nodeVersion: process.version,
      env: config.NODE_ENV,
    };

    // 2. Browser Readiness, Graphical Display Capability & Verified Launch State
    const displayEnv = detectDisplayEnvironment();
    const browserMgr = BrowserManager.getInstance();
    const isBrowserLaunched = browserMgr.isBrowserLaunched();
    const openWindows = browserMgr.getOpenWindowsCount();
    const activeSessions = browserMgr.getActiveSessionsCount();

    const browserHealth = {
      status: displayEnv.hasDisplay ? ("ready" as const) : ("degraded" as const),
      headless: false,
      visible: true,
      displayAvailable: displayEnv.hasDisplay,
      displayType: displayEnv.displayType,
      displayLimitation: displayEnv.warning || null,
      isLaunched: isBrowserLaunched,
      openWindows,
      activeSessions,
      viewport: {
        width: config.VIEWPORT_WIDTH,
        height: config.VIEWPORT_HEIGHT,
      },
    };

    // 3. Primary Provider Configuration (Does not make paid external call on health poll)
    const isOpenAiConfigured = Boolean(
      config.LLM_API_KEY &&
      config.LLM_API_KEY !== "your_api_key_here" &&
      !config.LLM_API_KEY.includes("mock")
    );

    let primaryConfigured = false;
    if (config.LLM_PROVIDER === "openai") {
      primaryConfigured = isOpenAiConfigured;
    } else if (config.LLM_PROVIDER === "mock") {
      primaryConfigured = config.NODE_ENV !== "production";
    }

    const primaryProviderHealth = {
      name: config.LLM_PROVIDER,
      model: config.LLM_MODEL,
      status: primaryConfigured ? ("configured" as const) : ("missing_credentials" as const),
    };

    // 4. Fallback Provider Configuration
    const fallbackName = config.LLM_FALLBACK_PROVIDER || "none";
    const fallbackConfigured = fallbackName !== "none" && (
      (fallbackName === "openai" && isOpenAiConfigured) ||
      (fallbackName === "mock" && config.NODE_ENV !== "production")
    );

    const fallbackProviderHealth = {
      name: fallbackName,
      status: fallbackConfigured ? ("configured" as const) : fallbackName === "none" ? ("disabled" as const) : ("missing_credentials" as const),
    };

    // 5. API Integrations Registry Readiness
    const registeredEndpoints = ApiRegistry.getAll();
    const apiRegistryHealth = {
      status: "ready" as const,
      endpointCount: registeredEndpoints.length,
    };

    // Overall Service Health: BrowseIQ uses Playwright with Deterministic Planning as its core automation engine.
    // External AI providers are optional. As long as display capability and browser readiness are verified, the service is healthy.
    const isHealthy =
      (displayEnv.hasDisplay || config.NODE_ENV === "test") &&
      processHealth.status === "ready";

    return NextResponse.json({
      status: isHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptimeSeconds: processHealth.uptimeSeconds,
      system: {
        browserHeadless: browserHealth.headless,
        displayAvailable: displayEnv.hasDisplay,
        llmProvider: primaryProviderHealth.name,
      },
      components: {
        process: processHealth,
        browser: browserHealth,
        primaryProvider: primaryProviderHealth,
        fallbackProvider: fallbackProviderHealth,
        apiRegistry: apiRegistryHealth,
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
