"use client";

import React from "react";
import { Cpu, Sparkles } from "lucide-react";
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
 * Displays the browser execution engine (always Playwright) and indicates
 * whether AI natural-language planning assistance was utilized for the task.
 * Does not display a selectable execution mode.
 */
export function ModeBadge({
  operatingMode = "playwright",
  geminiInvoked,
}: {
  operatingMode?: OperatingMode | string;
  geminiInvoked?: boolean;
}) {
  return (
    <span
      id="execution-engine-badge"
      title={
        geminiInvoked
          ? "Playwright executed all browser actions. Gemini assisted with task planning."
          : "Playwright executed all browser actions with deterministic planning."
      }
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border bg-[#EEF6FB] text-[#24485A] border-[#D9E8EF] shadow-sm select-none"
    >
      <Cpu className="w-3.5 h-3.5 text-[#4F8EAD]" />
      <span>Playwright</span>
      {geminiInvoked && (
        <span className="flex items-center gap-1 text-[#7B5EA7] pl-1.5 border-l border-[#D9E8EF] font-medium text-[10px]">
          <Sparkles className="w-3 h-3 text-[#7B5EA7]" />
          <span>AI-Planned</span>
        </span>
      )}
    </span>
  );
}
