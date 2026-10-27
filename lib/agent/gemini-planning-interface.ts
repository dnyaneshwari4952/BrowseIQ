/**
 * Gemini Planning Interface (Phase 5)
 *
 * This is the ONLY approved path through which Gemini may participate in task planning.
 *
 * Contract:
 * - Gemini proposes a structured plan; it does NOT execute browser actions.
 * - All output is validated against the existing action/plan schemas.
 * - The validated plan then proceeds through the same PlanValidator,
 *   ActionExecutor, and TaskVerifier as any Playwright-only plan.
 * - Gemini cannot bypass safety checks, verification, or confirmation guards.
 * - API keys are never exposed to the frontend.
 */

import { Plan, LLMPlanOutputSchema } from "../types/plans";
import { OperatingMode } from "../types/operating-mode";
import { LLMProvider, GeminiProvider, buildProviderInstance } from "../ai/llm-provider";
import { PromptDefense } from "../ai/prompt-defense";
import { PlanValidator } from "../validation/plan-validator";
import { SemanticDecomposer } from "./semantic-decomposer";
import { PageObservation } from "../types/browser";
import { ActionType, RiskLevel, ActionSchema } from "../types/actions";
import { TaskSuccessCriteria } from "../types/plans";
import { ErrorCode, AgentError } from "../types/errors";
import { logger } from "../observability/logger";
import { getConfig } from "../config";
import { z } from "zod";

/**
 * Signals that describe why the deterministic planner needs Gemini assistance.
 * These must be generic and evidence-based — never hardcoded to specific tasks.
 */
export interface AssistanceSignals {
  /** Deterministic planner produced a low-confidence intent score */
  lowConfidence: boolean;
  /** Multiple semantically conflicting operations detected in one instruction */
  multiStepConflict: boolean;
  /** Task references entity/relationship patterns the decomposer could not map */
  unmappedEntityRelationship: boolean;
  /** Task intent type is AMBIGUOUS_ACTION or DESTRUCTIVE_UNSUPPORTED after decomposition */
  unresolvedAmbiguity: boolean;
  /** Confidence score computed by the deterministic planner (0–1) */
  confidenceScore: number;
  /** Whether Gemini assistance is actually needed based on the signals */
  needsAssistance: boolean;
  /** Human-readable reason why assistance is requested */
  reason: string;
}

/**
 * Plan metadata that records what planning path was taken.
 * Attached to the ExecutionContext for observability.
 */
export interface PlanningMetadata {
  operatingMode: OperatingMode;
  geminiInvoked: boolean;
  geminiInvokeReason?: string;
  deterministicConfidenceScore: number;
  planSource: "deterministic" | "gemini_assisted" | "gemini_with_deterministic_fallback";
  planValidationOutcome: "accepted" | "rejected";
  planValidationIssues?: string[];
}

const MAX_REPAIR_ATTEMPTS = 1; // bounded; never unbounded

/** Allowed action types from Gemini output — strict whitelist */
const ALLOWED_GEMINI_ACTION_TYPES = new Set([
  "navigate",
  "click",
  "doubleClick",
  "fill",
  "type",
  "press",
  "select",
  "check",
  "uncheck",
  "hover",
  "scroll",
  "wait",
  "extractText",
  "extractAttribute",
  "extractTable",
  "download",
  "openNewTab",
  "switchTab",
  "closeTab",
  "assert",
  "finish",
]);

/**
 * Compute confidence signals for whether the deterministic planner
 * needs Gemini assistance for a given task intent.
 *
 * This is generic and evidence-based — it does not special-case individual
 * websites, products, songs, filenames, or commands.
 */
