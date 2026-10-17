import { RouteDecision } from "../types/plans";
import { ApiRegistry, ApiEndpointDefinition } from "./api-registry";

export interface RouteOptions {
  forceBrowser?: boolean;
  preferApi?: boolean;
  targetUrl?: string;
}

export class ApiRouter {
  /**
   * Evaluates task capabilities and decides between direct API and Browser route
   */
  static decideRoute(taskText: string, options: RouteOptions = {}): RouteDecision {
    if (options.forceBrowser) {
      return {
        route: "browser",
        reason: "User or task configuration explicitly forced browser automation route",
        confidence: 1.0,
        fallbackAvailable: false,
      };
    }

    // If target URL is provided and points to a web page (not an API endpoint)
    if (options.targetUrl && !options.targetUrl.includes("/api/")) {
      return {
        route: "browser",
        reason: `Target URL is a web page (${options.targetUrl}) requiring browser automation`,
        confidence: 0.95,
        fallbackAvailable: false,
      };
    }

    const lower = taskText.toLowerCase();
    const hasExplicitUiIntent =
      lower.includes("page") ||
      lower.includes("website") ||
      lower.includes("browser") ||
      lower.includes("click") ||
      lower.includes("button") ||
      lower.includes("open") ||
      lower.includes("screen") ||
      lower.includes("tab");

    // Check if task matches a registered API capability
    const matchingEndpoint = ApiRegistry.findMatchingEndpoint(taskText);

    // Only route to API if user explicitly requests API/endpoint OR asks for direct API query without UI keywords
    const hasExplicitApiIntent =
      options.preferApi ||
      lower.includes("api") ||
      lower.includes("endpoint") ||
      lower.includes("service") ||
      (options.targetUrl && options.targetUrl.includes("/api/"));

    if (matchingEndpoint && (hasExplicitApiIntent || !hasExplicitUiIntent)) {
      return {
        route: "api",
        reason: `Task matches registered API integration: '${matchingEndpoint.name}' (${matchingEndpoint.endpoint}). API-first execution provides sub-100ms deterministic response.`,
        confidence: 0.92,
        fallbackAvailable: true,
        apiIntegrationId: matchingEndpoint.id,
      };
    }

    return {
      route: "browser",
      reason: "Task requires UI interaction or no direct API endpoint requested. Delegating to Playwright browser automation.",
      confidence: 0.9,
      fallbackAvailable: matchingEndpoint !== null,
      apiIntegrationId: matchingEndpoint?.id,
    };
  }
}
