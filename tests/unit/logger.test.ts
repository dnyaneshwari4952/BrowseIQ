import { describe, it, expect } from "vitest";
import { Logger, sanitizeLogData } from "@/lib/observability/logger";

describe("Logger & Sanitization", () => {
  it("redacts sensitive fields like passwords, tokens, and api keys", () => {
    const sensitiveData = {
      user: "john_doe",
      password: "SuperSecretPassword123!",
      apiKey: "sk-proj-1234567890abcdef",
      token: "jwt.token.value",
      metadata: {
        cookie: "session_id=abcdef12345",
        normalField: "visibleValue",
      },
    };

    const sanitized = sanitizeLogData(sensitiveData) as Record<string, unknown>;

    expect(sanitized.user).toBe("john_doe");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    const meta = sanitized.metadata as Record<string, unknown>;
    expect(meta.cookie).toBe("[REDACTED]");
    expect(meta.normalField).toBe("visibleValue");
  });

  it("buffers log messages and formats them properly", () => {
    const logger = new Logger("debug");
    logger.info("Test message 1", { info: "val" });
    logger.warn("Test warning");
    logger.error("Test error");

    const recentLogs = logger.getRecentLogs();
    expect(recentLogs.length).toBe(3);
    expect(recentLogs[0].level).toBe("info");
    expect(recentLogs[0].message).toBe("Test message 1");
    expect(recentLogs[1].level).toBe("warn");
    expect(recentLogs[2].level).toBe("error");
  });
});
