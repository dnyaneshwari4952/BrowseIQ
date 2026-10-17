import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, resetConfigForTesting } from "@/lib/config";

describe("Configuration Module", () => {
  beforeEach(() => {
    resetConfigForTesting();
  });

  it("loads default configuration with valid types", () => {
    const config = getConfig();
    expect(config).toBeDefined();
    expect(config.LLM_PROVIDER).toBe("openai");
    expect(config.BROWSER_HEADLESS).toBe(true);
    expect(config.DEFAULT_ACTION_TIMEOUT).toBe(15000);
    expect(config.MAX_ACTION_RETRIES).toBe(3);
    expect(config.MAX_REPLANS).toBe(3);
  });

  it("allows setting test overrides", () => {
    const config = resetConfigForTesting({
      BROWSER_HEADLESS: false,
      DEFAULT_ACTION_TIMEOUT: 5000,
      LOG_LEVEL: "debug",
    });

    expect(config.BROWSER_HEADLESS).toBe(false);
    expect(config.DEFAULT_ACTION_TIMEOUT).toBe(5000);
    expect(config.LOG_LEVEL).toBe("debug");
  });
});
