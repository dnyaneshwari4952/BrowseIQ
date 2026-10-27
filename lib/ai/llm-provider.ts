import { GoogleGenAI } from "@google/genai";
import { getConfig } from "../config";
import { SemanticDecomposer } from "../agent/semantic-decomposer";
import { ErrorCode, AgentError } from "../types/errors";
import { logger } from "../observability/logger";
import { EntityConstraintResolver } from "../planning/entity-constraint-resolver";
import { DynamicTaskPlanner } from "../planning/dynamic-task-planner";

export interface LLMResponse {
  content: string;
  provider?: string;
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LLMGenerateOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LLMProvider {
  name: string;
  generate(prompt: string, systemPrompt?: string, options?: LLMGenerateOptions): Promise<LLMResponse>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  name = "openai-compatible";
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private defaultTimeoutMs: number;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1", model = "gpt-4o-mini", timeoutMs = 30000) {
    if (!apiKey || apiKey === "your_api_key_here") {
      throw new AgentError(
        "Missing API key for OpenAI-compatible provider. Please configure GROK_API_KEY or LLM_API_KEY.",
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "openai-compatible"
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.defaultTimeoutMs = timeoutMs;
  }

  async generate(prompt: string, systemPrompt?: string, options?: LLMGenerateOptions): Promise<LLMResponse> {
    if (options?.signal?.aborted) {
      throw new AgentError("Request was cancelled before execution.", ErrorCode.CANCELLED, false, undefined, this.name);
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const onParentAbort = () => controller.abort();
    if (options?.signal) {
      options.signal.addEventListener("abort", onParentAbort, { once: true });
    }

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (options?.signal?.aborted) {
        throw new AgentError("OpenAI-compatible request was cancelled", ErrorCode.CANCELLED, false, undefined, this.name);
      }
      if (controller.signal.aborted) {
        throw new AgentError(
          `OpenAI-compatible request timed out after ${timeoutMs}ms`,
          ErrorCode.TIMEOUT,
          true,
          undefined,
          this.name
        );
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new AgentError(
        `Network error connecting to OpenAI-compatible provider: ${this.sanitizeErrorMessage(rawMsg)}`,
        ErrorCode.NETWORK_ERROR,
        true,
        undefined,
        this.name
      );
    } finally {
      clearTimeout(timeoutHandle);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onParentAbort);
      }
    }

    if (!res.ok) {
      const rawBody = await res.text().catch(() => "");
      const boundedBody = rawBody.slice(0, 500);
      const sanitizedBody = this.sanitizeErrorMessage(boundedBody);

      let parsedMessage = sanitizedBody;
      try {
        const parsed = JSON.parse(boundedBody);
        if (parsed.error?.message) {
          parsedMessage = this.sanitizeErrorMessage(String(parsed.error.message));
        }
      } catch {
        // use sanitizedBody
      }

      const status = res.status;
      if (status === 429) {
        throw new AgentError(
          `OpenAI-compatible rate limit or quota exceeded: ${parsedMessage}`,
          ErrorCode.RATE_LIMITED,
          false,
          { status: 429, details: { raw: parsedMessage } },
          this.name,
          429
        );
      }
      if (status === 503) {
        throw new AgentError(
          `OpenAI-compatible service temporarily unavailable: ${parsedMessage}`,
          ErrorCode.TEMPORARY_UNAVAILABLE,
          true,
          { status: 503, details: { raw: parsedMessage } },
          this.name,
          503
        );
      }
      if (status === 401) {
        throw new AgentError(
          `OpenAI-compatible authentication failed: ${parsedMessage}`,
          ErrorCode.AUTH_REQUIRED,
          false,
          { status: 401, details: { raw: parsedMessage } },
          this.name,
          401
        );
      }
      if (status === 403) {
        throw new AgentError(
          `OpenAI-compatible permission denied: ${parsedMessage}`,
          ErrorCode.PERMISSION_ERROR,
          false,
          { status: 403, details: { raw: parsedMessage } },
          this.name,
          403
        );
      }
      if (status === 404) {
        throw new AgentError(
          `OpenAI-compatible model '${this.model}' or endpoint not found: ${parsedMessage}`,
          ErrorCode.MODEL_NOT_FOUND,
          false,
          { status: 404, details: { raw: parsedMessage } },
          this.name,
          404
        );
      }
      if (status === 400) {
        throw new AgentError(
          `OpenAI-compatible invalid request: ${parsedMessage}`,
          ErrorCode.INVALID_REQUEST,
          false,
          { status: 400, details: { raw: parsedMessage } },
          this.name,
          400
        );
      }

      throw new AgentError(
        `OpenAI-compatible request failed (${status}): ${parsedMessage}`,
        ErrorCode.API_ERROR,
        false,
        { status, details: { raw: parsedMessage } },
        this.name,
        status
      );
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new AgentError(
        "Invalid JSON response received from OpenAI-compatible provider",
        ErrorCode.INVALID_RESPONSE,
        false,
        undefined,
        this.name,
        res.status
      );
    }

    if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
      throw new AgentError(
        "OpenAI-compatible provider returned no choices in response",
        ErrorCode.INVALID_RESPONSE,
        false,
        undefined,
        this.name,
        res.status
      );
    }

    const content = data.choices[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AgentError(
        "OpenAI-compatible provider returned empty content",
        ErrorCode.EMPTY_RESPONSE,
        true,
        undefined,
        this.name,
        res.status
      );
    }

    const usage =
      typeof data.usage?.prompt_tokens === "number" && typeof data.usage?.completion_tokens === "number"
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined;

    return {
      content,
      provider: this.name,
      model: this.model,
      usage,
    };
  }

