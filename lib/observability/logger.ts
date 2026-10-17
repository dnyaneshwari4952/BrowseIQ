/**
 * Structured Logger with sensitive data masking and level filtering
 * Section 24: Observability & Security Compliance
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = new Set([
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "creditcard",
  "cvv",
  "ssn",
  "credentials",
  "passcode",
]);

/**
 * Recursively redacts sensitive fields
 */
export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data === "string") {
    // Basic heuristics for bearer tokens or passwords in strings
    return data.replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{8,}/gi, "$1[REDACTED]");
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }
  if (typeof data === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeLogData(value);
      }
    }
    return sanitized;
  }
  return data;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

export class Logger {
  private minLevel: LogLevel;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 500;

  constructor(minLevel: LogLevel = "info") {
    this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[this.minLevel];
  }

  private format(entry: LogEntry): string {
    const ctx = entry.context ? ` | ${JSON.stringify(entry.context)}` : "";
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${ctx}`;
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: context ? (sanitizeLogData(context) as Record<string, unknown>) : undefined,
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    const formatted = this.format(entry);
    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.log(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
    }
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.write("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.write("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.write("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.write("error", message, context);
  }

  getRecentLogs(): LogEntry[] {
    return [...this.logBuffer];
  }

  clear() {
    this.logBuffer = [];
  }
}

export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || "info"
);
