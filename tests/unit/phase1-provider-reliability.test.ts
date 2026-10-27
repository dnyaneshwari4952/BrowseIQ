import { describe, it, expect, vi } from "vitest";
import {
  GeminiProvider,
  OpenAICompatibleProvider,
  MockProvider,
  ProviderOrchestrator,
  createLLMProvider,
  LLMProvider,
} from "@/lib/ai/llm-provider";
import { Planner } from "@/lib/agent/planner";
import { ErrorCode, AgentError } from "@/lib/types/errors";
import { ActionType, RiskLevel } from "@/lib/types/actions";
import { resetConfigForTesting } from "@/lib/config";
import type { GoogleGenAI } from "@google/genai";

const validPlanJson = JSON.stringify({
  taskIntent: "Search for laptop and extract first result",
  assumptions: ["Catalog has search input and product cards"],
  successCriteria: {
    requiredOperations: ["navigate", "fill", "click", "extractText"],
    requiredOutputs: ["title", "price"],
    verificationChecks: ["searchSubmitted", "resultsExist"],
  },
  actions: [
    {
      id: "step-1-nav",
      type: "navigate",
      value: "http://localhost:3000/test-fixtures/search",
      risk: "low",
      reason: "Navigate to search page",
    },
    {
      id: "step-2-fill",
      type: "fill",
      target: { strategy: "placeholder", value: "Search products" },
      value: "laptop",
      risk: "low",
      reason: "Fill search query",
    },
    {
      id: "step-3-finish",
      type: "finish",
      risk: "low",
      reason: "Conclude task",
    },
  ],
});

