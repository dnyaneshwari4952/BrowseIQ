import { z } from "zod";

/**
 * Strict ActionType enum according to Section 5
 */
export const ActionType = {
  NAVIGATE: "navigate",
  BACK: "back",
  FORWARD: "forward",
  RELOAD: "reload",
  CLICK: "click",
  DOUBLE_CLICK: "doubleClick",
  FILL: "fill",
  TYPE: "type",
  PRESS: "press",
  SELECT: "select",
  CHECK: "check",
  UNCHECK: "uncheck",
  HOVER: "hover",
  SCROLL: "scroll",
  WAIT: "wait",
  EXTRACT_TEXT: "extractText",
  EXTRACT_ATTRIBUTE: "extractAttribute",
  EXTRACT_TABLE: "extractTable",
  SCREENSHOT: "screenshot",
  DOWNLOAD: "download",
  UPLOAD: "upload",
  OPEN_NEW_TAB: "openNewTab",
  SWITCH_TAB: "switchTab",
  CLOSE_TAB: "closeTab",
  MEDIA_PLAY: "mediaPlay",
  MEDIA_PAUSE: "mediaPause",
  MEDIA_MUTE: "mediaMute",
  MEDIA_SEEK: "mediaSeek",
  MEDIA_VOLUME: "mediaVolume",
  EVALUATE_SAFE: "evaluateSafe",
  ASSERT: "assert",
  INSPECT: "inspect",
  REQUEST_CLARIFICATION: "requestClarification",
  FINISH: "finish",
} as const;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/**
 * Risk classification according to Section 22
 */
export const RiskLevel = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;

export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

/**
 * Target locator strategies adhering to Section 8 hierarchy
 */
export const LocatorStrategy = {
  ROLE: "role",
  LABEL: "label",
  PLACEHOLDER: "placeholder",
  TEXT: "text",
  TEST_ID: "testId",
  NAME: "name",
  ID: "id",
  CSS: "css",
  ACCESSIBLE_ATTR: "accessibleAttr",
  XPATH: "xpath",
} as const;

export type LocatorStrategy = (typeof LocatorStrategy)[keyof typeof LocatorStrategy];

export const ElementTargetSchema = z.object({
  strategy: z.enum([
    LocatorStrategy.ROLE,
    LocatorStrategy.LABEL,
    LocatorStrategy.PLACEHOLDER,
    LocatorStrategy.TEXT,
    LocatorStrategy.TEST_ID,
    LocatorStrategy.NAME,
    LocatorStrategy.ID,
    LocatorStrategy.CSS,
    LocatorStrategy.ACCESSIBLE_ATTR,
    LocatorStrategy.XPATH,
  ]),
  value: z.string().min(1, "Target value cannot be empty"),
  role: z.string().optional(),
  name: z.string().optional(),
  exact: z.boolean().default(false).optional(),
  index: z.number().int().nonnegative().optional(),
  container: z.string().optional(),
  description: z.string().optional(),
});

export type ElementTarget = z.infer<typeof ElementTargetSchema>;

export const ExpectedStateSchema = z.object({
  urlChange: z.boolean().optional(),
  expectedUrlPattern: z.string().optional(),
  elementAppears: z.string().optional(),
  elementDisappears: z.string().optional(),
  expectedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  textContains: z.string().optional(),
});

export type ExpectedState = z.infer<typeof ExpectedStateSchema>;

export const RetryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(3).optional(),
  backoffMs: z.number().int().min(0).max(10000).default(500).optional(),
  retryOn: z.array(z.string()).optional(),
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const ActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    ActionType.NAVIGATE,
    ActionType.BACK,
    ActionType.FORWARD,
    ActionType.RELOAD,
    ActionType.CLICK,
    ActionType.DOUBLE_CLICK,
    ActionType.FILL,
    ActionType.TYPE,
    ActionType.PRESS,
    ActionType.SELECT,
    ActionType.CHECK,
    ActionType.UNCHECK,
    ActionType.HOVER,
    ActionType.SCROLL,
    ActionType.WAIT,
    ActionType.EXTRACT_TEXT,
    ActionType.EXTRACT_ATTRIBUTE,
    ActionType.EXTRACT_TABLE,
    ActionType.SCREENSHOT,
    ActionType.DOWNLOAD,
    ActionType.UPLOAD,
    ActionType.OPEN_NEW_TAB,
    ActionType.SWITCH_TAB,
    ActionType.CLOSE_TAB,
    ActionType.MEDIA_PLAY,
    ActionType.MEDIA_PAUSE,
    ActionType.MEDIA_MUTE,
    ActionType.MEDIA_SEEK,
    ActionType.MEDIA_VOLUME,
    ActionType.EVALUATE_SAFE,
    ActionType.ASSERT,
    ActionType.INSPECT,
    ActionType.REQUEST_CLARIFICATION,
    ActionType.FINISH,
  ]),
  target: ElementTargetSchema.optional(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.record(z.unknown())]).optional(),
  attributeName: z.string().optional(),
  timeout: z.number().int().positive().default(15000).optional(),
  retries: RetryPolicySchema.default({ maxRetries: 3, backoffMs: 500 }).optional(),
  expectedState: ExpectedStateSchema.optional(),
  risk: z.enum([RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH]).default(RiskLevel.LOW).optional(),
  reason: z.string().min(1, "Every action must provide a human-readable reason"),
  /** Structured user intent associated with this specific action */
  userIntent: z.string().optional(),
  /** High-level semantic description of the target element or interaction boundary */
  targetDescription: z.string().optional(),
  /** Structured input parameters passed to this action */
  parameters: z.record(z.unknown()).optional(),
  /** Explicit preconditions required before this action may execute */
  preconditions: z.array(z.string()).default([]).optional(),
  /** Expected observable postconditions verified upon action completion */
  postconditions: z.array(z.string()).default([]).optional(),
  /** Explicit list of prior action IDs that must succeed before this action executes */
  dependencies: z.array(z.string()).default([]).optional(),
  /** Method used to independently verify action state transition */
  verificationMethod: z.string().optional(),
  /** Target metric, element, or property verified by the verificationMethod */
  verificationTarget: z.string().optional(),
});

export type Action = z.infer<typeof ActionSchema>;

export const ActionStatus = {
  PENDING: "pending",
  VALIDATING: "validating",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];

export interface ActionExecutionResult {
  actionId: string;
  stepIndex?: number;
  taskId?: string;
  userIntent?: string;
  type: ActionType;
  status: ActionStatus;
  currentUrl?: string;
  targetDescription?: string;
  validationResult?: {
    valid: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    skipAction?: boolean;
    strategyUsed?: string;
    isSafeToRetry?: boolean;
  };
  startTime: string;
  endTime: string;
  durationMs: number;
  extractedData?: unknown;
  screenshot?: string;
  downloadPath?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    recoverable?: boolean;
    category?: string;
  };
  retriesUsed: number;
  replansUsed?: number;
  resultingState?: {
    url: string;
    title: string;
    isSettled?: boolean;
    elementState?: Record<string, unknown>;
  };
  verificationEvidence?: Record<string, unknown>;
  verified: boolean;
}

