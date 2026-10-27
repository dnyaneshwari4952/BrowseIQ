"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, AlertCircle, XCircle, HelpCircle, ShieldAlert } from "lucide-react";
import { AgentState } from "@/lib/types/plans";

interface ExecutionPanelProps {
  state: AgentState;
  lifecycleState?: string;
  finalStatus?: string;
  currentUrl?: string;
  currentPageTitle?: string;
  currentActionName?: string;
  startTime?: string;
  totalSteps?: number;
  currentStepIndex?: number;
  statusMessage?: string;
  browserWindow?: {
    taskId?: string;
    isVisible?: boolean;
    isOpen?: boolean;
  };
}

export function ExecutionPanel({
  state,
  lifecycleState,
  finalStatus,
  currentUrl,
  currentPageTitle,
  currentActionName,
  startTime,
  totalSteps = 0,
  currentStepIndex = 0,
  statusMessage,
  browserWindow,
}: ExecutionPanelProps) {
  const [elapsedSec, setElapsedSec] = useState(0);

  const isNeedsClarification =
    state === AgentState.WAITING_FOR_USER ||
    lifecycleState === "needs_clarification" ||
    lifecycleState === "waiting_for_user" ||
    finalStatus === "needs_clarification" ||
    finalStatus === "waiting_for_user";

  const isBlocked =
    lifecycleState === "blocked" || finalStatus === "blocked";

  const isCompleted =
    state === AgentState.COMPLETED ||
    lifecycleState === "completed" ||
    lifecycleState === "success" ||
    lifecycleState === "partial_success" ||
    finalStatus === "completed" ||
    finalStatus === "partial_success";

  const isCancelled =
    state === AgentState.CANCELLED || lifecycleState === "cancelled" || finalStatus === "cancelled";

  const isFailed =
    (state === AgentState.FAILED && !isBlocked) ||
    lifecycleState === "failed" ||
    finalStatus === "failed" ||
    finalStatus === "timed_out" ||
    finalStatus === "unsupported_task";

  const isRunning =
    !isNeedsClarification &&
    !isBlocked &&
    !isCompleted &&
    !isFailed &&
    !isCancelled &&
    state !== AgentState.IDLE &&
    !finalStatus;

  useEffect(() => {
    if (!startTime || !isRunning) {
      if (!startTime) {
        setElapsedSec(0);
      }
      return;
    }
    const start = new Date(startTime).getTime();
    const interval = setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    }, 500);

    return () => clearInterval(interval);
  }, [startTime, isRunning]);

  if (state === AgentState.IDLE && !finalStatus) {
    return null; // Keep screen clean and calm until a task is started
  }

  // Stages
  const isUnderstandingDone = state !== AgentState.UNDERSTANDING;
  const isPlanningDone =
    isUnderstandingDone && state !== AgentState.PLANNING;
  const isBrowserOpeningDone =
    isPlanningDone && state !== AgentState.OBSERVING;
  const isExecuting =
    state === AgentState.EXECUTING ||
    state === AgentState.VALIDATING ||
    state === AgentState.VERIFYING ||
    state === AgentState.RECOVERING;

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-5 shadow-card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {isRunning && (
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4F8EAD] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#4F8EAD]"></span>
              </span>
              <span className="text-sm font-semibold text-[#24485A]">Running...</span>
            </div>
          )}

          {isNeedsClarification && (
            <div className="flex items-center gap-2 text-[#D97706]">
              <HelpCircle className="w-5 h-5 text-[#D97706]" />
              <span className="text-sm font-semibold text-[#D97706]">Needs Clarification</span>
            </div>
          )}

          {isBlocked && (
            <div className="flex items-center gap-2 text-[#C96B6B]">
              <ShieldAlert className="w-5 h-5 text-[#C96B6B]" />
              <span className="text-sm font-semibold text-[#C96B6B]">Access Blocked</span>
            </div>
          )}

          {isCompleted && (
            <div className="flex items-center gap-2 text-[#5F9E7A]">
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-sm font-semibold text-[#24485A]">Completed</span>
            </div>
          )}

          {isFailed && (
            <div className="flex items-center gap-2 text-[#C96B6B]">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-semibold text-[#C96B6B]">Task could not be completed</span>
            </div>
          )}

          {isCancelled && (
            <div className="flex items-center gap-2 text-[#667784]">
              <XCircle className="w-5 h-5" />
              <span className="text-sm font-semibold text-[#667784]">Task Cancelled</span>
            </div>
          )}

          {lifecycleState && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[#EEF6FB] text-[#24485A] border border-[#D9E8EF] font-semibold">
              {lifecycleState}
            </span>
          )}

          {browserWindow?.isVisible && (
            <span
              id="panel-browser-window-badge"
              className="text-[10px] font-mono flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#EEF6FB] text-[#24485A] border border-[#D9E8EF] font-semibold"
              title={browserWindow.isOpen ? `Visible browser window open (${browserWindow.taskId || ""})` : "Browser window closed"}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${browserWindow.isOpen ? "bg-[#5F9E7A]" : "bg-[#667784]"}`} />
              {browserWindow.isOpen ? "Visible Window Active" : "Window Closed"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-[#667784]">
          <div className="flex items-center gap-1 font-mono">
            <Clock className="w-3.5 h-3.5 text-[#4F8EAD]" />
            <span>
              {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s
            </span>
          </div>
          {totalSteps > 0 && isRunning && (
            <span className="bg-[#EEF6FB] text-[#24485A] px-2 py-0.5 rounded border border-[#D9E8EF] font-mono text-[11px]">
              Step {currentStepIndex}/{totalSteps}
            </span>
          )}
        </div>
      </div>

      {/* Sequential Clean Stages (Part 25) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
        <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[#F7FAFC] border border-[#D9E8EF]">
          {isUnderstandingDone ? (
            <CheckCircle2 className="w-4 h-4 text-[#5F9E7A] shrink-0" />
          ) : (
            <Loader2 className="w-4 h-4 text-[#4F8EAD] animate-spin shrink-0" />
          )}
          <span className={isUnderstandingDone ? "text-[#1F2933] font-medium" : "text-[#4F8EAD] font-semibold"}>
            Understanding task
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[#F7FAFC] border border-[#D9E8EF]">
          {isPlanningDone ? (
            <CheckCircle2 className="w-4 h-4 text-[#5F9E7A] shrink-0" />
          ) : state === AgentState.PLANNING ? (
            <Loader2 className="w-4 h-4 text-[#4F8EAD] animate-spin shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full border border-[#D9E8EF] shrink-0" />
          )}
          <span className={isPlanningDone ? "text-[#1F2933] font-medium" : state === AgentState.PLANNING ? "text-[#4F8EAD] font-semibold" : "text-[#667784]"}>
            Planning
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[#F7FAFC] border border-[#D9E8EF]">
          {isBrowserOpeningDone ? (
            <CheckCircle2 className="w-4 h-4 text-[#5F9E7A] shrink-0" />
          ) : state === AgentState.OBSERVING ? (
            <Loader2 className="w-4 h-4 text-[#4F8EAD] animate-spin shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full border border-[#D9E8EF] shrink-0" />
          )}
          <span className={isBrowserOpeningDone ? "text-[#1F2933] font-medium" : state === AgentState.OBSERVING ? "text-[#4F8EAD] font-semibold" : "text-[#667784]"}>
            Opening browser
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-[#F7FAFC] border border-[#D9E8EF]">
          {isCompleted ? (
            <CheckCircle2 className="w-4 h-4 text-[#5F9E7A] shrink-0" />
          ) : isFailed ? (
            <AlertCircle className="w-4 h-4 text-[#C96B6B] shrink-0" />
          ) : isExecuting ? (
            <Loader2 className="w-4 h-4 text-[#4F8EAD] animate-spin shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full border border-[#D9E8EF] shrink-0" />
          )}
          <span className={isCompleted ? "text-[#5F9E7A] font-medium" : isExecuting ? "text-[#4F8EAD] font-semibold" : "text-[#667784]"}>
            Executing
          </span>
        </div>
      </div>

      {/* Current Action / Outcome message */}
      {(currentActionName || statusMessage) && (
        <div className="text-xs text-[#24485A] bg-[#EEF6FB] px-3 py-2 rounded-lg border border-[#D9E8EF] flex items-center justify-between">
          <span className="font-medium truncate">
            {statusMessage || currentActionName}
          </span>
          {currentUrl && (
            <span className="text-[#667784] font-mono text-[11px] truncate max-w-xs ml-2 hidden sm:inline" title={currentUrl}>
              {currentUrl}
            </span>
          )}
        </div>
      )}

      {/* Retained Visible Browser Window Note (Section 5 Window Persistence) */}
      {(isCompleted || isFailed) && browserWindow?.isOpen && (
        <div className="text-[11px] text-[#5F9E7A] bg-[#F0FDF4] border border-[#DCFCE7] px-3 py-1.5 rounded-lg flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5F9E7A]"></span>
            Visible browser window retained on desktop for inspection. Close when finished.
          </span>
          {browserWindow.taskId && (
            <span className="font-mono text-[#667784] text-[10px]">
              {browserWindow.taskId}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
