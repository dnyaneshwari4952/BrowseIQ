"use client";

import React, { useState } from "react";
import { CheckCircle2, Clock, AlertTriangle, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { Plan } from "@/lib/types/plans";
import { ActionStatus } from "@/lib/types/actions";

interface PlanViewerProps {
  plan?: Plan | null;
  currentStepIndex: number;
  stepStatuses?: Record<string, ActionStatus>;
}

export function PlanViewer({ plan, currentStepIndex, stepStatuses = {} }: PlanViewerProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!plan) {
    return (
      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-5 shadow-card flex flex-col items-center justify-center min-h-[140px] text-center">
        <p className="text-[#667784] text-xs">No execution plan created yet.</p>
      </div>
    );
  }

  const routeLabel =
    plan.routeDecision?.route === "api" ? "Using fast catalog API" : "Using browser";

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-4.5 shadow-card space-y-3">
      <div className="flex items-center justify-between gap-2 border-b border-[#D9E8EF] pb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-[#24485A]">Plan</h3>
          <span className="text-[11px] text-[#667784] font-medium">
            ({plan.actions.length} steps)
          </span>
          <span className="text-[11px] bg-[#EEF6FB] text-[#4F8EAD] px-2 py-0.5 rounded border border-[#D9E8EF] font-medium">
            {routeLabel}
          </span>
          {typeof plan.revision === "number" && plan.revision > 0 && (
            <span className="text-[11px] bg-[#FFF9EE] text-[#C59A52] border border-[#F2E5CE] px-2 py-0.5 rounded font-medium">
              Revision {plan.revision}
            </span>
          )}
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-[#667784] hover:text-[#24485A] flex items-center gap-1 font-medium transition-colors"
        >
          {isExpanded ? (
            <>
              Hide steps <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Show steps <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
          {plan.actions.map((action, index) => {
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;

            return (
              <div
                key={action.id || index}
                className={`border rounded-lg p-2.5 transition-all text-xs flex items-center justify-between gap-3 ${
                  isCurrent
                    ? "border-[#4F8EAD] bg-[#EEF6FB]"
                    : "border-[#D9E8EF] bg-[#FFFFFF]"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-[#5F9E7A] shrink-0" />
                  ) : isCurrent ? (
                    <ArrowRight className="w-4 h-4 text-[#4F8EAD] shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-[#667784] shrink-0" />
                  )}

                  <span className="text-[#1F2933] font-medium truncate">
                    {index + 1}. {action.reason || action.type}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {action.risk && action.risk !== "low" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] text-[#C59A52] bg-[#FFF9EE] border border-[#F2E5CE] font-semibold flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" />
                      {action.risk}
                    </span>
                  )}
                  <span
                    className={`text-[11px] font-medium ${
                      isCompleted
                        ? "text-[#5F9E7A]"
                        : isCurrent
                        ? "text-[#4F8EAD] font-semibold"
                        : "text-[#667784]"
                    }`}
                  >
                    {isCompleted ? "Done" : isCurrent ? "Active" : "Pending"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
