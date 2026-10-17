"use client";

import React, { useState } from "react";
import { Sliders, X, Check, Save } from "lucide-react";

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const [headless, setHeadless] = useState(true);
  const [actionTimeout, setActionTimeout] = useState(15000);
  const [maxRetries, setMaxRetries] = useState(3);
  const [maxReplans, setMaxReplans] = useState(3);
  const [requireConfirmation, setRequireConfirmation] = useState(true);
  const [saved, setSaved] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#24485A]/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg max-w-lg w-full p-6 shadow-dropdown space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-[#D9E8EF] pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[#4F8EAD]" />
            <h3 className="text-base font-semibold text-[#24485A]">Agent & Automation Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#667784] hover:text-[#24485A] rounded hover:bg-[#F0F7FA] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3.5 text-xs">
          <div className="flex items-center justify-between p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg">
            <div>
              <div className="font-semibold text-[#24485A]">Headless Browser Mode</div>
              <div className="text-[#667784] text-[11px]">Run browser in background without visible window</div>
            </div>
            <input
              type="checkbox"
              checked={headless}
              onChange={(e) => setHeadless(e.target.checked)}
              className="w-4 h-4 accent-[#4F8EAD] rounded cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg">
            <div>
              <div className="font-semibold text-[#24485A]">High-Risk Action Guardrail</div>
              <div className="text-[#667784] text-[11px]">Require explicit human confirmation for submissions or deletions</div>
            </div>
            <input
              type="checkbox"
              checked={requireConfirmation}
              onChange={(e) => setRequireConfirmation(e.target.checked)}
              className="w-4 h-4 accent-[#4F8EAD] rounded cursor-pointer"
            />
          </div>

          <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="font-semibold text-[#24485A]">Default Action Timeout</span>
              <span className="font-mono text-[#4F8EAD] font-semibold">{actionTimeout / 1000}s</span>
            </div>
            <input
              type="range"
              min="5000"
              max="60000"
              step="5000"
              value={actionTimeout}
              onChange={(e) => setActionTimeout(Number(e.target.value))}
              className="w-full accent-[#4F8EAD] cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-1">
              <label className="font-semibold text-[#24485A] block">Max Retries</label>
              <input
                type="number"
                min="0"
                max="5"
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="w-full bg-[#FFFFFF] border border-[#D9E8EF] rounded p-1.5 text-[#1F2933] font-mono focus:outline-none focus:border-[#6FA8C5]"
              />
            </div>
            <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-1">
              <label className="font-semibold text-[#24485A] block">Max Replans</label>
              <input
                type="number"
                min="0"
                max="5"
                value={maxReplans}
                onChange={(e) => setMaxReplans(Number(e.target.value))}
                className="w-full bg-[#FFFFFF] border border-[#D9E8EF] rounded p-1.5 text-[#1F2933] font-mono focus:outline-none focus:border-[#6FA8C5]"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#D9E8EF]">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] rounded text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 bg-[#4F8EAD] hover:bg-[#437B96] text-white rounded text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{saved ? "Saved" : "Save Changes"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