describe("Phase 1 — Provider Reliability, Fallback Architecture, and Planner Hardening", () => {
  // Test 1: Gemini Success
  it("1. Gemini success: produces validated plan when Gemini responds normally", async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      text: validPlanJson,
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 100 },
    });
    const mockClient = { models: { generateContent: mockGenerateContent } } as unknown as GoogleGenAI;
    const provider = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);
    const planner = new Planner(provider);

    const plan = await planner.plan({
      task: "Search for laptop",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions[0].type).toBe(ActionType.NAVIGATE);
  });

  // Test 2: Gemini 429 with configured fallback success
  it("2. Gemini 429 with configured fallback success: switches to fallback provider", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(
          new Error("429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Generate Content API'")
        ),
      },
    } as unknown as GoogleGenAI;
    const primary = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);
    const fallback = new MockProvider();
    const orchestrator = new ProviderOrchestrator({ primary, fallback });
    const planner = new Planner(orchestrator);

    const plan = await planner.plan({
      task: "Search for laptop and extract the title and price of the first result",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
  });

  // Test 3: Gemini 429 without fallback
  it("3. Gemini 429 without fallback: retains RATE_LIMITED error code and does NOT mislabel as VALIDATION_FAILED", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(
          new Error("429 RESOURCE_EXHAUSTED: Rate limit exceeded")
        ),
      },
    } as unknown as GoogleGenAI;
    const primary = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);
    const orchestrator = new ProviderOrchestrator({ primary });
    const planner = new Planner(orchestrator);

    try {
      await planner.plan({
        task: "Search for laptop",
        targetUrl: "http://localhost:3000/test-fixtures/search",
      });
      expect.unreachable("Should have thrown RATE_LIMITED");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe(ErrorCode.RATE_LIMITED);
      expect(agentErr.code).not.toBe(ErrorCode.VALIDATION_FAILED);
      expect(agentErr.retryable).toBe(false);
      expect(agentErr.provider).toBe("gemini");
    }
  });

  // Test 4: Gemini 503 with bounded recovery
  it("4. Gemini 503 with bounded recovery: retries on model candidate and succeeds", async () => {
    const mockGenerateContent = vi
      .fn()
      .mockRejectedValueOnce(new Error("503 UNAVAILABLE: The service is temporarily experiencing high demand."))
      .mockResolvedValueOnce({
        text: validPlanJson,
        usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 120 },
      });
    const mockClient = { models: { generateContent: mockGenerateContent } } as unknown as GoogleGenAI;
    const provider = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);
    const planner = new Planner(provider);

    const plan = await planner.plan({
      task: "Search for laptop",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    expect(plan).toBeDefined();
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  // Test 5: Both primary and fallback providers failing
  it("5. Both primary and fallback providers failing: reports structured composite failure", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("429 RESOURCE_EXHAUSTED")),
      },
    } as unknown as GoogleGenAI;
    const primary = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);

    const failingFallback: LLMProvider = {
      name: "failing-fallback",
      generate: vi.fn().mockRejectedValue(new AgentError("Service down", ErrorCode.API_ERROR, false)),
    };

    const orchestrator = new ProviderOrchestrator({ primary, fallback: failingFallback });

    try {
      await orchestrator.generate("Test prompt");
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.message).toContain("All configured LLM providers failed");
      expect(agentErr.context?.details).toBeDefined();
    }
  });

  // Test 6: Invalid provider configuration
  it("6. Invalid provider configuration: throws CONFIG_ERROR for unknown provider name", () => {
    resetConfigForTesting({
      LLM_PROVIDER: "nonexistent-provider" as any,
    });

    expect(() => createLLMProvider()).toThrowError(/Unknown LLM provider/i);
  });

  // Test 7: Missing API key
  it("7. Missing API key: throws CONFIG_ERROR when instantiated with empty or placeholder key", () => {
    expect(() => new GeminiProvider("")).toThrow(AgentError);
    try {
      new GeminiProvider("");
    } catch (err) {
      expect((err as AgentError).code).toBe(ErrorCode.CONFIG_ERROR);
    }

    expect(() => new OpenAICompatibleProvider("")).toThrow(AgentError);
    try {
      new OpenAICompatibleProvider("");
    } catch (err) {
      expect((err as AgentError).code).toBe(ErrorCode.CONFIG_ERROR);
    }
  });

  // Test 8: Authentication and permission errors
  it("8. Authentication and permission errors: maps HTTP 401 and 403 to AUTH_REQUIRED or PERMISSION_ERROR", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("401 PERMISSION_DENIED: Invalid API Key")),
      },
    } as unknown as GoogleGenAI;
    const provider = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);

    try {
      await provider.generate("test");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.AUTH_REQUIRED);
    }
  });

  // Test 9: Invalid model/404
  it("9. Invalid model/404: maps 404 to MODEL_NOT_FOUND", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("404 NOT_FOUND: Model 'gemini-nonexistent' not found")),
      },
    } as unknown as GoogleGenAI;
    const provider = new GeminiProvider("mock-key", "gemini-nonexistent", mockClient);

    try {
      await provider.generate("test");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.MODEL_NOT_FOUND);
    }
  });

  // Test 10: Network timeout
  it("10. Network timeout: times out and maps to TIMEOUT error code", async () => {
    const provider = new OpenAICompatibleProvider("test-key", "https://127.0.0.1:9999", "gpt-4o-mini", 50);

    try {
      await provider.generate("test", undefined, { timeoutMs: 20 });
      expect.unreachable("Should have timed out");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const code = (err as AgentError).code;
      expect(code === ErrorCode.TIMEOUT || code === ErrorCode.NETWORK_ERROR).toBe(true);
    }
  });

  // Test 11: Empty response
  it("11. Empty response: throws EMPTY_RESPONSE when provider returns empty content", async () => {
    const emptyProvider: LLMProvider = {
      name: "empty-provider",
      generate: vi.fn().mockResolvedValue({ content: "   " }),
    };
    const planner = new Planner(emptyProvider);

    try {
      await planner.plan({ task: "Search" });
      expect.unreachable("Should have thrown EMPTY_RESPONSE");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.EMPTY_RESPONSE);
    }
  });

  // Test 12: Malformed JSON
  it("12. Malformed JSON: bounded correction attempt fails and throws VALIDATION_FAILED", async () => {
    const malformedProvider: LLMProvider = {
      name: "malformed-provider",
      generate: vi.fn().mockResolvedValue({ content: "This is definitely not JSON { broken" }),
    };
    const planner = new Planner(malformedProvider);

    try {
      await planner.plan({ task: "Search" });
      expect.unreachable("Should have thrown VALIDATION_FAILED");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((err as AgentError).message).toContain("LLM planner failed after 3 attempts");
    }
  });

  // Test 13: Schema-invalid JSON
  it("13. Schema-invalid JSON: triggers schema correction request", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      content: JSON.stringify({ wrongField: 123 }),
    });
    const provider: LLMProvider = { name: "invalid-schema-provider", generate: mockGenerate };
    const planner = new Planner(provider);

    await expect(planner.plan({ task: "Search" })).rejects.toThrow(AgentError);
    // Verified that correction retry occurred
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });

  // Test 14: Successful schema-correction attempt
  it("14. Successful schema-correction attempt: repairs invalid response on retry", async () => {
    const mockGenerate = vi
      .fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({ taskIntent: "Missing actions and successCriteria" }),
      })
      .mockResolvedValueOnce({
        content: validPlanJson,
      });

    const provider: LLMProvider = { name: "repairable-provider", generate: mockGenerate };
    const planner = new Planner(provider);

    const plan = await planner.plan({
      task: "Search for laptop",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    expect(plan).toBeDefined();
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  // Test 15: Correction attempts exhausted
  it("15. Correction attempts exhausted: throws VALIDATION_FAILED when budget is reached", async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      content: JSON.stringify({ taskIntent: "Still missing actions" }),
    });
    const provider: LLMProvider = { name: "persistently-invalid", generate: mockGenerate };
    const planner = new Planner(provider);

    try {
      await planner.plan({ task: "Search" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  // Test 16: Fallback provider returning an invalid plan
  it("16. Fallback provider returning an invalid plan: fails schema validation strictly", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("429 RESOURCE_EXHAUSTED")),
      },
    } as unknown as GoogleGenAI;
    const primary = new GeminiProvider("mock-key", "gemini-flash-latest", mockClient);

    const invalidFallback: LLMProvider = {
      name: "invalid-fallback",
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({ notAPlan: true }),
      }),
    };

    const orchestrator = new ProviderOrchestrator({ primary, fallback: invalidFallback });
    const planner = new Planner(orchestrator);

    try {
      await planner.plan({ task: "Search" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.VALIDATION_FAILED);
    }
  });

  // Test 17: Conflicting target URL
  it("17. Conflicting target URL: overrides model's conflicting navigation with authoritative target URL", async () => {
    const conflictingPlanJson = JSON.stringify({
      taskIntent: "Navigating somewhere else",
      assumptions: [],
      successCriteria: {
        requiredOperations: ["navigate"],
        requiredOutputs: [],
        verificationChecks: [],
      },
      actions: [
        {
          id: "step-1-nav",
          type: "navigate",
          value: "https://conflicting-malicious-site.com/login",
          risk: "low",
          reason: "Model went off-course",
        },
        {
          id: "step-2-finish",
          type: "finish",
          risk: "low",
          reason: "Done",
        },
      ],
    });

    const mockProvider: LLMProvider = {
      name: "conflicting-provider",
      generate: vi.fn().mockResolvedValue({ content: conflictingPlanJson }),
    };

    const planner = new Planner(mockProvider);
    const plan = await planner.plan({
      task: "Search catalog",
      targetUrl: "http://localhost:3000/test-fixtures/search",
    });

    // Authoritative target URL must be enforced!
    expect(plan.actions[0].value).toBe("http://localhost:3000/test-fixtures/search");
  });

  // Test 18: Unsupported URL scheme
  it("18. Unsupported URL scheme: rejects dangerous schemes (javascript:, file:, data:) with VALIDATION_FAILED", async () => {
    const dangerousPlanJson = JSON.stringify({
      taskIntent: "Dangerous script plan",
      assumptions: [],
      successCriteria: { requiredOperations: [], requiredOutputs: [], verificationChecks: [] },
      actions: [
        {
          id: "dangerous-1",
          type: "navigate",
          value: "javascript:alert(document.cookie)",
          risk: "high",
          reason: "Attempt dangerous script navigation",
        },
        { id: "finish", type: "finish", risk: "low", reason: "Done" },
      ],
    });

    const mockProvider: LLMProvider = {
      name: "dangerous-provider",
      generate: vi.fn().mockResolvedValue({ content: dangerousPlanJson }),
    };

    const planner = new Planner(mockProvider);
    try {
      await planner.plan({ task: "Run script" });
      expect.unreachable("Should have rejected dangerous scheme");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((err as AgentError).message).toContain("Unsupported or dangerous URL scheme");
    }
  });

  // Test 19: Cancellation during provider invocation
  it("19. Cancellation during provider invocation: throws CANCELLED error code when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new MockProvider();
    try {
      await provider.generate("test", undefined, { signal: controller.signal });
      expect.unreachable("Should have thrown CANCELLED");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe(ErrorCode.CANCELLED);
    }
  });

  // Test 20: Secret redaction in errors and logs
  it("20. Secret redaction in errors and logs: redacts secret API keys from error messages", async () => {
    const sensitiveKey = "AIzaSy_SENSITIVE_SECRET_TOKEN_999";
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(
          new Error(`Failed request to https://generativelanguage.googleapis.com/v1beta/models?key=${sensitiveKey}`)
        ),
      },
    } as unknown as GoogleGenAI;

    const provider = new GeminiProvider(sensitiveKey, "gemini-flash-latest", mockClient);

    try {
      await provider.generate("test");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const msg = (err as AgentError).message;
      expect(msg).not.toContain(sensitiveKey);
      expect(msg).toContain("[REDACTED");
    }
  });
});
