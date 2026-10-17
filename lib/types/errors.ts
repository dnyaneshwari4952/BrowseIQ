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
  CAPTCHA_DETECTED: "CAPTCHA_DETECTED",
  POPUP_BLOCKED: "POPUP_BLOCKED",
  DOWNLOAD_FAILED: "DOWNLOAD_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  API_ERROR: "API_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PAGE_CHANGED: "PAGE_CHANGED",
  STALE_TARGET: "STALE_TARGET",
  CANCELLED: "CANCELLED",
  CONFIG_ERROR: "CONFIG_ERROR",
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
  public readonly timestamp: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    recoverable = true,
    context?: ErrorContext
  ) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.recoverable = recoverable;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}
