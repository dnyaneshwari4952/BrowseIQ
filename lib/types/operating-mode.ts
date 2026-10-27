import { z } from "zod";

/**
 * Operating Mode — Playwright-Only Architecture
 *
 * Playwright is the single, permanent browser execution engine.
 * All browser tasks (navigation, clicking, typing, extraction, forms, downloads, media)
 * execute exclusively via Playwright.
 *
 * AI models (Gemini / Grok) assist with natural language task planning and reasoning
 * where configured, but do not constitute a separate execution mode.
 */
export const OperatingModeSchema = z.enum(["playwright"]);
export type OperatingMode = z.infer<typeof OperatingModeSchema>;

export const DEFAULT_OPERATING_MODE: OperatingMode = "playwright";

/** Human-readable labels */
export const OPERATING_MODE_LABELS: Record<OperatingMode, string> = {
  playwright: "Playwright",
};

/** Short tooltip descriptions */
export const OPERATING_MODE_DESCRIPTIONS: Record<OperatingMode, string> = {
  playwright:
    "Playwright is the single browser execution engine. Live browser execution with AI planning where configured.",
};

/**
 * Validate a raw value as a known OperatingMode.
 * Returns the parsed value or throws a descriptive error.
 */
export function parseOperatingMode(raw: unknown): OperatingMode {
  if (raw === "playwright") {
    return "playwright";
  }
  throw new Error(
    `Invalid operating mode '${String(raw)}'. Playwright is the only supported execution engine.`
  );
}

/**
 * Safe coercion that returns the single supported execution mode ("playwright").
 * Safely migrates legacy stored preferences (e.g. "gemini_assisted") or missing values to "playwright".
 */
export function coerceOperatingMode(raw?: unknown): OperatingMode {
  return "playwright";
}
