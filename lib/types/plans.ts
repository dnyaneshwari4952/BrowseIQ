import { z } from "zod";
import { ActionSchema } from "./actions";

/**
 * Route decision between API and Browser automation (Section 11 & 12)
 */
export const RouteDecisionSchema = z.object({
  route: z.enum(["api", "browser"]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  fallbackAvailable: z.boolean(),
  apiIntegrationId: z.string().optional(),
});

export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

/**
 * Task-level success criteria schema (Part 4)
 * Distinguishes Action Verification from Task Completion Verification
 */
export const TaskSuccessCriteriaSchema = z.object({
  taskId: z.string().optional(),
  requiredOperations: z.array(z.string()).default([]),
  requiredState: z.record(z.unknown()).default({}).optional(),
  requiredOutputs: z.array(z.string()).default([]),
  verificationChecks: z.array(z.string()).default([]),
  completionConditions: z.array(z.string()).default([]).optional(),
});

export type TaskSuccessCriteria = z.infer<typeof TaskSuccessCriteriaSchema>;

/**
 * Structured Plan schema produced by LLM Planner (Section 6 & Part 4)
 */
export const PlanSchema = z.object({
  id: z.string(),
  taskInterpretation: z.string(),
  assumptions: z.array(z.string()).default([]).optional(),
  actions: z.array(ActionSchema),
  successCriteria: z.array(z.string()),
  taskSuccessCriteria: TaskSuccessCriteriaSchema.optional(),
  potentialFailurePoints: z.array(z.string()).default([]).optional(),
  requiredInformation: z.array(z.string()).default([]).optional(),
  routeDecision: RouteDecisionSchema.default({
    route: "browser",
    reason: "Default browser route",
    confidence: 1.0,
    fallbackAvailable: false,
  }).optional(),
  revision: z.number().int().nonnegative().default(0).optional(),
  taskSpec: z.any().optional(),
  status: z.enum(["active", "cancelled", "completed", "failed"]).optional(),
});

export type Plan = z.infer<typeof PlanSchema>;

/**
 * Strict LLM output schema for structured plan synthesis (Part 3)
 */
export const LLMPlanOutputSchema = z.object({
  taskIntent: z.string().min(1, "taskIntent is required"),
  assumptions: z.array(z.string()).default([]),
  successCriteria: TaskSuccessCriteriaSchema,
  actions: z.array(ActionSchema).min(1, "At least one action must be planned"),
  potentialFailurePoints: z.array(z.string()).default([]).optional(),
});

export type LLMPlanOutput = z.infer<typeof LLMPlanOutputSchema>;

/**
 * Semantic Task Intent (Phase 2A & 2F & 2G)
 * Structured representation of natural language user goal before browser action synthesis
 */
export const TaskIntentSchema = z.object({
  intentType: z.enum([
    "SEARCH",
    "SEARCH_AND_COMPARE",
    "SEARCH_AND_FILTER",
    "SEARCH_AND_COUNT",
    "SEARCH_AND_SELECT",
    "FORM_FILL",
    "FORM_SUBMIT",
    "FORM_DRAFT",
    "DOWNLOAD",
    "OPEN_TAB",
    "DYNAMIC_WAIT_AND_EXTRACT",
    "EXTRACT",
    "CONTENT_INSPECT",
    "NAVIGATION",
    "CLICK_ELEMENT",
    "MEDIA_PLAY",
    "LOCAL_MEDIA_PLAY",
    "AMBIGUOUS_ACTION",
    "DESTRUCTIVE_UNSUPPORTED",
    "PROMPT_INJECTION_DEFENSE",
  ]),
  taskScope: z.enum(["website", "local_file", "mixed"]).default("website").optional(),
  localFileDetails: z
    .object({
      targetTitle: z.string().optional(),
      targetDirectoryType: z.enum(["downloads", "documents", "music", "desktop", "videos", "whole_computer", "custom", "unknown"]).optional(),
      explicitPath: z.string().optional(),
      mediaType: z.enum(["audio", "video", "image", "document", "any"]).default("audio").optional(),
    })
    .optional(),
  rawTask: z.string(),
  entity: z.string().optional(),
  query: z.string().optional(),
  windowLimit: z.number().int().positive().optional(),
  comparison: z
    .object({
      operation: z.enum(["MIN", "MAX", "COUNT", "FILTER", "SORT"]),
      field: z.string(),
    })
    .optional(),
  filter: z
    .object({
      field: z.string(),
      operator: z.enum(["<", "<=", ">", ">=", "==", "!="]),
      value: z.union([z.number(), z.string()]),
    })
    .optional(),
  ordinal: z
    .object({
      target: z.enum(["first", "second", "third", "fourth", "last", "nth"]),
      index: z.number().int().nonnegative(),
    })
    .optional(),
  aggregation: z.enum(["COUNT", "SUM", "AVG", "LIST"]).optional(),
  negation: z
    .object({
      operation: z.string(),
      forbidden: z.boolean(),
    })
    .optional(),
  requestedOutputs: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).default("low"),
  requiresClarification: z.boolean().default(false).optional(),
  clarificationReason: z.string().optional(),
  isUnsupported: z.boolean().default(false).optional(),
  unsupportedReason: z.string().optional(),
  dynamicWaitTarget: z.string().optional(),
});

export type TaskIntent = z.infer<typeof TaskIntentSchema>;

/**
 * State Machine states (Section 15)
 */
export const AgentState = {
  IDLE: "IDLE",
  UNDERSTANDING: "UNDERSTANDING",
  PLANNING: "PLANNING",
  OBSERVING: "OBSERVING",
  VALIDATING: "VALIDATING",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  RECOVERING: "RECOVERING",
  REPLANNING: "REPLANNING",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type AgentState = (typeof AgentState)[keyof typeof AgentState];
