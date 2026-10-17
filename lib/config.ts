import { z } from "zod";

const EnvConfigSchema = z.object({
  // LLM Provider
  LLM_PROVIDER: z.enum(["openai", "anthropic", "gemini", "mock"]).default("openai"),
  LLM_API_KEY: z.string().default("mock-key"),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.0),
  LLM_MAX_TOKENS: z.coerce.number().positive().default(2048),

  // Gemini Specific Configuration (Official @google/genai SDK)
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),

  // Browser & Playwright
  BROWSER_HEADLESS: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),
  BROWSER_SLOW_MO: z.coerce.number().nonnegative().default(0),
  BROWSER_TIMEOUT: z.coerce.number().positive().default(30000),
  NAVIGATION_TIMEOUT: z.coerce.number().positive().default(30000),
  ELEMENT_TIMEOUT: z.coerce.number().positive().default(10000),
  DEFAULT_ACTION_TIMEOUT: z.coerce.number().positive().default(15000),
  VIEWPORT_WIDTH: z.coerce.number().positive().default(1280),
  VIEWPORT_HEIGHT: z.coerce.number().positive().default(800),

  // Safety & Guardrails
  TASK_TIMEOUT: z.coerce.number().positive().default(180000),
  MAX_ACTION_RETRIES: z.coerce.number().int().min(0).default(3),
  MAX_REPLANS: z.coerce.number().int().min(0).default(3),
  MAX_STEPS_PER_TASK: z.coerce.number().int().positive().default(25),
  REQUIRE_CONFIRMATION_FOR_HIGH_RISK: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),
  ALLOW_FILE_DOWNLOADS: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),
  DOWNLOAD_DIR: z.string().default("./downloads"),

  // Observability
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ENABLE_EXECUTION_TRACING: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),
  CAPTURE_SCREENSHOT_ON_FAILURE: z
    .string()
    .transform((val) => val === "true" || val === "1")
    .default("true"),

  // Server
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AgentConfig = z.infer<typeof EnvConfigSchema>;

let cachedConfig: AgentConfig | null = null;

export function getConfig(): AgentConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = EnvConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.format());
    throw new Error("Invalid application configuration");
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function resetConfigForTesting(overrides?: Partial<AgentConfig>): AgentConfig {
  const base = EnvConfigSchema.parse({});
  cachedConfig = { ...base, ...overrides };
  return cachedConfig;
}
