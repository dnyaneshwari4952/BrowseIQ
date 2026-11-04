import { z } from "zod";

/**
 * Operating Mode — Playwright-Only Architecture
 *
 * Playwright is the single, permanent browser execution engine.
 * All browser tasks (navigation, clicking, typing, extraction, forms, downloads, media)
 * execute exclusively via Playwright.
 *
 * Deterministic planning and reasoning drives Playwright execution.
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
    "Playwright is the single browser execution engine. Live browser execution with deterministic planning.",
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
 * Safely migrates legacy stored preferences or missing values to "playwright".
 */
export function coerceOperatingMode(raw?: unknown): OperatingMode {
  return "playwright";
}