export function assessPlannerConfidence(
  rawTask: string,
  observation: PageObservation | null | undefined,
  targetUrl: string | undefined,
  taskIntent: ReturnType<typeof SemanticDecomposer.decompose>
): AssistanceSignals {
  const lower = rawTask.toLowerCase();
  let confidenceScore = 1.0;
  let lowConfidence = false;
  let multiStepConflict = false;
  let unmappedEntityRelationship = false;
  let unresolvedAmbiguity = false;

  // 1. Unresolved ambiguity from decomposer
  if (taskIntent.requiresClarification || taskIntent.intentType === "AMBIGUOUS_ACTION") {
    unresolvedAmbiguity = true;
    confidenceScore -= 0.35;
  }

  // 2. Intent type indicates the decomposer did not map the task
  if (
    taskIntent.intentType === "AMBIGUOUS_ACTION" ||
    taskIntent.intentType === "CONTENT_INSPECT" ||
    taskIntent.intentType === "DYNAMIC_WAIT_AND_EXTRACT"
  ) {
    unmappedEntityRelationship = true;
    confidenceScore -= 0.2;
  }

  // 3. Multi-step detection: instruction contains multiple independent clauses
  // E.g. "first search X, then compare prices, then fill out form and submit"
  const conjunctionPattern =
    /\b(then|after that|next|subsequently|and then|followed by|afterward)\b/gi;
  const conjunctionMatches = lower.match(conjunctionPattern) || [];
  if (conjunctionMatches.length >= 2) {
    multiStepConflict = true;
    confidenceScore -= 0.15 * Math.min(conjunctionMatches.length, 4);
  }

  // 4. Complex relationship patterns: comparisons across multiple dimensions
  const complexPatterns = [
    /compare\s+.+\s+and\s+.+\s+(by|on|for)\s+\w+/i,
    /find\s+the\s+\w+\s+that\s+(has|is|contains|satisfies)\s+.+\s+(and|but)\s+.+/i,
    /sort\s+.+\s+by\s+\w+\s+and\s+(filter|select|pick)\s+.+/i,
  ];
  if (complexPatterns.some((p) => p.test(lower))) {
    unmappedEntityRelationship = true;
    confidenceScore -= 0.15;
  }

  // 5. Task entity is not resolved
  if (!taskIntent.entity && !taskIntent.query) {
    confidenceScore -= 0.1;
  }

  // 6. No observation grounding when one was expected
  if (!observation && targetUrl && confidenceScore < 0.8) {
    confidenceScore -= 0.05;
  }

  // Clamp
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));
  lowConfidence = confidenceScore < 0.6;

  const needsAssistance =
    lowConfidence || multiStepConflict || unmappedEntityRelationship || unresolvedAmbiguity;

  const reasons: string[] = [];
  if (unresolvedAmbiguity) reasons.push("unresolved ambiguity in task decomposition");
  if (multiStepConflict) reasons.push("multiple dependent sequential operations detected");
  if (unmappedEntityRelationship) reasons.push("complex entity/constraint relationship not mappable by deterministic planner");
  if (lowConfidence) reasons.push(`low confidence score (${confidenceScore.toFixed(2)})`);

  return {
    lowConfidence,
    multiStepConflict,
    unmappedEntityRelationship,
    unresolvedAmbiguity,
    confidenceScore,
    needsAssistance,
    reason: reasons.join("; ") || "deterministic planner is confident",
  };
}

/**
 * Validate that a Gemini-produced plan does not contain:
 * - Unsupported action types
 * - Code execution / shell commands
 * - Unsafe navigation targets
 * - Raw JavaScript injection
 */
