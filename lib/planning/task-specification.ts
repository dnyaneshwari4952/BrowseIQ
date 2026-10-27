import { z } from "zod";

/**
 * Supported general browser operations (Section 5)
 */
export const BrowserOperationTypeSchema = z.enum([
  "NAVIGATE",
  "SEARCH",
  "COMPARE",
  "FILTER",
  "COUNT",
  "EXTRACT",
  "INSPECT",
  "FORM_FILL",
  "FORM_SUBMIT",
  "FORM_DRAFT",
  "DOWNLOAD",
  "UPLOAD",
  "OPEN_TAB",
  "SWITCH_TAB",
  "CLOSE_TAB",
  "HISTORY_BACK",
  "HISTORY_FORWARD",
  "RELOAD",
  "CLICK",
  "HOVER",
  "SCROLL",
  "MEDIA_PLAY",
  "LOCAL_MEDIA_PLAY",
  "MEDIA_PAUSE",
  "MEDIA_MUTE",
  "PAGINATE",
  "SELECT_OPTION",
  "WAIT_DYNAMIC",
  "UNSUPPORTED",
  "AMBIGUOUS",
]);

export type BrowserOperationType = z.infer<typeof BrowserOperationTypeSchema>;

/**
 * Ordering constraint specification
 */
export const OrderingConstraintSchema = z.object({
  direction: z.enum(["ASCENDING", "DESCENDING", "MIN", "MAX"]),
  field: z.string().default("price"),
  rawExpression: z.string().optional(),
});

export type OrderingConstraint = z.infer<typeof OrderingConstraintSchema>;

/**
 * Filter constraint specification (e.g. price < 50000, brand == Sony)
 */
export const FilterConstraintSchema = z.object({
  field: z.string(),
  operator: z.enum(["<", "<=", ">", ">=", "==", "!=", "CONTAINS"]),
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  rawExpression: z.string().optional(),
});

export type FilterConstraint = z.infer<typeof FilterConstraintSchema>;

/**
 * Ordinal selection constraint (e.g. "second result", "first item", "last product")
 */
export const OrdinalConstraintSchema = z.object({
  target: z.enum(["first", "second", "third", "fourth", "fifth", "last", "nth"]),
  index: z.number().int().nonnegative(),
  rawExpression: z.string().optional(),
});

export type OrdinalConstraint = z.infer<typeof OrdinalConstraintSchema>;

/**
 * Negative constraint (e.g. "do not submit", "without buying", "stay on page")
 */
export const NegativeConstraintSchema = z.object({
  operation: z.enum(["submit", "purchase", "add_to_cart", "navigate", "delete", "download", "open"]),
  forbidden: z.boolean().default(true),
  reason: z.string().optional(),
  rawPhrase: z.string().optional(),
});

export type NegativeConstraint = z.infer<typeof NegativeConstraintSchema>;

/**
 * Verification criterion specification (Section 3 & 4G)
 */
export const VerificationCriterionSchema = z.object({
  id: z.string(),
  description: z.string(),
  type: z.enum([
    "STATE_OBSERVED",
    "OUTPUT_EXTRACTED",
    "URL_MATCHED",
    "FILE_DOWNLOADED",
    "FORBIDDEN_ACTION_AVOIDED",
    "ELEMENT_VISIBLE",
  ]),
  expectedKey: z.string().optional(),
  expectedValue: z.unknown().optional(),
  forbidden: z.boolean().default(false).optional(),
});

export type VerificationCriterion = z.infer<typeof VerificationCriterionSchema>;

/**
 * Structured Task Specification (Section 3)
 * Complete, typed, runtime-validated contract representing user instruction semantics
 */
export const TaskSpecificationSchema = z.object({
  id: z.string(),
  originalInstruction: z.string().min(1, "Original instruction is required"),
  inferredGoal: z.string().min(1, "Inferred goal is required"),
  operation: BrowserOperationTypeSchema,

  // Entity & target resolution
  targetEntity: z.string().optional(),
  targetWebsite: z.string().optional(),
  targetUrl: z.string().url().optional(),

  // Local File Task scope & properties (Requirement 2)
  taskScope: z.enum(["website", "local_file", "mixed"]).default("website").optional(),
  isLocalFile: z.boolean().default(false).optional(),
  localFileScope: z
    .object({
      targetTitle: z.string().optional(),
      targetDirectory: z.string().optional(),
      filePattern: z.string().optional(),
      mediaType: z.enum(["audio", "video", "document", "any"]).default("audio").optional(),
    })
    .optional(),

  // Structured task intent & result category
  resultType: z.enum(["media", "product", "article", "general"]).default("general").optional(),
  actionIntent: z.enum(["search", "open", "play", "compare", "extract", "fill", "general"]).default("general").optional(),

  // Search parameters
  searchQuery: z.string().optional(),

  // Constraints
  ordering: OrderingConstraintSchema.optional(),
  filters: z.array(FilterConstraintSchema).default([]),
  ordinal: OrdinalConstraintSchema.optional(),
  negations: z.array(NegativeConstraintSchema).default([]),
  windowLimit: z.number().int().positive().optional(),

  // Media / file properties
  fileProperties: z
    .object({
      filename: z.string().optional(),
      extension: z.string().optional(),
      expectedType: z.string().optional(),
      destination: z.string().optional(),
    })
    .optional(),

  mediaProperties: z
    .object({
      mediaType: z.enum(["video", "audio", "stream"]).optional(),
      action: z.enum(["play", "pause", "mute", "unmute", "seek", "stop"]).optional(),
      targetTitle: z.string().optional(),
    })
    .optional(),

  // Source & Destination
  sourceAndDestination: z
    .object({
      source: z.string().optional(),
      destination: z.string().optional(),
    })
    .optional(),

  // Scope restrictions
  scopeRestrictions: z.array(z.string()).default([]),

  // Scope & state
  expectedFinalState: z.string().optional(),
  preconditions: z.array(z.string()).default([]),
  requiredEvidence: z.array(z.string()).default([]),
  verificationCriteria: z.array(VerificationCriterionSchema).default([]),

  // Decision & clarification
  confidence: z.number().min(0).max(1),
  isAmbiguous: z.boolean().default(false),
  ambiguityReason: z.string().optional(),
  clarificationQuestion: z.string().optional(),

  // Safety & risk
  isConsequential: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
  isUnsupported: z.boolean().default(false),
  unsupportedReason: z.string().optional(),

  // Execution metadata
  needsMultipleSteps: z.boolean().default(true),
  missingFields: z.array(z.string()).default([]),
  timestamp: z.string(),
});

export type TaskSpecification = z.infer<typeof TaskSpecificationSchema>;
