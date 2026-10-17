"use client";

import React, { useState, useEffect } from "react";
import { Play, Square, RotateCcw, Globe, Sparkles } from "lucide-react";

interface TaskInputProps {
  onRun: (task: string, targetUrl?: string) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled?: boolean;
}

const PRESET_TASKS = [
  {
    label: "Product Search & Price",
    task: "Search the product page for laptop and return the first product's name and price.",
    url: "http://localhost:3000/test-fixtures/search",
  },
  {
    label: "Contact Form",
    task: "Fill the contact form with name and email, then submit.",
    url: "http://localhost:3000/test-fixtures/form",
  },
  {
    label: "PDF Invoice Download",
    task: "Download the latest invoice PDF document.",
    url: "http://localhost:3000/test-fixtures/download",
  },
  {
    label: "Fast Catalog API",
    task: "Query product catalog API for laptops",
    url: "http://localhost:3000/api/products?q=laptop",
  },
];

export function TaskInput({ onRun, onStop, isRunning, disabled }: TaskInputProps) {
  const [task, setTask] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || isRunning) return;
    onRun(task.trim(), targetUrl.trim() || undefined);
  };

  const handleClear = () => {
    setTask("");
    setTargetUrl("");
  };

  const selectPreset = (presetTask: string, presetUrl?: string) => {
    setTask(presetTask);
    if (presetUrl) setTargetUrl(presetUrl);
  };

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-5 shadow-card transition-shadow">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-[#24485A] flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#4F8EAD]" />
          What should I do?
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#667784] mr-1 hidden sm:inline">Try:</span>
          {PRESET_TASKS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => selectPreset(preset.task, preset.url)}
              disabled={isRunning}
              className="text-xs px-2.5 py-1 bg-[#EEF6FB] hover:bg-[#E3F1F8] text-[#24485A] font-medium rounded-md border border-[#D9E8EF] transition-colors disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleRun} className="space-y-3.5">
        <div className="relative" suppressHydrationWarning>
          {isMounted ? (
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              disabled={isRunning || disabled}
              placeholder="Search the product page for laptop and return the first product's name and price."
              rows={3}
              autoComplete="off"
              spellCheck={false}
              data-gramm="false"
              data-gramm_editor="false"
              data-enable-grammarly="false"
              suppressHydrationWarning
              className="w-full bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-3 text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#4F8EAD] focus:ring-2 focus:ring-[#4F8EAD]/15 text-sm font-sans resize-y transition-all"
            />
          ) : (
            <div
              className="w-full bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-3 text-[#667784] text-sm font-sans min-h-[86px] select-none"
              suppressHydrationWarning
            >
              Search the product page for laptop and return the first product&apos;s name and price.
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <div className="relative flex-1 w-full">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#667784]">
              <Globe className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={isRunning || disabled}
              autoComplete="off"
              spellCheck={false}
              suppressHydrationWarning
              placeholder="Optional target URL (e.g. http://localhost:3000/test-fixtures/search)"
              className="w-full pl-9 pr-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#4F8EAD] focus:ring-2 focus:ring-[#4F8EAD]/15 transition-all"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={handleClear}
              disabled={isRunning || (!task && !targetUrl)}
              className="px-3.5 py-2 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4 text-[#667784]" /> Clear
            </button>

            {isRunning ? (
              <button
                type="button"
                onClick={onStop}
                className="px-4 py-2 bg-[#C96B6B] hover:bg-[#B55B5B] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Square className="w-4 h-4" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!task.trim() || disabled}
                className="px-5 py-2 bg-[#4F8EAD] hover:bg-[#3D7692] text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <Play className="w-4 h-4" /> Run Task
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