  private sanitizeErrorMessage(message: string): string {
    let clean = message;
    if (this.apiKey) {
      clean = clean.replaceAll(this.apiKey, "[REDACTED_API_KEY]");
    }
    clean = clean.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{10,}/gi, "Bearer [REDACTED]");
    clean = clean.replace(/key=[a-zA-Z0-9_\-\.]{10,}/gi, "key=[REDACTED]");
    return clean;
  }
}

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private apiKey: string;
  private model: string;
  private client: GoogleGenAI;
  private defaultTimeoutMs: number;

  constructor(apiKey: string, model = "gemini-flash-latest", customClient?: GoogleGenAI, timeoutMs = 30000) {
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      throw new AgentError(
        "Missing Gemini API key. Please configure GEMINI_API_KEY in your server-side environment (.env.local).",
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "gemini"
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.defaultTimeoutMs = timeoutMs;
    this.client = customClient || new GoogleGenAI({ apiKey });
  }

  async generate(prompt: string, systemPrompt?: string, options?: LLMGenerateOptions): Promise<LLMResponse> {
    if (options?.signal?.aborted) {
      throw new AgentError("Gemini request was cancelled before execution.", ErrorCode.CANCELLED, false, undefined, this.name);
    }

    const startTime = Date.now();
    // Only attempt gemini-flash-lite-latest on 503 high demand when configured with gemini-flash-latest
    const modelsToAttempt = [this.model];
    if (this.model === "gemini-flash-latest") {
      modelsToAttempt.push("gemini-flash-lite-latest");
    }

    let lastError: unknown = null;
    let selectedModel = this.model;

    for (let i = 0; i < modelsToAttempt.length; i++) {
      const currentModel = modelsToAttempt[i];
      selectedModel = currentModel;

      try {
        const response = await this.client.models.generateContent({
          model: currentModel,
          contents: prompt,
          config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        });

        const rawContent = response.text || "";
        if (!rawContent.trim()) {
          throw new AgentError(
            "Gemini API returned an empty response.",
            ErrorCode.EMPTY_RESPONSE,
            true,
            undefined,
            this.name
          );
        }

        const durationMs = Date.now() - startTime;
        logger.info(`Gemini API call completed in ${durationMs}ms using model ${currentModel}`);

        return {
          content: rawContent,
          provider: this.name,
          model: currentModel,
          usage: response.usageMetadata
            ? {
                promptTokens: response.usageMetadata.promptTokenCount ?? 0,
                completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
              }
            : undefined,
        };
      } catch (err: unknown) {
        lastError = err;
        const rawError = err instanceof Error ? err.message : String(err);
        const errStatus = (err as any)?.status || (err as any)?.code;

        const is503 =
          errStatus === 503 ||
          errStatus === "UNAVAILABLE" ||
          rawError.includes("503") ||
          rawError.includes("high demand") ||
          rawError.includes("UNAVAILABLE");

        // CRITICAL: ONLY retry on 503 high demand. NEVER retry on 429 quota exhaustion!
        if (is503 && i < modelsToAttempt.length - 1) {
          logger.warn(
            `Model ${currentModel} returned 503 high demand. Trying fallback model ${modelsToAttempt[i + 1]}...`
          );
          await new Promise((r) => setTimeout(r, 600));
          continue;
        }

        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const rawError = lastError instanceof Error ? lastError.message : String(lastError);
    const sanitizedError = this.sanitizeErrorMessage(rawError);

    logger.error(`Gemini API call failed after ${durationMs}ms: ${sanitizedError}`);

    const statusVal = (lastError as any)?.status || (lastError as any)?.code;

    // Check cancellation
    if (options?.signal?.aborted || (lastError as any)?.name === "AbortError" && options?.signal?.aborted) {
      throw new AgentError("Gemini request was cancelled", ErrorCode.CANCELLED, false, undefined, this.name);
    }

    // 1. HTTP 429 / Quota Exhaustion
    if (
      statusVal === 429 ||
      statusVal === "RESOURCE_EXHAUSTED" ||
      sanitizedError.includes("429") ||
      sanitizedError.includes("quota") ||
      sanitizedError.includes("RESOURCE_EXHAUSTED")
    ) {
      throw new AgentError(
        `Gemini API rate limit or quota exceeded. Please check your Google AI Studio plan. Details: ${sanitizedError}`,
        ErrorCode.RATE_LIMITED,
        false,
        { status: 429, details: { raw: sanitizedError } },
        this.name,
        429
      );
    }

    // 2. HTTP 503 / Service Unavailable
    if (
      statusVal === 503 ||
      statusVal === "UNAVAILABLE" ||
      sanitizedError.includes("503") ||
      sanitizedError.includes("high demand") ||
      sanitizedError.includes("UNAVAILABLE")
    ) {
      throw new AgentError(
        `Gemini service is temporarily experiencing high demand. Details: ${sanitizedError}`,
        ErrorCode.TEMPORARY_UNAVAILABLE,
        true,
        { status: 503, details: { raw: sanitizedError } },
        this.name,
        503
      );
    }

    // 3. HTTP 404 / Model Not Found
    if (
      statusVal === 404 ||
      statusVal === "NOT_FOUND" ||
      sanitizedError.includes("404") ||
      sanitizedError.includes("not found")
    ) {
      throw new AgentError(
        `Gemini model '${selectedModel}' is not available or not supported by this API key. Please check GEMINI_MODEL. Details: ${sanitizedError}`,
        ErrorCode.MODEL_NOT_FOUND,
        false,
        { status: 404, details: { raw: sanitizedError } },
        this.name,
        404
      );
    }

    // 4. HTTP 401/403 / Auth Required
    if (
      statusVal === 401 ||
      statusVal === 403 ||
      statusVal === "PERMISSION_DENIED" ||
      statusVal === "UNAUTHENTICATED" ||
      sanitizedError.includes("API key") ||
      sanitizedError.includes("unauthorized") ||
      sanitizedError.includes("PERMISSION_DENIED")
    ) {
      throw new AgentError(
        `Gemini authentication failed. Please verify your GEMINI_API_KEY. Details: ${sanitizedError}`,
        ErrorCode.AUTH_REQUIRED,
        false,
        { status: statusVal === 403 ? 403 : 401, details: { raw: sanitizedError } },
        this.name,
        statusVal === 403 ? 403 : 401
      );
    }

    // 5. HTTP 400 / Invalid Request
    if (
      statusVal === 400 ||
      statusVal === "INVALID_ARGUMENT" ||
      sanitizedError.includes("400") ||
      sanitizedError.includes("INVALID_ARGUMENT")
    ) {
      throw new AgentError(
        `Gemini invalid request: ${sanitizedError}`,
        ErrorCode.INVALID_REQUEST,
        false,
        { status: 400, details: { raw: sanitizedError } },
        this.name,
        400
      );
    }

    // 6. Timeout / Network
    if (sanitizedError.includes("timeout") || sanitizedError.includes("timed out")) {
      throw new AgentError(`Gemini request timed out: ${sanitizedError}`, ErrorCode.TIMEOUT, true, undefined, this.name);
    }
    if (sanitizedError.includes("fetch failed") || sanitizedError.includes("ECONNREFUSED") || sanitizedError.includes("ENOTFOUND")) {
      throw new AgentError(`Gemini network connection failed: ${sanitizedError}`, ErrorCode.NETWORK_ERROR, true, undefined, this.name);
    }

    if (lastError instanceof AgentError) {
      throw lastError;
    }

    throw new AgentError(
      `Gemini provider error: ${sanitizedError}`,
      ErrorCode.API_ERROR,
      false,
      { details: { raw: sanitizedError } },
      this.name
    );
  }

  private sanitizeErrorMessage(message: string): string {
    let clean = message;
    if (this.apiKey) {
      clean = clean.replaceAll(this.apiKey, "[REDACTED_GEMINI_API_KEY]");
    }
    clean = clean.replace(/key=[a-zA-Z0-9_\-\.]{10,}/gi, "key=[REDACTED]");
    return clean;
  }
}

export class MockProvider implements LLMProvider {
  name = "mock";

  async generate(prompt: string, systemPrompt?: string, options?: LLMGenerateOptions): Promise<LLMResponse> {
    if (options?.signal?.aborted) {
      throw new AgentError("Mock request was cancelled", ErrorCode.CANCELLED, false, undefined, this.name);
    }

    // Extract user task from prompt envelope
    const taskMatch = prompt.match(/<authorized_user_task>([\s\S]*?)<\/authorized_user_task>/i) ||
      prompt.match(/=== USER TASK[^=]*===([\s\S]*?)=== END USER TASK ===/i);
    let rawTask = taskMatch ? taskMatch[1].trim() : prompt;
    if (rawTask.startsWith("Task:")) {
      const firstLine = rawTask.split("\n")[0];
      rawTask = firstLine.replace(/^Task:\s*/i, "").trim();
    }
    const lower = rawTask.toLowerCase();

    // Check if prompt is a Replan request with execution context
    const isReplan = prompt.includes("FAILED ACTION") || prompt.includes("FAILURE DIAGNOSTIC") || prompt.includes("Dynamic Replanning Engine");
    const obsMatch = prompt.match(/<untrusted_page_content>([\s\S]*?)<\/untrusted_page_content>/i);
    const obsText = obsMatch ? obsMatch[1] : "";

    // 1. REPLAN GENERATION
    if (isReplan) {
      const lowerObs = obsText.toLowerCase();

      // Check if candidate controls are ambiguous (Phase 3 Mock Integrity)
      if (lowerObs.includes("ambiguous") || (lowerObs.match(/submit/g) || []).length > 2) {
        return {
          content: JSON.stringify({
            taskIntent: `Ambiguous interactive controls detected during replan: ${rawTask}`,
            assumptions: ["Multiple competing identical controls found on page"],
            successCriteria: {
              requiredOperations: ["navigate"],
              requiredOutputs: [],
              verificationChecks: ["clarificationRequired"],
            },
            actions: [
              {
                id: `clarify-replan-${Date.now()}`,
                type: "finish",
                risk: "low",
                reason: "Multiple ambiguous candidate controls found on page. Clarification required.",
              },
            ],
          }),
        };
      }

      // Check if browser is at about:blank or missing prerequisite
      if (lowerObs.includes("about:blank") || prompt.includes("about:blank") || prompt.includes("precondition")) {
        const resolved = EntityConstraintResolver.resolve({ rawInstruction: rawTask });
        if (resolved.targetUrl) {
          return {
            content: JSON.stringify({
              taskIntent: `Prerequisite repair: Navigate to target website ${resolved.targetUrl}`,
              assumptions: ["Injecting missing navigation before executing page controls"],
              successCriteria: {
                requiredOperations: ["navigate"],
                requiredOutputs: [],
                verificationChecks: [],
              },
              actions: [
                {
                  id: `repaired-nav-${Date.now()}`,
                  type: "navigate",
                  value: resolved.targetUrl,
                  risk: "low",
                  reason: `Navigate to target platform: ${resolved.targetUrl}`,
                },
                {
                  id: `repaired-wait-${Date.now()}`,
                  type: "wait",
                  value: 1200,
                  risk: "low",
                  reason: "Wait for target platform to settle",
                },
                {
                  id: `finish-replan-${Date.now()}`,
                  type: "finish",
                  risk: "low",
                  reason: "Conclude replan workflow",
                },
              ],
            }),
          };
        }
      }

      // Check if button text changed in observation (e.g. "Find Products" instead of "Search")
      let targetButton = "Search";
      if (lowerObs.includes("find products")) targetButton = "Find Products";
      else if (lowerObs.includes("send message")) targetButton = "Send Message";
      else if (lowerObs.includes("submit contact form")) targetButton = "Submit Contact Form";
      else if (lowerObs.includes("submit")) targetButton = "Submit";

      return {
        content: JSON.stringify({
          taskIntent: `Replanned action adapting to live observation: ${rawTask}`,
          assumptions: ["Adapted target from live page observation"],
          successCriteria: {
            requiredOperations: ["click", "verify"],
            requiredOutputs: [],
            verificationChecks: ["repairedActionCompleted"],
          },
          actions: [
            {
              id: `repaired-action-${Date.now()}`,
              type: "click",
              target: {
                strategy: "text",
                value: targetButton,
                role: "button",
                description: `Live adapted button: ${targetButton}`,
              },
              risk: "low",
              reason: `Click '${targetButton}' button adapted from live DOM observation`,
              retries: { maxRetries: 2, backoffMs: 500 },
            },
            {
              id: `finish-replan-${Date.now()}`,
              type: "finish",
              risk: "low",
              reason: "Conclude replanned workflow",
            },
          ],
        }),
      };
    }

    // 2. TARGET URL DETERMINATION (Phase 3: Dedicated target field / authorized envelope only)
    let targetUrl: string | undefined;
    const contextUrlMatch = prompt.match(/Target URL:\s*(https?:\/\/[^\s\r\n\)\>]+)/i) ||
      prompt.match(/<execution_context>[\s\S]*?Target URL:\s*(https?:\/\/[^\s\r\n\)\>]+)/i);
    const taskUrlMatch = rawTask.match(/(https?:\/\/[^\s\)\>]+)/i);

    if (contextUrlMatch) {
      targetUrl = contextUrlMatch[1];
    } else if (taskUrlMatch) {
      targetUrl = taskUrlMatch[1];
    } else {
      const resolved = EntityConstraintResolver.resolve({ rawInstruction: rawTask });
      targetUrl = resolved.targetUrl;
    }

    // 3. GENERALIZED TASK RESOLUTION & DYNAMIC PLAN SYNTHESIS (Phase 2)
    const spec = EntityConstraintResolver.resolve({
      rawInstruction: rawTask,
      targetUrl,
      observation: null,
    });

    const plan = DynamicTaskPlanner.plan({
      spec,
      targetUrl: spec.targetUrl || targetUrl,
      observation: null,
    });

    return {
      content: JSON.stringify({
        taskIntent: plan.taskInterpretation,
        assumptions: plan.assumptions,
        successCriteria: plan.taskSuccessCriteria,
        actions: plan.actions,
        potentialFailurePoints: plan.potentialFailurePoints,
      }),
      provider: this.name,
    };
  }
}

