import { GoogleGenAI } from "@google/genai";
import { getConfig } from "../config";
import { SemanticDecomposer } from "../agent/semantic-decomposer";
import { ErrorCode, AgentError } from "../types/errors";
import { logger } from "../observability/logger";

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  generate(prompt: string, systemPrompt?: string): Promise<LLMResponse>;
}

export class OpenAICompatibleProvider implements LLMProvider {
  name = "openai-compatible";
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1", model = "gpt-4o-mini") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
  }

  async generate(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
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
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM provider request failed (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    return {
      content,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  private apiKey: string;
  private model: string;
  private client: GoogleGenAI;

  constructor(apiKey: string, model = "gemini-flash-latest", customClient?: GoogleGenAI) {
    if (!apiKey || apiKey === "your_gemini_api_key_here") {
      throw new AgentError(
        "Missing Gemini API key. Please configure GEMINI_API_KEY in your server-side environment (.env.local).",
        ErrorCode.CONFIG_ERROR,
        false
      );
    }
    this.apiKey = apiKey;
    this.model = model;
    this.client = customClient || new GoogleGenAI({ apiKey });
  }

  async generate(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const startTime = Date.now();
    const modelsToAttempt = [this.model];
    if (this.model === "gemini-flash-latest") {
      modelsToAttempt.push("gemini-flash-lite-latest");
    }

    let lastError: unknown = null;

    for (let i = 0; i < modelsToAttempt.length; i++) {
      const currentModel = modelsToAttempt[i];
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
            ErrorCode.API_ERROR,
            true
          );
        }

        const durationMs = Date.now() - startTime;
        logger.info(`Gemini API call completed in ${durationMs}ms using model ${currentModel}`);

        return {
          content: rawContent,
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
        const is503 =
          rawError.includes("503") ||
          rawError.includes("high demand") ||
          rawError.includes("UNAVAILABLE");

        // If 503 and we have another model candidate, pause briefly and try fallback
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

    // Map specific HTTP / API error patterns to structured AgentErrors
    if (sanitizedError.includes("404") || sanitizedError.includes("not found")) {
      throw new AgentError(
        `Gemini model '${this.model}' is not available or not supported by this API key. Please check GEMINI_MODEL. Details: ${sanitizedError}`,
        ErrorCode.CONFIG_ERROR,
        false
      );
    }

      if (
        sanitizedError.includes("429") ||
        sanitizedError.includes("quota") ||
        sanitizedError.includes("RESOURCE_EXHAUSTED")
      ) {
        throw new AgentError(
          `Gemini API rate limit or quota exceeded. Please check your Google AI Studio plan. Details: ${sanitizedError}`,
          ErrorCode.RATE_LIMITED,
          false
        );
      }

      if (
        sanitizedError.includes("503") ||
        sanitizedError.includes("high demand") ||
        sanitizedError.includes("UNAVAILABLE")
      ) {
        throw new AgentError(
          `Gemini service is temporarily experiencing high demand. Details: ${sanitizedError}`,
          ErrorCode.API_ERROR,
          true
        );
      }

      if (
        sanitizedError.includes("API key") ||
        sanitizedError.includes("unauthorized") ||
        sanitizedError.includes("PERMISSION_DENIED")
      ) {
        throw new AgentError(
          `Gemini authentication failed. Please verify your GEMINI_API_KEY. Details: ${sanitizedError}`,
          ErrorCode.CONFIG_ERROR,
          false
        );
      }

      throw new AgentError(
        `Gemini provider error: ${sanitizedError}`,
        ErrorCode.API_ERROR,
        false
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

  async generate(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Extract user task from prompt envelope
    const taskMatch = prompt.match(/<authorized_user_task>([\s\S]*?)<\/authorized_user_task>/i) ||
      prompt.match(/=== USER TASK[^=]*===([\s\S]*?)=== END USER TASK ===/i);
    const rawTask = taskMatch ? taskMatch[1].trim() : prompt;
    const lower = rawTask.toLowerCase();

    // Check if prompt is a Replan request with execution context
    const isReplan = prompt.includes("FAILED ACTION") || prompt.includes("FAILURE DIAGNOSTIC") || prompt.includes("Dynamic Replanning Engine");
    const obsMatch = prompt.match(/<untrusted_page_content>([\s\S]*?)<\/untrusted_page_content>/i);
    const obsText = obsMatch ? obsMatch[1] : "";

    // 1. REPLAN GENERATION
    if (isReplan) {
      // Check if button text changed in observation (e.g. "Find Products" instead of "Search")
      let targetButton = "Search";
      if (obsText.toLowerCase().includes("find products")) targetButton = "Find Products";
      else if (obsText.toLowerCase().includes("find")) targetButton = "Find";
      else if (obsText.toLowerCase().includes("send message")) targetButton = "Send Message";
      else if (obsText.toLowerCase().includes("submit")) targetButton = "Submit";

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

    // 2. TARGET URL DETERMINATION
    let targetUrl: string | undefined;
    const urlMatch = prompt.match(/(https?:\/\/[^\s\)\>]+)/i);
    if (urlMatch) {
      targetUrl = urlMatch[1];
    } else if (lower.includes("search")) {
      targetUrl = "http://localhost:3000/test-fixtures/search";
    } else if (lower.includes("form") || lower.includes("contact")) {
      targetUrl = "http://localhost:3000/test-fixtures/form";
    } else if (lower.includes("download") || lower.includes("invoice") || lower.includes("pdf")) {
      targetUrl = "http://localhost:3000/test-fixtures/download";
    } else if (lower.includes("tab")) {
      targetUrl = "http://localhost:3000/test-fixtures/multi-tab";
    } else if (lower.includes("dynamic")) {
      targetUrl = "http://localhost:3000/test-fixtures/dynamic";
    } else if (lower.includes("ambiguous")) {
      targetUrl = "http://localhost:3000/test-fixtures/ambiguous";
    } else if (lower.includes("dom-change")) {
      targetUrl = "http://localhost:3000/test-fixtures/dom-change";
    } else if (lower.includes("prompt-injection")) {
      targetUrl = "http://localhost:3000/test-fixtures/prompt-injection";
    } else {
      targetUrl = "https://example.com";
    }

    // 3. TASK INTENT & ACTION SYNTHESIS (Phase 2A - 2N)
    const intent = SemanticDecomposer.decompose(rawTask, null, targetUrl);

    // Case 1: Unsupported Tasks (Phase 2N & 2O)
    if (intent.isUnsupported) {
      return {
        content: JSON.stringify({
          taskIntent: `Unsupported request: ${intent.unsupportedReason}`,
          assumptions: ["Operation cannot be performed safely or is not supported by target interface"],
          successCriteria: {
            requiredOperations: ["navigate"],
            requiredOutputs: [],
            verificationChecks: ["unsupportedOperationReported"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to target: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for page load" },
            { id: "finish-unsupported", type: "finish", risk: "low", reason: intent.unsupportedReason || "Task unsupported" },
          ],
        }),
      };
    }

    // Case 2: Ambiguity Requiring Clarification (Phase 2M)
    if (intent.requiresClarification) {
      return {
        content: JSON.stringify({
          taskIntent: `Needs clarification: ${intent.clarificationReason}`,
          assumptions: ["Ambiguous target elements detected on page"],
          successCriteria: {
            requiredOperations: ["navigate"],
            requiredOutputs: [],
            verificationChecks: ["clarificationRequired"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to target: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for page load" },
            { id: "finish-clarify", type: "finish", risk: "low", reason: intent.clarificationReason || "Clarification required" },
          ],
        }),
      };
    }

    // Case 3: Dynamic Content Loading (Phase 2H)
    if (intent.intentType === "DYNAMIC_WAIT_AND_EXTRACT") {
      return {
        content: JSON.stringify({
          taskIntent: "Wait for dynamic content to load and extract status/verification details",
          assumptions: ["Page loads dynamic content asynchronously after delay"],
          successCriteria: {
            requiredOperations: ["navigate", "wait", "extractText"],
            requiredOutputs: ["code"],
            verificationChecks: ["dynamicContentExtracted"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to dynamic fixture: ${targetUrl}` },
            {
              id: "wait-dynamic",
              type: "wait",
              value: 1700,
              risk: "low",
              reason: "Wait for dynamic content to finish loading and appear in DOM",
              expectedState: { elementAppears: "#delayed-card" },
            },
            {
              id: "extract-delayed",
              type: "extractText",
              target: { strategy: "css", value: "#delayed-card, [id*='delayed']" },
              risk: "low",
              reason: "Extract loaded dynamic content and verification code",
            },
            { id: "finish-dyn", type: "finish", risk: "low", reason: "Complete dynamic content extraction" },
          ],
        }),
      };
    }

    // Case 4: Multi-Tab Tasks (Phase 2J)
    if (intent.intentType === "OPEN_TAB") {
      return {
        content: JSON.stringify({
          taskIntent: "Open target product link in a new browser tab and verify",
          assumptions: ["Page contains links configured to open in new tab"],
          successCriteria: {
            requiredOperations: ["navigate", "openNewTab"],
            requiredOutputs: [],
            verificationChecks: ["newTabOpened"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to multi-tab fixture: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for links" },
            {
              id: "open-tab-link",
              type: "openNewTab",
              target: { strategy: "css", value: "#open-tab-btn, a[target='_blank']" },
              value: "http://localhost:3000/test-fixtures/multi-tab/target",
              risk: "low",
              reason: "Open target link in a new tab",
            },
            {
              id: "switch-new-tab",
              type: "switchTab",
              value: "tab-1",
              risk: "low",
              reason: "Switch focus context to newly opened tab",
            },
            { id: "finish-tabs", type: "finish", risk: "low", reason: "Multi-tab workflow complete" },
          ],
        }),
      };
    }

    // Case 5: Download Tasks
    if (intent.intentType === "DOWNLOAD") {
      return {
        content: JSON.stringify({
          taskIntent: "Download available file from page and verify on disk",
          assumptions: ["Page renders a download button or download link"],
          successCriteria: {
            requiredOperations: ["navigate", "download"],
            requiredOutputs: ["file"],
            verificationChecks: ["downloadCompleted"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to download page: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for download button" },
            {
              id: "click-download",
              type: "download",
              target: { strategy: "css", value: "#download-invoice-btn, a[download], [role='button']" },
              risk: "low",
              reason: "Initiate file download and capture binary stream",
            },
            { id: "finish-dl", type: "finish", risk: "low", reason: "File download completed" },
          ],
        }),
      };
    }

    // Case 6: Form Fill with Negation (do not submit)
    if (intent.intentType === "FORM_FILL") {
      return {
        content: JSON.stringify({
          taskIntent: "Fill form fields while strictly withholding submission as requested",
          assumptions: ["Form contains name and email inputs", "Submission forbidden by user constraint"],
          successCriteria: {
            requiredOperations: ["navigate", "fill"],
            requiredOutputs: [],
            verificationChecks: ["fieldsFilled", "submissionOmitted"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to form page: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for inputs" },
            {
              id: "fill-name",
              type: "fill",
              target: { strategy: "name", value: "fullName" },
              value: "Alex Rivera",
              risk: "low",
              reason: "Fill contact name",
            },
            {
              id: "fill-email",
              type: "fill",
              target: { strategy: "name", value: "email" },
              value: "alex@example.com",
              risk: "low",
              reason: "Fill contact email",
            },
            { id: "finish-nosubmit", type: "finish", risk: "low", reason: "Finalize task with submission withheld" },
          ],
        }),
      };
    }

    // Case 7: Form Fill with Positive Submission
    if (intent.intentType === "FORM_SUBMIT") {
      return {
        content: JSON.stringify({
          taskIntent: "Fill contact form fields and submit",
          assumptions: ["Form contains inputs and submit control"],
          successCriteria: {
            requiredOperations: ["navigate", "fill", "submit"],
            requiredOutputs: [],
            verificationChecks: ["formSubmitted"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to form page: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for inputs" },
            {
              id: "fill-name",
              type: "fill",
              target: { strategy: "name", value: "fullName" },
              value: "Alex Rivera",
              risk: "low",
              reason: "Fill contact full name",
            },
            {
              id: "fill-email",
              type: "fill",
              target: { strategy: "name", value: "email" },
              value: "alex@example.com",
              risk: "low",
              reason: "Fill contact email address",
            },
            {
              id: "click-submit",
              type: "click",
              target: { strategy: "role", role: "button", value: "Submit Contact Form" },
              risk: "low",
              reason: "Submit the completed contact form",
            },
            { id: "finish-submit", type: "finish", risk: "low", reason: "Form submitted successfully" },
          ],
        }),
      };
    }

    // Case 8: Search Tasks (Phase 2B, 2C, 2E, 2F, 2G, 2I)
    if (intent.intentType.startsWith("SEARCH")) {
      // Live DOM adaptation: inspect observation for button wording (Phase 2I)
      let searchButton = "Search";
      if (obsText.toLowerCase().includes("find products")) {
        searchButton = "Find Products";
      } else if (obsText.toLowerCase().includes("find")) {
        searchButton = "Find";
      }

      let searchPlaceholder = "Search products";
      if (obsText.toLowerCase().includes("search catalog")) {
        searchPlaceholder = "Search catalog...";
      }

      // 8a: Ordinal Selection (e.g. "open the second result" vs "extract second result")
      if (intent.intentType === "SEARCH_AND_SELECT") {
        const ordinalIdx = intent.ordinal?.index ?? 1;
        const isExtractTask = lower.includes("extract") || lower.includes("get") || lower.includes("give") || lower.includes("title") || lower.includes("price");

        if (isExtractTask) {
          return {
            content: JSON.stringify({
              taskIntent: `Search for '${intent.query}' and extract result #${ordinalIdx + 1}`,
              assumptions: ["Product catalog with search input and result cards"],
              successCriteria: {
                requiredOperations: ["navigate", "search", "extractText"],
                requiredOutputs: ["title", "price"],
                verificationChecks: ["searchSubmitted", "resultsExist"],
              },
              actions: [
                { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to catalog: ${targetUrl}` },
                { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for search field" },
                {
                  id: "fill-search",
                  type: "fill",
                  target: { strategy: "placeholder", value: searchPlaceholder },
                  value: intent.query || "laptop",
                  risk: "low",
                  reason: `Enter '${intent.query || "laptop"}' into search field`,
                },
                {
                  id: "click-search-btn",
                  type: "click",
                  target: { strategy: "role", role: "button", value: searchButton },
                  risk: "low",
                  reason: `Click '${searchButton}' button`,
                },
                { id: "wait-results", type: "wait", value: 400, risk: "low", reason: "Wait for search results" },
                {
                  id: "extract-title-ordinal",
                  type: "extractText",
                  target: { strategy: "css", value: ".product-card h3, [data-testid='product-title'], h3, .product-title", index: ordinalIdx },
                  risk: "low",
                  reason: `Extract title of result #${ordinalIdx + 1}`,
                },
                {
                  id: "extract-price-ordinal",
                  type: "extractText",
                  target: { strategy: "css", value: ".product-card span, [data-testid='product-price'], .price, .product-price", index: ordinalIdx },
                  risk: "low",
                  reason: `Extract price of result #${ordinalIdx + 1}`,
                },
                {
                  id: "extract-cards",
                  type: "evaluateSafe",
                  risk: "low",
                  reason: "Extract product cards for structured verification",
                },
                { id: "finish-ordinal", type: "finish", risk: "low", reason: `Extracted result #${ordinalIdx + 1}` },
              ],
            }),
          };
        }

        return {
          content: JSON.stringify({
            taskIntent: `Search for '${intent.query}' and select result #${ordinalIdx + 1}`,
            assumptions: ["Product catalog with search input and result cards"],
            successCriteria: {
              requiredOperations: ["navigate", "search", "click"],
              requiredOutputs: [],
              verificationChecks: ["searchSubmitted", "resultsExist"],
            },
            actions: [
              { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to catalog: ${targetUrl}` },
              { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for search field" },
              {
                id: "fill-search",
                type: "fill",
                target: { strategy: "placeholder", value: searchPlaceholder },
                value: intent.query || "laptop",
                risk: "low",
                reason: `Enter '${intent.query || "laptop"}' into search field`,
              },
              {
                id: "click-search-btn",
                type: "click",
                target: { strategy: "role", role: "button", value: searchButton },
                risk: "low",
                reason: `Click '${searchButton}' button`,
              },
              { id: "wait-results", type: "wait", value: 400, risk: "low", reason: "Wait for search results" },
              {
                id: "click-result-ordinal",
                type: "click",
                target: { strategy: "text", value: "Select Product", index: ordinalIdx, role: "button" },
                risk: "low",
                reason: `Click Select Product on result index ${ordinalIdx}`,
              },
              { id: "finish-ordinal", type: "finish", risk: "low", reason: "Selected second product" },
            ],
          }),
        };
      }

      // 8b: DOM-Change search test
      if (targetUrl.includes("dom-change")) {
        return {
          content: JSON.stringify({
            taskIntent: `Search for '${intent.query || "laptop"}' and adapt to live DOM variations`,
            assumptions: ["Page has dynamic button variant and catalog search input"],
            successCriteria: {
              requiredOperations: ["navigate", "search"],
              requiredOutputs: [],
              verificationChecks: ["searchSubmitted"],
            },
            actions: [
              { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to fixture: ${targetUrl}` },
              { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for controls" },
              {
                id: "fill-search",
                type: "fill",
                target: { strategy: "placeholder", value: searchPlaceholder },
                value: intent.query || "laptop",
                risk: "low",
                reason: `Enter '${intent.query || "laptop"}' into search field`,
              },
              {
                id: "click-search-btn",
                type: "click",
                target: { strategy: "role", role: "button", value: searchButton },
                risk: "low",
                reason: `Click '${searchButton}' button`,
              },
              { id: "wait-results", type: "wait", value: 400, risk: "low", reason: "Wait for submission confirmation" },
              { id: "finish-dom-search", type: "finish", risk: "low", reason: "DOM change search action completed" },
            ],
          }),
        };
      }

      // 8c: Search with Comparison / Filter / Count / Nonexistent
      const isNonexistent = intent.query?.includes("not exist") || lower.includes("not exist");
      return {
        content: JSON.stringify({
          taskIntent: `Search for '${intent.query}' and extract result data for local semantic evaluation`,
          assumptions: ["Product catalog with search input and result cards"],
          successCriteria: {
            requiredOperations: ["navigate", "search"],
            requiredOutputs: isNonexistent ? [] : (intent.requestedOutputs.length > 0 ? intent.requestedOutputs : ["results"]),
            verificationChecks: isNonexistent ? [] : ["searchSubmitted", "resultsExist"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to catalog: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for search field" },
            {
              id: "fill-search",
              type: "fill",
              target: { strategy: "placeholder", value: searchPlaceholder },
              value: intent.query || "laptop",
              risk: "low",
              reason: `Enter '${intent.query || "laptop"}' into search field`,
            },
            {
              id: "click-search-btn",
              type: "click",
              target: { strategy: "role", role: "button", value: searchButton },
              risk: "low",
              reason: `Click '${searchButton}' button`,
            },
            { id: "wait-results", type: "wait", value: 400, risk: "low", reason: "Wait for search results" },
            {
              id: "extract-cards",
              type: "evaluateSafe",
              risk: "low",
              reason: "Extract all product cards for local semantic evaluation (min/max/filter/count)",
            },
            { id: "finish-search", type: "finish", risk: "low", reason: "Complete search and local reasoning" },
          ],
        }),
      };
    }

    // Case 9: Prompt Injection Defense
    if (intent.intentType === "PROMPT_INJECTION_DEFENSE" || lower.includes("prompt injection") || lower.includes("prompt-injection") || targetUrl.includes("prompt-injection")) {
      return {
        content: JSON.stringify({
          taskIntent: "Safely extract catalog data while disregarding adversarial prompt injections",
          assumptions: ["Page contains guide/catalog elements and untrusted review text"],
          successCriteria: {
            requiredOperations: ["navigate", "extractText"],
            requiredOutputs: ["title"],
            verificationChecks: ["catalogInspected"],
          },
          actions: [
            { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to fixture: ${targetUrl}` },
            { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for page elements" },
            {
              id: "extract-title",
              type: "extractText",
              target: { strategy: "css", value: "#catalog-title, h2" },
              risk: "low",
              reason: "Extract legitimate guide title ignoring untrusted prompt injections",
            },
            { id: "finish-adv", type: "finish", risk: "low", reason: "Complete adversarial test safely" },
          ],
        }),
      };
    }

    // Case 10: Generic Extraction Fallback
    return {
      content: JSON.stringify({
        taskIntent: `Autonomous workflow for: ${rawTask}`,
        assumptions: ["Standard web document"],
        successCriteria: {
          requiredOperations: ["navigate", "extractText"],
          requiredOutputs: ["content"],
          verificationChecks: ["contentExtracted"],
        },
        actions: [
          { id: "nav-1", type: "navigate", value: targetUrl, risk: "low", reason: `Navigate to: ${targetUrl}` },
          { id: "wait-1", type: "wait", value: 400, risk: "low", reason: "Wait for DOM" },
          {
            id: "extract-main",
            type: "extractText",
            target: { strategy: "css", value: "h1, main, body" },
            risk: "low",
            reason: "Extract relevant page content",
          },
          { id: "finish-default", type: "finish", risk: "low", reason: "Task completed" },
        ],
      }),
    };
  }
}

export function createLLMProvider(): LLMProvider {
  const config = getConfig();
  const provider = config.LLM_PROVIDER;

  if (provider === "gemini") {
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
        "GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in your server-side environment (.env.local).",
        ErrorCode.CONFIG_ERROR,
        false
      );
    }

    const model = process.env.GEMINI_MODEL || config.GEMINI_MODEL || "gemini-flash-latest";
    return new GeminiProvider(key, model);
  }

  if (provider === "openai") {
    const isMockOrPlaceholder =
      !config.LLM_API_KEY ||
      config.LLM_API_KEY === "mock-key" ||
      config.LLM_API_KEY.startsWith("mock-key") ||
      config.LLM_API_KEY.includes("mock") ||
      config.LLM_API_KEY === "test";

    if (!isMockOrPlaceholder) {
      return new OpenAICompatibleProvider(config.LLM_API_KEY, config.LLM_BASE_URL, config.LLM_MODEL);
    }
  }

  return new MockProvider();
}

