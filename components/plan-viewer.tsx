"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Loader2,
  XCircle,
  GitBranch,
} from "lucide-react";
import { Plan } from "@/lib/types/plans";
import { ActionStatus } from "@/lib/types/actions";

export type GranularActionLifecycle =
  | "planned"
  | "attempting"
  | "executed"
  | "action_verified"
  | "task_verified"
  | "failed";

interface PlanViewerProps {
  plan?: Plan | null;
  currentStepIndex: number;
  stepStatuses?: Record<string, ActionStatus | GranularActionLifecycle | string>;
  isTaskVerified?: boolean;
}

export function PlanViewer({
  plan,
  currentStepIndex,
  stepStatuses = {},
  isTaskVerified = false,
}: PlanViewerProps) {
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

  /**
   * Determine exact granular lifecycle state for an action:
   * Planned -> Attempted -> Executed -> Action verified -> Task verified (or Failed)
   */
  const getActionLifecycle = (
    actionId: string,
    index: number
  ): { status: GranularActionLifecycle; label: string } => {
    const customStatus = stepStatuses[actionId] || stepStatuses[String(index)];

    if (customStatus === "failed" || customStatus === ActionStatus.FAILED) {
      return { status: "failed", label: "Failed" };
    }

    if (customStatus === "task_verified" || (isTaskVerified && index < currentStepIndex)) {
      return { status: "task_verified", label: "Task Verified" };
    }

    if (customStatus === "action_verified" || customStatus === ActionStatus.COMPLETED) {
      if (isTaskVerified) {
        return { status: "task_verified", label: "Task Verified" };
      }
      return { status: "action_verified", label: "Action Verified" };
    }

    if (customStatus === "executed") {
      return { status: "executed", label: "Executed (Verifying)" };
    }

    if (customStatus === "attempting" || customStatus === ActionStatus.EXECUTING || index === currentStepIndex) {
      return { status: "attempting", label: "Attempting" };
    }

    if (index < currentStepIndex) {
      return { status: "action_verified", label: "Action Verified" };
    }

    return { status: "planned", label: "Planned" };
  };

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
            const isCurrent = index === currentStepIndex;
            const lifecycle = getActionLifecycle(action.id, index);

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
                  {lifecycle.status === "task_verified" ? (
                    <span title="Task Verified"><CheckCircle2 className="w-4 h-4 text-[#5F9E7A] shrink-0" /></span>
                  ) : lifecycle.status === "action_verified" ? (
                    <span title="Action Verified"><ShieldCheck className="w-4 h-4 text-[#5F9E7A] shrink-0" /></span>
                  ) : lifecycle.status === "executed" ? (
                    <span title="Executed"><Loader2 className="w-4 h-4 text-[#C59A52] animate-spin shrink-0" /></span>
                  ) : lifecycle.status === "attempting" ? (
                    <span title="Attempting"><ArrowRight className="w-4 h-4 text-[#4F8EAD] shrink-0" /></span>
                  ) : lifecycle.status === "failed" ? (
                    <span title="Failed"><XCircle className="w-4 h-4 text-[#C96B6B] shrink-0" /></span>
                  ) : (
                    <span title="Planned"><Clock className="w-4 h-4 text-[#667784] shrink-0" /></span>
                  )}

                  <span className="text-[#1F2933] font-medium truncate">
                    {index + 1}. {action.reason || action.type}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {action.dependencies && action.dependencies.length > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] text-[#4F8EAD] bg-[#EEF6FB] border border-[#D9E8EF] font-medium flex items-center gap-0.5"
                      title={`Requires step(s): ${action.dependencies.join(", ")}`}
                    >
                      <GitBranch className="w-3 h-3" />
                      dep
                    </span>
                  )}
                  {action.risk && action.risk !== "low" && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] text-[#C59A52] bg-[#FFF9EE] border border-[#F2E5CE] font-semibold flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" />
                      {action.risk}
                    </span>
                  )}
                  <span
                    className={`text-[11px] font-medium ${
                      lifecycle.status === "task_verified" || lifecycle.status === "action_verified"
                        ? "text-[#5F9E7A]"
                        : lifecycle.status === "attempting"
                        ? "text-[#4F8EAD] font-semibold"
                        : lifecycle.status === "executed"
                        ? "text-[#C59A52] font-semibold"
                        : lifecycle.status === "failed"
                        ? "text-[#C96B6B] font-semibold"
                        : "text-[#667784]"
                    }`}
                  >
                    {lifecycle.label}
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