export interface OrchestratorOptions {
  primary: LLMProvider;
  fallback?: LLMProvider;
  requestTimeoutMs?: number;
}

export class ProviderOrchestrator implements LLMProvider {
  name = "orchestrator";
  public readonly primary: LLMProvider;
  public readonly fallback?: LLMProvider;
  public readonly requestTimeoutMs: number;

  constructor(options: OrchestratorOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.requestTimeoutMs = options.requestTimeoutMs || 30000;
  }

  async generate(prompt: string, systemPrompt?: string, options?: LLMGenerateOptions): Promise<LLMResponse> {
    if (options?.signal?.aborted) {
      throw new AgentError("Request was cancelled before execution.", ErrorCode.CANCELLED, false, undefined, "orchestrator");
    }

    const timeoutMs = options?.timeoutMs || this.requestTimeoutMs;
    const startTime = Date.now();

    // 1. Attempt Primary Provider
    let primaryError: AgentError | null = null;
    try {
      logger.info(`[ORCHESTRATOR] Invoking primary provider '${this.primary.name}'...`);
      const response = await this.primary.generate(prompt, systemPrompt, {
        signal: options?.signal,
        timeoutMs,
      });
      return {
        ...response,
        provider: response.provider || this.primary.name,
      };
    } catch (err: unknown) {
      const agentErr =
        err instanceof AgentError
          ? err
          : new AgentError(
              err instanceof Error ? err.message : String(err),
              ErrorCode.API_ERROR,
              false,
              undefined,
              this.primary.name
            );
      primaryError = agentErr;
      logger.warn(
        `[ORCHESTRATOR] Primary provider '${this.primary.name}' failed with code ${agentErr.code} (status ${agentErr.status ?? "unknown"}): ${agentErr.message}`
      );
    }

    // 2. Check if Fallback Provider is Configured
    if (!this.fallback) {
      logger.error(`[ORCHESTRATOR] No fallback provider configured. Propagating primary error.`);
      throw primaryError;
    }

    // Check cancellation
    if (primaryError.code === ErrorCode.CANCELLED || options?.signal?.aborted) {
      throw primaryError;
    }

    // Check fallback eligibility
    const fallbackEligibleCodes = new Set<ErrorCode>([
      ErrorCode.RATE_LIMITED,
      ErrorCode.QUOTA_EXHAUSTED,
      ErrorCode.TEMPORARY_UNAVAILABLE,
      ErrorCode.API_ERROR,
      ErrorCode.TIMEOUT,
      ErrorCode.NETWORK_ERROR,
      ErrorCode.MODEL_NOT_FOUND,
    ]);

    if (!fallbackEligibleCodes.has(primaryError.code)) {
      logger.warn(
        `[ORCHESTRATOR] Error code ${primaryError.code} is not eligible for fallback. Propagating.`
      );
      throw primaryError;
    }

    // 3. Attempt Fallback Provider
    logger.info(
      `[ORCHESTRATOR] Attempting configured fallback provider '${this.fallback.name}' due to primary failure (${primaryError.code})...`
    );

    const remainingTimeoutMs = Math.max(1000, timeoutMs - (Date.now() - startTime));

    try {
      const response = await this.fallback.generate(prompt, systemPrompt, {
        signal: options?.signal,
        timeoutMs: remainingTimeoutMs,
      });
      logger.info(
        `[ORCHESTRATOR] Fallback provider '${this.fallback.name}' succeeded.`
      );
      return {
        ...response,
        provider: response.provider || this.fallback.name,
      };
    } catch (fallbackErr: unknown) {
      const fallbackAgentErr =
        fallbackErr instanceof AgentError
          ? fallbackErr
          : new AgentError(
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
              ErrorCode.API_ERROR,
              false,
              undefined,
              this.fallback.name
            );

      logger.error(
        `[ORCHESTRATOR] Both primary ('${this.primary.name}') and fallback ('${this.fallback.name}') providers failed!`
      );

      throw new AgentError(
        `All configured LLM providers failed. Primary (${this.primary.name}): ${primaryError.message} | Fallback (${this.fallback.name}): ${fallbackAgentErr.message}`,
        primaryError.code,
        false,
        {
          details: {
            primaryProvider: this.primary.name,
            primaryCode: primaryError.code,
            primaryError: primaryError.message,
            fallbackProvider: this.fallback.name,
            fallbackCode: fallbackAgentErr.code,
            fallbackError: fallbackAgentErr.message,
          },
        },
        "orchestrator"
      );
    }
  }
}

