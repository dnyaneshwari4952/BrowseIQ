import { ApiEndpointDefinition, ApiRegistry } from "./api-registry";
import { getConfig } from "../config";

export const ApiErrorCode = {
  AUTH_ERROR: "AUTH_ERROR",
  RATE_LIMIT: "RATE_LIMIT",
  NETWORK_ERROR: "NETWORK_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  NOT_FOUND: "NOT_FOUND",
  SERVER_ERROR: "SERVER_ERROR",
  TIMEOUT: "TIMEOUT",
  UNKNOWN_API_ERROR: "UNKNOWN_API_ERROR",
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiExecutionResult {
  success: boolean;
  endpointId: string;
  statusCode?: number;
  data?: unknown;
  error?: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
  fallbackToBrowser: boolean;
  fallbackUrl?: string;
  durationMs: number;
}

export class ApiExecutor {
  /**
   * Classify HTTP status and network errors into standard ApiErrorCode
   */
  static classifyError(status: number, message: string): ApiErrorCode {
    if (status === 401 || status === 403) return ApiErrorCode.AUTH_ERROR;
    if (status === 429) return ApiErrorCode.RATE_LIMIT;
    if (status === 404) return ApiErrorCode.NOT_FOUND;
    if (status >= 500) return ApiErrorCode.SERVER_ERROR;
    const lower = message.toLowerCase();
    if (
      lower.includes("network") ||
      lower.includes("fetch failed") ||
      lower.includes("failed to fetch") ||
      lower.includes("enotfound") ||
      lower.includes("econnrefused") ||
      lower.includes("dns")
    ) {
      return ApiErrorCode.NETWORK_ERROR;
    }
    if (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("abort") ||
      lower.includes("canceled") ||
      lower.includes("cancelled")
    ) {
      return ApiErrorCode.TIMEOUT;
    }
    if (message.toLowerCase().includes("json") || message.toLowerCase().includes("parse")) {
      return ApiErrorCode.INVALID_RESPONSE;
    }
    return ApiErrorCode.UNKNOWN_API_ERROR;
  }

  /**
   * Executes a registered API endpoint with failure classification and fallback signaling
   */
  static async execute(
    endpoint: ApiEndpointDefinition,
    taskText: string,
    baseUrl = "http://localhost:3000",
    signal?: AbortSignal
  ): Promise<ApiExecutionResult> {
    const startTime = Date.now();
    const params = endpoint.extractParameters(taskText);

    try {
      // Build full URL
      let targetUrl = endpoint.endpoint.startsWith("http")
        ? endpoint.endpoint
        : `${baseUrl.replace(/\/+$/, "")}${endpoint.endpoint}`;

      if (endpoint.method === "GET" && Object.keys(params).length > 0) {
        const queryParams = new URLSearchParams(params);
        targetUrl += `?${queryParams.toString()}`;
      }

      const timeoutSignal = AbortSignal.timeout(5000);
      const combinedSignal =
        typeof AbortSignal.any === "function" && signal
          ? AbortSignal.any([timeoutSignal, signal])
          : (signal || timeoutSignal);

      const res = await fetch(targetUrl, {
        method: endpoint.method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: endpoint.method === "POST" ? JSON.stringify(params) : undefined,
        signal: combinedSignal,
      });

      const durationMs = Date.now() - startTime;

      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        const errorCode = this.classifyError(res.status, errorText);

        // Fallback to browser is safe on server errors, rate limits, or not-found
        const fallbackAllowed =
          errorCode === ApiErrorCode.SERVER_ERROR ||
          errorCode === ApiErrorCode.NOT_FOUND ||
          errorCode === ApiErrorCode.RATE_LIMIT;

        return {
          success: false,
          endpointId: endpoint.id,
          statusCode: res.status,
          error: {
            code: errorCode,
            message: `API execution returned HTTP ${res.status}: ${errorText}`,
          },
          fallbackToBrowser: fallbackAllowed,
          fallbackUrl: fallbackAllowed ? endpoint.browserFallbackUrl : undefined,
          durationMs,
        };
      }

      const contentType = res.headers.get("content-type") || "";
      let data: unknown;
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { raw: text };
      }

      // Validate response against endpoint schema if specified
      if (endpoint.responseSchema) {
        const schemaCheck = endpoint.responseSchema.safeParse(data);
        if (!schemaCheck.success) {
          return {
            success: false,
            endpointId: endpoint.id,
            statusCode: res.status,
            error: {
              code: ApiErrorCode.INVALID_RESPONSE,
              message: `API response schema validation failed: ${JSON.stringify(schemaCheck.error.format())}`,
            },
            fallbackToBrowser: true,
            fallbackUrl: endpoint.browserFallbackUrl,
            durationMs,
          };
        }
      }

      return {
        success: true,
        endpointId: endpoint.id,
        statusCode: res.status,
        data,
        fallbackToBrowser: false,
        durationMs,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      const errorCode = this.classifyError(0, message);

      // Do not fall back from an unauthorized or denied request to browser to evade denial
      const fallbackAllowed = errorCode !== ApiErrorCode.AUTH_ERROR;

      return {
        success: false,
        endpointId: endpoint.id,
        error: {
          code: errorCode,
          message: `Network or runtime error during API call: ${message}`,
        },
        fallbackToBrowser: fallbackAllowed,
        fallbackUrl: fallbackAllowed ? endpoint.browserFallbackUrl : undefined,
        durationMs,
      };
    }
  }
}
