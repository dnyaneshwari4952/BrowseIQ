"use client";

import React, { useRef, useEffect } from "react";
import { Terminal, Shield, Check, AlertCircle, Info, RefreshCw } from "lucide-react";
import { ExecutionEvent } from "@/lib/observability/trace";

interface ActionLogProps {
  events: ExecutionEvent[];
}

export function ActionLog({ events }: ActionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const getEventIcon = (type: string) => {
    if (type.includes("VALIDATION")) return <Shield className="w-3.5 h-3.5 text-[#C59A52]" />;
    if (type.includes("VERIFICATION") || type.includes("COMPLETED")) return <Check className="w-3.5 h-3.5 text-[#5F9E7A]" />;
    if (type.includes("FAILED")) return <AlertCircle className="w-3.5 h-3.5 text-[#C96B6B]" />;
    if (type.includes("RETRY") || type.includes("REPLAN")) return <RefreshCw className="w-3.5 h-3.5 text-[#4F8EAD]" />;
    return <Info className="w-3.5 h-3.5 text-[#4F8EAD]" />;
  };

  const getTypeColor = (type: string) => {
    if (type.includes("FAILED")) return "text-[#C96B6B]";
    if (type.includes("VERIFICATION") || type.includes("COMPLETED")) return "text-[#5F9E7A]";
    if (type.includes("VALIDATION")) return "text-[#C59A52]";
    return "text-[#24485A]";
  };

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-4 shadow-card space-y-3">
      <div className="flex items-center justify-between border-b border-[#D9E8EF] pb-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#4F8EAD]" />
          <h3 className="text-sm font-semibold text-[#24485A]">Live Execution Trace</h3>
        </div>
        <span className="text-xs font-mono text-[#667784]">{events.length} events logged</span>
      </div>

      <div
        ref={scrollRef}
        className="space-y-1.5 max-h-[300px] overflow-y-auto font-mono text-xs pr-1 scroll-smooth"
      >
        {events.length === 0 ? (
          <div className="text-center py-8 text-[#667784]">
            Awaiting task execution events...
          </div>
        ) : (
          events.map((ev) => {
            const time = new Date(ev.timestamp).toLocaleTimeString([], {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={ev.id}
                className="p-2 rounded bg-[#F7FAFC] border border-[#D9E8EF] flex items-start gap-2 hover:bg-[#EEF6FB] transition-colors"
              >
                <span className="text-[#667784] shrink-0 text-[11px]">{time}</span>
                <span className="shrink-0 mt-0.5">{getEventIcon(ev.type)}</span>
                <div className="overflow-hidden flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold text-[11px] uppercase tracking-wide ${getTypeColor(ev.type)}`}>
                      {ev.type}
                    </span>
                  </div>
                  <div className="text-[#1F2933] text-[11px] mt-0.5 break-words font-sans">
                    {ev.message}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