function validateGeminiPlanSafety(
  actions: Array<Record<string, unknown>>
): { safe: boolean; violations: string[] } {
  const violations: string[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const type = String(action.type || "");
    const value = String(action.value || "");
    const targetValue = String((action.target as Record<string, unknown>)?.value || "");

    if (!ALLOWED_GEMINI_ACTION_TYPES.has(type)) {
      violations.push(`Action ${i + 1}: unsupported type '${type}'`);
    }

    // Block eval / code execution patterns in values
    const dangerousPatterns = [
      /eval\s*\(/i,
      /Function\s*\(/i,
      /require\s*\(/i,
      /import\s*\(/i,
      /process\.(env|exit|kill)/i,
      /child_process/i,
      /fs\.(unlink|rmdir|rm|write)/i,
      /\.\.[\\/]/,
    ];
    for (const pat of dangerousPatterns) {
      if (pat.test(value) || pat.test(targetValue)) {
        violations.push(`Action ${i + 1}: potentially unsafe content detected in value/target`);
        break;
      }
    }

    // Block dangerous URL schemes
    if (
      targetValue.startsWith("javascript:") ||
      targetValue.startsWith("data:") ||
      targetValue.startsWith("vbscript:")
    ) {
      violations.push(`Action ${i + 1}: unsafe URL scheme in navigation target`);
    }
  }

  return { safe: violations.length === 0, violations };
}

/**
 * GeminiPlanningInterface — invoked only from Planner when:
 * 1. The operating mode is "gemini_assisted"
 * 2. The deterministic planner confidence signals indicate genuine need
 *
 * Returns a validated Plan that then flows through the standard
 * PlanValidator → ActionExecutor → TaskVerifier pipeline.
 */
export class GeminiPlanningInterface {
  private _provider: LLMProvider | undefined;
  private readonly injectedProvider: LLMProvider | undefined;

  constructor(provider?: LLMProvider) {
    // Provider is optionally injected (useful for tests).
    // If not provided, it is built lazily in requestPlan() when first needed.
    this.injectedProvider = provider;
  }

  private getProvider(): LLMProvider {
    if (this.injectedProvider) return this.injectedProvider;
    if (!this._provider) {
      // Build from config — throws if GEMINI_API_KEY is missing
      this._provider = buildProviderInstance("gemini", false);
    }
    return this._provider;
  }

  /**
   * Check whether Gemini is configured in the current environment.
   * Does not make a network call.
   */
  static isConfigured(): boolean {
    try {
      const config = getConfig();
      const key =
        process.env.GEMINI_API_KEY ||
        config.GEMINI_API_KEY;
      return Boolean(key && key !== "your_gemini_api_key_here" && key.length > 10);
    } catch {
      return false;
    }
  }

  /**
   * Request a structured plan from Gemini.
   * Validates the output, rejects unsafe/unsupported actions.
   * Returns a bounded plan ready for PlanValidator.
   */
  async requestPlan(
    task: string,
    targetUrl: string | undefined,
    observation: PageObservation | null | undefined,
    assistanceReason: string,
    abortSignal?: AbortSignal
  ): Promise<Plan> {
    const sanitizedTask = PromptDefense.scanAndSanitize(task).sanitizedContent;
    const observationText = PromptDefense.formatObservationForLLM(observation ?? null);

    const systemPrompt = `You are the Gemini Planning Assistant for a Browser Automation Agent.
Your ONLY job is to produce a structured JSON task plan when the deterministic planner needs help.
Playwright will execute all browser actions — you do NOT control the browser.
You must output PURE JSON with no markdown fences or commentary.

Schema:
{
  "taskIntent": "string",
  "assumptions": ["string"],
  "successCriteria": {
    "requiredOperations": ["navigate", "search", "fill", "click", "extract"],
    "requiredOutputs": ["title", "price"],
    "verificationChecks": ["resultsExist"]
  },
  "actions": [
    {
      "id": "action-1",
      "type": "navigate|click|fill|type|press|select|check|uncheck|hover|scroll|wait|extractText|extractAttribute|extractTable|download|openNewTab|switchTab|closeTab|assert|finish",
      "target": { "strategy": "role|label|placeholder|text|testId|name|id|css|xpath", "value": "selector", "role": "optional", "description": "description" },
      "value": "optional string value",
      "risk": "low|medium|high",
      "reason": "why"
    }
  ],
  "potentialFailurePoints": ["optional"]
}

CRITICAL RULES:
1. Only use allowed action types listed above.
2. Do NOT include eval(), Function(), require(), import(), shell commands, or arbitrary code.
3. Do NOT use javascript:, data:, or vbscript: URL schemes.
4. Do NOT declare a task successful — that is determined by Playwright and the verifier.
5. Output ONLY valid JSON.`;

    const prompt = PromptDefense.constructSafePrompt({
      systemRules: systemPrompt,
      userTask: sanitizedTask,
      untrustedPageContent: observationText,
      planContext: [
        targetUrl ? `Target URL: ${targetUrl}` : "",
        `Assistance requested because: ${assistanceReason}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    let rawJson: string;
    try {
      const response = await this.getProvider().generate(prompt, systemPrompt, {
        signal: abortSignal,
        timeoutMs: 30000,
      });
      rawJson = response.content;
    } catch (err) {
      if (err instanceof AgentError) throw err;
      throw new AgentError(
        `Gemini planning request failed: ${err instanceof Error ? err.message : String(err)}`,
        ErrorCode.API_ERROR,
        false,
        undefined,
        "gemini"
      );
    }

    // Parse and validate schema
    let parsed: unknown;
    try {
      // Strip any accidental markdown fences
      const cleaned = rawJson
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new AgentError(
        "Gemini returned malformed JSON — plan rejected",
        ErrorCode.INVALID_RESPONSE,
        false,
        undefined,
        "gemini"
      );
    }

    const schemaResult = LLMPlanOutputSchema.safeParse(parsed);
    if (!schemaResult.success) {
      const issues = schemaResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      // Attempt one bounded repair if actions field is the only issue
      logger.warn(`[GeminiPlanningInterface] Schema validation failed: ${issues}`);
      throw new AgentError(
        `Gemini plan failed schema validation: ${issues}`,
        ErrorCode.VALIDATION_FAILED,
        false,
        { details: { issues } },
        "gemini"
      );
    }

    const llmOutput = schemaResult.data;

    // Safety gate — whitelist action types and block code injection
    const rawActions = (parsed as Record<string, unknown>)?.actions as Array<Record<string, unknown>>;
    const safetyResult = validateGeminiPlanSafety(rawActions || []);
    if (!safetyResult.safe) {
      throw new AgentError(
        `Gemini plan rejected by safety gate: ${safetyResult.violations.join("; ")}`,
        ErrorCode.VALIDATION_FAILED,
        false,
        { details: { violations: safetyResult.violations } },
        "gemini"
      );
    }

    // Build typed actions
    let actions = llmOutput.actions.map((a, idx) => ({
      ...a,
      id: a.id || `gemini-action-${idx + 1}-${a.type}`,
    }));

    // Ensure FINISH action
    const lastAction = actions[actions.length - 1];
    if (!lastAction || lastAction.type !== ActionType.FINISH) {
      actions.push({
        id: `gemini-action-${actions.length + 1}-finish`,
        type: ActionType.FINISH,
        risk: RiskLevel.LOW,
        reason: "Conclude Gemini-assisted plan and verify task completion",
      });
    }

    const taskSuccessCriteria: TaskSuccessCriteria = {
      requiredOperations: llmOutput.successCriteria.requiredOperations || [],
      requiredOutputs: llmOutput.successCriteria.requiredOutputs || [],
      verificationChecks: llmOutput.successCriteria.verificationChecks || [],
    };

    const plan: Plan = {
      id: `gemini-plan-${Date.now()}`,
      taskInterpretation: llmOutput.taskIntent,
      assumptions: llmOutput.assumptions || [],
      actions,
      successCriteria: [
        "All required operations successfully executed",
        "Task-level success criteria verified against live DOM state",
      ],
      taskSuccessCriteria,
      potentialFailurePoints: llmOutput.potentialFailurePoints || [],
      requiredInformation: taskSuccessCriteria.requiredOutputs,
      revision: 0,
    };

    // Plan validation boundary — same as deterministic planner
    const taskIntent = SemanticDecomposer.decompose(sanitizedTask, observation ?? null, targetUrl);
    const validationResult = PlanValidator.validatePlan(plan, {
      task: sanitizedTask,
      taskIntent,
      targetUrl,
      observation: observation ?? null,
    });

    if (!validationResult.valid) {
      const allIssues = [...validationResult.securityViolations, ...validationResult.errors];
      throw new AgentError(
        `Gemini plan rejected by plan validator: ${allIssues.join("; ")}`,
        ErrorCode.VALIDATION_FAILED,
        false,
        { details: { issues: allIssues, warnings: validationResult.warnings } },
        "gemini"
      );
    }

    logger.info(
      `[GeminiPlanningInterface] Plan accepted with ${actions.length} actions. Reason for Gemini invocation: ${assistanceReason}`
    );

    return plan;
  }
}