export function buildProviderInstance(
  providerType: string,
  isFallback = false
): LLMProvider {
  const config = getConfig();

  if (providerType === "gemini") {
    const key =
      process.env.GEMINI_API_KEY ||
      config.GEMINI_API_KEY ||
      (config.LLM_API_KEY &&
      config.LLM_API_KEY !== "mock-key" &&
      !config.LLM_API_KEY.startsWith("mock-key") &&
      !config.LLM_API_KEY.includes("mock") &&
      config.LLM_API_KEY !== "test"
        ? config.LLM_API_KEY
        : undefined);

    if (!key || key === "your_gemini_api_key_here") {
      throw new AgentError(
        `GEMINI_API_KEY is not configured for ${isFallback ? "fallback" : "primary"} provider. Please set GEMINI_API_KEY in your server-side environment (.env.local).`,
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "gemini"
      );
    }

    const model = process.env.GEMINI_MODEL || config.GEMINI_MODEL || "gemini-flash-latest";
    return new GeminiProvider(key, model, undefined, config.LLM_REQUEST_TIMEOUT_MS);
  }

  if (providerType === "openai") {
    const grokKey = process.env.GROK_API_KEY || config.GROK_API_KEY;
    const key =
      grokKey ||
      (config.LLM_API_KEY &&
      config.LLM_API_KEY !== "mock-key" &&
      !config.LLM_API_KEY.startsWith("mock-key") &&
      !config.LLM_API_KEY.includes("mock") &&
      config.LLM_API_KEY !== "test"
        ? config.LLM_API_KEY
        : undefined);

    if (!key) {
      throw new AgentError(
        `OpenAI/Grok API key is not configured for ${isFallback ? "fallback" : "primary"} provider. Please set GROK_API_KEY or LLM_API_KEY in your server-side environment.`,
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "openai-compatible"
      );
    }

    const baseUrl =
      process.env.GROK_BASE_URL ||
      config.GROK_BASE_URL ||
      (grokKey ? "https://api.x.ai/v1" : config.LLM_BASE_URL);
    const model =
      process.env.GROK_MODEL ||
      config.GROK_MODEL ||
      (grokKey ? "grok-2-latest" : config.LLM_MODEL);

    return new OpenAICompatibleProvider(key, baseUrl, model, config.LLM_REQUEST_TIMEOUT_MS);
  }

  if (providerType === "mock") {
    if (isFallback) {
      throw new AgentError(
        "MockProvider cannot be selected as a live fallback provider. Simulated provider fallbacks are prohibited in live execution.",
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "mock"
      );
    }
    if (config.NODE_ENV === "production") {
      throw new AgentError(
        "MockProvider is strictly forbidden in production mode.",
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "mock"
      );
    }
    return new MockProvider();
  }

  throw new AgentError(
    `Unknown LLM provider '${providerType}'. Supported providers are: gemini, openai, mock.`,
    ErrorCode.CONFIG_ERROR,
    false,
    undefined,
    providerType
  );
}

export function createLLMProvider(): LLMProvider {
  const config = getConfig();
  const primaryType = config.LLM_PROVIDER;
  const fallbackType = config.LLM_FALLBACK_PROVIDER;

  const primary = buildProviderInstance(primaryType, false);

  let fallback: LLMProvider | undefined = undefined;
  if (fallbackType && fallbackType !== "none") {
    if (fallbackType === "mock") {
      throw new AgentError(
        "MockProvider cannot be selected as a live fallback provider. Simulated provider fallbacks are prohibited in live execution.",
        ErrorCode.CONFIG_ERROR,
        false,
        undefined,
        "mock"
      );
    }
    fallback = buildProviderInstance(fallbackType, true);
  }

  return new ProviderOrchestrator({
    primary,
    fallback,
    requestTimeoutMs: config.LLM_REQUEST_TIMEOUT_MS,
  });
}

