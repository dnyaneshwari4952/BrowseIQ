"use client";

import React, { useState } from "react";
import { Eye, Search, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { PageObservation } from "@/lib/types/browser";

interface BrowserStateProps {
  observation?: PageObservation | null;
}

export function BrowserState({ observation }: BrowserStateProps) {
  const [filter, setFilter] = useState<"all" | "button" | "input" | "link">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  if (!observation) {
    return (
      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-5 shadow-card flex flex-col items-center justify-center min-h-[140px] text-center">
        <p className="text-[#667784] text-xs">No page observed yet.</p>
      </div>
    );
  }

  const interactiveCount = observation.interactiveElements.filter((el) => el.isVisible && el.isEnabled).length;

  const filteredElements = observation.interactiveElements.filter((el) => {
    if (filter === "button" && el.role !== "button" && el.tagName !== "BUTTON") return false;
    if (filter === "input" && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && el.role !== "textbox") return false;
    if (filter === "link" && el.role !== "link" && el.tagName !== "A") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchText = (el.text || "").toLowerCase().includes(q);
      const matchName = (el.name || "").toLowerCase().includes(q);
      const matchPlaceholder = (el.placeholder || "").toLowerCase().includes(q);
      const matchId = (el.id || "").toLowerCase().includes(q);
      return matchText || matchName || matchPlaceholder || matchId;
    }

    return true;
  });

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-4.5 shadow-card space-y-3">
      {/* Concise Summary First (Part 30) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D9E8EF] pb-3">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-[#4F8EAD]" />
          <h3 className="text-xs font-semibold text-[#24485A]">Page Details</h3>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-[#4F8EAD] hover:text-[#3D7692] flex items-center gap-1 font-medium transition-colors"
        >
          {isExpanded ? (
            <>
              Hide elements <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Inspect {observation.interactiveElements.length} elements <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {/* Summary Box */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
        <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-2.5">
          <div className="text-[11px] text-[#667784] font-medium">Current Page</div>
          <div className="font-semibold text-[#24485A] truncate" title={observation.title}>
            {observation.title || "Untitled"}
          </div>
        </div>

        <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-2.5">
          <div className="text-[11px] text-[#667784] font-medium">Elements Detected</div>
          <div className="font-semibold text-[#24485A]">
            {observation.interactiveElements.length}
          </div>
        </div>

        <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-2.5">
          <div className="text-[11px] text-[#667784] font-medium">Interactive Controls</div>
          <div className="font-semibold text-[#5F9E7A]">
            {interactiveCount} active
          </div>
        </div>
      </div>

      {/* Expandable Element Inspection List */}
      {isExpanded && (
        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#667784]" />
              <input
                type="text"
                placeholder="Search detected elements..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1 text-xs bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#4F8EAD]"
              />
            </div>

            <div className="flex items-center bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-0.5 text-xs">
              {(["all", "button", "input", "link"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={`px-2.5 py-0.5 rounded capitalize transition-colors ${
                    filter === t
                      ? "bg-[#4F8EAD] text-white font-medium"
                      : "text-[#667784] hover:text-[#24485A]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
            {filteredElements.length === 0 ? (
              <div className="text-center py-6 text-xs text-[#667784]">
                No elements matching criteria.
              </div>
            ) : (
              filteredElements.map((el) => (
                <div
                  key={el.id}
                  className="p-2.5 bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg text-xs flex items-center justify-between gap-3 hover:bg-[#F0F7FA] transition-colors"
                >
                  <div className="space-y-0.5 overflow-hidden">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase font-semibold text-[#24485A] bg-[#EEF6FB] border border-[#D9E8EF] px-1.5 py-0.5 rounded">
                        {el.role || el.tagName}
                      </span>
                      <span className="text-[#1F2933] font-medium truncate">
                        {el.name || el.text || el.placeholder || el.value || `<${el.tagName.toLowerCase()}>`}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[11px] font-medium ${
                        el.isVisible ? "text-[#5F9E7A]" : "text-[#667784]"
                      }`}
                    >
                      {el.isVisible ? "Visible" : "Hidden"}
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        el.isEnabled ? "text-[#5F9E7A]" : "text-[#C96B6B]"
                      }`}
                    >
                      {el.isEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
