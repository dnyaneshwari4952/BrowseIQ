/**
 * Error classifications and Agent Error Hierarchy
 * Strictly aligned with requirement Section 13 (Recovery Engine)
 */

export const ErrorCode = {
  ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
  ELEMENT_AMBIGUOUS: "ELEMENT_AMBIGUOUS",
  ELEMENT_NOT_VISIBLE: "ELEMENT_NOT_VISIBLE",
  ELEMENT_DISABLED: "ELEMENT_DISABLED",
  NAVIGATION_FAILED: "NAVIGATION_FAILED",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  PERMISSION_ERROR: "PERMISSION_ERROR",
  CAPTCHA_DETECTED: "CAPTCHA_DETECTED",
  POPUP_BLOCKED: "POPUP_BLOCKED",
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  POSTCONDITION_FAILED: "POSTCONDITION_FAILED",
  UNSUPPORTED_ACTION: "UNSUPPORTED_ACTION",
  PLANNING_FAILED: "PLANNING_FAILED",
  API_ERROR: "API_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
  TEMPORARY_UNAVAILABLE: "TEMPORARY_UNAVAILABLE",
  INVALID_REQUEST: "INVALID_REQUEST",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  UNKNOWN_PROVIDER_ERROR: "UNKNOWN_PROVIDER_ERROR",
  PAGE_CHANGED: "PAGE_CHANGED",
  STALE_TARGET: "STALE_TARGET",
  CANCELLED: "CANCELLED",
  SECURITY_POLICY_VIOLATION: "SECURITY_POLICY_VIOLATION",
  SSRF_BLOCKED: "SSRF_BLOCKED",
  CONFIG_ERROR: "CONFIG_ERROR",
  QUEUE_FULL: "QUEUE_FULL",
  BROWSER_CRASH: "BROWSER_CRASH",
  BROWSER_LAUNCH_FAILED: "BROWSER_LAUNCH_FAILED",
  FATAL_ERROR: "FATAL_ERROR",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorContext {
  actionId?: string;
  action?: unknown;
  target?: unknown;
  url?: string;
  selector?: string;
  attempt?: number;
  matchCount?: number;
  expected?: unknown;
  actual?: unknown;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export class AgentError extends Error {
  public readonly code: ErrorCode;
  public readonly recoverable: boolean;
  public readonly context?: ErrorContext;
  public readonly provider?: string;
  public readonly status?: number;
  public readonly timestamp: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    recoverable = true,
    context?: ErrorContext,
    provider?: string,
    status?: number
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
    this.provider = provider;
    this.status = status;
    this.timestamp = new Date().toISOString();
  }

  /** Alias for recoverable adhering to retryable error conventions */
  get retryable(): boolean {
    return this.recoverable;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      retryable: this.retryable,
      provider: this.provider,
      status: this.status,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}
