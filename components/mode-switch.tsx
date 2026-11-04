"use client";

import React from "react";
import { Cpu } from "lucide-react";
import { OperatingMode } from "@/lib/types/operating-mode";

/**
 * ModeSwitch — Retired in Playwright-Only Architecture.
 *
 * Playwright is now the single, permanent execution engine.
 * The switch control is no longer rendered anywhere in the interface.
 * Returns null to safely satisfy any legacy imports without rendering DOM elements.
 */
export function ModeSwitch(_props?: unknown): null {
  return null;
}

/**
 * ExecutionEngineBadge (formerly ModeBadge)
 *
 * Displays the browser execution engine (always Playwright).
 * Does not display a selectable execution mode.
 */
export function ModeBadge({
  operatingMode = "playwright",
}: {
  operatingMode?: OperatingMode | string;
} = {}) {
  return (
    <span
      id="execution-engine-badge"
      title="Playwright executed all browser actions with deterministic planning."
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border bg-[#EEF6FB] text-[#24485A] border-[#D9E8EF] shadow-sm select-none"
    >
      <Cpu className="w-3.5 h-3.5 text-[#4F8EAD]" />
      <span>Playwright</span>
    </span>
  );
}
