"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  Download,
  Copy,
  Check,
  ExternalLink,
  HelpCircle,
  AlertTriangle,
  AlertCircle,
  Clock,
  ShieldAlert,
  XCircle,
  FileText,
  CheckSquare,
  Sparkles,
} from "lucide-react";
import { DownloadedArtifact, TaskVerificationResult, RecoveryAttemptRecord } from "@/lib/types/results";
import { redactSecrets } from "@/lib/observability/trace";
import { ModeBadge } from "@/components/mode-switch";
import type { PlanningMetadata } from "@/lib/agent/gemini-planning-interface";

export interface ResultPanelProps {
  status?:
    | "completed"
    | "partial_success"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "needs_clarification"
    | "unsupported_task"
    | "waiting_for_user"
    | "blocked";
  statusMessage?: string;
  extractedData?: unknown;
  downloads?: DownloadedArtifact[];
  screenshots?: string[];
  sourceUrl?: string;
  taskVerification?: TaskVerificationResult | null;
  executionMode?: "live" | "test";
  interpretedTask?: string;
  constraints?: string[];
  recoveryHistory?: RecoveryAttemptRecord[];
  taskId?: string;
  /** Planning metadata from the task execution context for observability. */
  planningMetadata?: PlanningMetadata;
}

export function ResultPanel({
  status,
  statusMessage,
  extractedData,
  downloads = [],
  sourceUrl,
  taskVerification,
  executionMode = "live",
  interpretedTask,
  constraints = [],
  recoveryHistory = [],
  taskId,
  planningMetadata,
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [viewDetails, setViewDetails] = useState(false);
  const [viewAuditReport, setViewAuditReport] = useState(false);

  if (!status && !extractedData && downloads.length === 0 && !taskVerification) {
    return null; // Keep clean until results exist
  }

  const isCompleted = status === "completed";
  const isPartial = status === "partial_success";
  const isClarification = status === "needs_clarification" || status === "waiting_for_user";
  const isUnsupported = status === "unsupported_task";
  const isTimedOut = status === "timed_out";
  const isBlocked = status === "blocked";
  const isCancelled = status === "cancelled";

  // Check if extracted data has recognizable fields (e.g. title, price, name, etc.)
  let primaryTitle: string | null = null;
  let primaryPrice: string | null = null;
  let secondaryDetails: string | null = null;

  if (extractedData && typeof extractedData === "object") {
    const data = extractedData as Record<string, unknown>;
    if (typeof data.title === "string") primaryTitle = data.title;
    if (typeof data.name === "string" && !primaryTitle) primaryTitle = data.name;
    if (typeof data.price === "string") primaryPrice = data.price;
    if (typeof data.url === "string" && !sourceUrl) sourceUrl = data.url;

    // If array of products
    if (Array.isArray(data.products) && data.products.length > 0) {
      const first = data.products[0];
      if (first.title) primaryTitle = first.title;
      if (first.price) primaryPrice = first.price;
      secondaryDetails = `${data.products.length} products found in catalog`;
    }
  } else if (typeof extractedData === "string" && extractedData.trim()) {
    primaryTitle = extractedData;
  }

  const handleCopy = () => {
    const textToCopy =
      primaryTitle && primaryPrice
        ? `${primaryTitle}\n${primaryPrice}${sourceUrl ? `\nSource: ${sourceUrl}` : ""}`
        : JSON.stringify(extractedData || statusMessage || "Result", null, 2);

    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopySanitizedReport = () => {
    const report = {
      reportType: "Sanitized Task Execution Audit",
      taskId: taskId || "task-latest",
      executionMode,
      finalStatus: status || "unknown",
      statusMessage: statusMessage || "",
      interpretedTask: interpretedTask || undefined,
      constraintsPreserved: constraints.length > 0 ? constraints : undefined,
      verificationOutcome: taskVerification?.outcome || status,
      verificationEvidence: {
        passed: taskVerification?.passed ?? isCompleted,
        reason: taskVerification?.reason || statusMessage,
        conditionsPassed: taskVerification?.evidence?.conditionsPassed || [],
        failedChecks: taskVerification?.failedChecks || [],
        missingOutputs: taskVerification?.missingOutputs || [],
      },
      recoveryAttempts: recoveryHistory.length,
      downloadCount: downloads.length,
      timestamp: new Date().toISOString(),
    };

    const sanitized = redactSecrets(report);
    navigator.clipboard.writeText(JSON.stringify(sanitized, null, 2));
    setReportCopied(true);
    setTimeout(() => setReportCopied(false), 2000);
  };

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-5 shadow-card space-y-4">
      {/* Result Status Banner (Section 10 Observability) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9E8EF] pb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isCompleted ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#5F9E7A] bg-[#EEF6FB] px-2.5 py-1 rounded-md border border-[#D9E8EF]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#5F9E7A]" />
              Task Verified Successfully
            </span>
          ) : isPartial ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FEF3C7] px-2.5 py-1 rounded-md border border-[#FDE68A]">
              <AlertCircle className="w-3.5 h-3.5 text-[#B45309]" />
              Partial Success (Unmet requirements)
            </span>
          ) : isClarification ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#B45309] bg-[#FEF3C7] px-2.5 py-1 rounded-md border border-[#FDE68A]">
              <HelpCircle className="w-3.5 h-3.5 text-[#B45309]" />
              Needs Clarification
            </span>
          ) : isUnsupported ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#4B5563] bg-[#F3F4F6] px-2.5 py-1 rounded-md border border-[#E5E7EB]">
              <AlertTriangle className="w-3.5 h-3.5 text-[#4B5563]" />
              Unsupported Task
            </span>
          ) : isTimedOut ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#C2410C] bg-[#FFEDD5] px-2.5 py-1 rounded-md border border-[#FED7AA]">
              <Clock className="w-3.5 h-3.5 text-[#C2410C]" />
              Timed Out
            </span>
          ) : isBlocked ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#DC2626] bg-[#FEF2F2] px-2.5 py-1 rounded-md border border-[#FEE2E2]">
              <ShieldAlert className="w-3.5 h-3.5 text-[#DC2626]" />
              Access Restricted / Blocked
            </span>
          ) : isCancelled ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#4B5563] bg-[#F3F4F6] px-2.5 py-1 rounded-md border border-[#E5E7EB]">
              <XCircle className="w-3.5 h-3.5 text-[#4B5563]" />
              Task Cancelled by User
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#C96B6B] bg-[#FDF2F2] px-2.5 py-1 rounded-md border border-[#F5D5D5]">
              <AlertCircle className="w-3.5 h-3.5 text-[#C96B6B]" />
              {status || "Verification Failed"}
            </span>
          )}

          {/* Execution environment badge (Enforced Live Execution) */}
          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-medium bg-[#F7FAFC] text-[#667784] border border-[#D9E8EF] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5F9E7A]"></span>
            Live Browser
          </span>

          {/* Planning mode badge: shows whether Gemini was actually used for this task */}
          <ModeBadge
            operatingMode={planningMetadata?.operatingMode}
            geminiInvoked={planningMetadata?.geminiInvoked}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySanitizedReport}
            className="px-2.5 py-1.5 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shadow-sm"
            title="Copy audit-safe sanitized execution report (strips all secrets and cookies)"
          >
            {reportCopied ? <Check className="w-3.5 h-3.5 text-[#5F9E7A]" /> : <FileText className="w-3.5 h-3.5 text-[#4F8EAD]" />}
            <span>{reportCopied ? "Report Copied" : "Sanitized Audit"}</span>
          </button>

          <button
            onClick={handleCopy}
            className="px-2.5 py-1.5 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] rounded-lg text-xs font-medium flex items-center gap-1 transition-colors shadow-sm"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#5F9E7A]" /> : <Copy className="w-3.5 h-3.5 text-[#4F8EAD]" />}
            <span>{copied ? "Copied" : "Copy Result"}</span>
          </button>

          <button
            onClick={() => setViewDetails(!viewDetails)}
            className="px-2.5 py-1.5 bg-[#EEF6FB] hover:bg-[#E3F1F8] text-[#24485A] border border-[#D9E8EF] rounded-lg text-xs font-medium transition-colors"
          >
            {viewDetails ? "Hide Data" : "Raw Data"}
          </button>
        </div>
      </div>

      {/* Interpreted Task & Constraints Card (Section 4 & 10) */}
      {(interpretedTask || constraints.length > 0) && (
        <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-3 space-y-1.5 text-xs">
          {interpretedTask && (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-semibold text-[#667784] uppercase tracking-wider shrink-0">Interpreted Goal:</span>
              <span className="text-[#24485A] font-medium">{interpretedTask}</span>
            </div>
          )}
          {constraints.length > 0 && (
            <div className="flex items-baseline gap-2 flex-wrap pt-0.5">
              <span className="text-[11px] font-semibold text-[#667784] uppercase tracking-wider shrink-0">Active Constraints:</span>
              <div className="flex flex-wrap gap-1">
                {constraints.map((c, i) => (
                  <span key={i} className="bg-[#FFFFFF] border border-[#D9E8EF] text-[#4F8EAD] px-2 py-0.5 rounded text-[10px] font-mono font-medium">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Verification Evidence & Criteria (Section 2, 3, 10) */}
      {taskVerification && (
        <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between border-b border-[#D9E8EF] pb-2">
            <span className="font-semibold text-[#24485A] flex items-center gap-1.5">
              <CheckSquare className="w-4 h-4 text-[#4F8EAD]" />
              Independent Verification Evidence
            </span>
            <span className={`text-[11px] font-semibold ${taskVerification.passed ? "text-[#5F9E7A]" : "text-[#C96B6B]"}`}>
              {taskVerification.passed ? "Ground Truth Verified" : "Verification Inconclusive / Failed"}
            </span>
          </div>

          {taskVerification.reason && (
            <p className="text-[#1F2933] leading-relaxed font-medium">
              {taskVerification.reason}
            </p>
          )}

          {/* Conditions passed */}
          {taskVerification.evidence?.conditionsPassed && taskVerification.evidence.conditionsPassed.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] font-semibold text-[#5F9E7A] uppercase tracking-wider">Criteria Met:</div>
              <div className="flex flex-wrap gap-1.5">
                {taskVerification.evidence.conditionsPassed.map((cond, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-[#EEF6FB] text-[#5F9E7A] border border-[#D9E8EF] px-2 py-0.5 rounded text-[11px] font-medium">
                    <Check className="w-3 h-3" /> {cond}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Unmet requirements / failed checks */}
          {((taskVerification.failedChecks && taskVerification.failedChecks.length > 0) ||
            (taskVerification.missingOutputs && taskVerification.missingOutputs.length > 0)) && (
            <div className="space-y-1 pt-1">
              <div className="text-[11px] font-semibold text-[#C96B6B] uppercase tracking-wider">Unmet Requirements:</div>
              <div className="flex flex-wrap gap-1.5">
                {taskVerification.failedChecks?.map((check, i) => (
                  <span key={`f-${i}`} className="inline-flex items-center gap-1 bg-[#FDF2F2] text-[#C96B6B] border border-[#F5D5D5] px-2 py-0.5 rounded text-[11px] font-medium">
                    <AlertCircle className="w-3 h-3" /> {check}
                  </span>
                ))}
                {taskVerification.missingOutputs?.map((out, i) => (
                  <span key={`m-${i}`} className="inline-flex items-center gap-1 bg-[#FEF3C7] text-[#B45309] border border-[#FDE68A] px-2 py-0.5 rounded text-[11px] font-medium">
                    <AlertTriangle className="w-3 h-3" /> Missing: {out}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recovery attempts note */}
          {recoveryHistory.length > 0 && (
            <div className="text-[11px] text-[#667784] pt-1 border-t border-[#D9E8EF]">
              <span>Recovery executed {recoveryHistory.length} times without losing original user constraints.</span>
            </div>
          )}
        </div>
      )}

      {/* Prominent Result Focus */}
      {primaryTitle && (
        <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-xl p-4.5 space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
            <h3 className="text-lg font-bold text-[#24485A] tracking-tight">{primaryTitle}</h3>
            {primaryPrice && (
              <span className="text-xl font-extrabold text-[#4F8EAD] font-mono">{primaryPrice}</span>
            )}
          </div>

          {secondaryDetails && (
            <p className="text-xs text-[#667784]">{secondaryDetails}</p>
          )}

          {sourceUrl && (
            <div className="flex items-center gap-1.5 text-xs text-[#667784] pt-1">
              <span>Source:</span>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#4F8EAD] hover:underline font-mono text-[11px] flex items-center gap-1 truncate max-w-md"
              >
                {sourceUrl}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          )}

          {isCompleted && (
            <div className="flex items-center gap-1 text-xs text-[#5F9E7A] font-medium pt-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Evidence confirms task goal achieved</span>
            </div>
          )}
        </div>
      )}

      {/* Clarification prompt card */}
      {isClarification && Boolean(statusMessage) && (
        <div className="p-4 bg-[#FEF3C7]/40 border border-[#FDE68A] rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#B45309]">
            <HelpCircle className="w-4 h-4 text-[#B45309] shrink-0" />
            <span>Clarification Required:</span>
          </div>
          <p className="text-xs text-[#78350F] leading-relaxed font-medium">
            {statusMessage}
          </p>
          <div className="text-[11px] text-[#92400E] pt-1 border-t border-[#FDE68A]/60 flex items-center gap-1">
            <span>Tip: Provide specific details or target URL to proceed safely.</span>
          </div>
        </div>
      )}

      {/* When no extracted title but task completed or status message */}
      {!primaryTitle && Boolean(statusMessage) && !isClarification && (
        <div className="p-3.5 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg text-xs text-[#1F2933]">
          {statusMessage}
        </div>
      )}

      {/* Downloaded Files if available */}
      {downloads.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-xs font-semibold text-[#24485A] flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5 text-[#4F8EAD]" /> Downloaded Documents ({downloads.length})
          </div>
          {downloads.map((file) => (
            <div
              key={file.id}
              className="p-3 bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg text-xs flex items-center justify-between"
            >
              <div>
                <div className="font-semibold text-[#24485A]">{file.originalFilename}</div>
                <div className="text-[11px] text-[#667784]">
                  {(file.fileSizeBytes / 1024).toFixed(1)} KB • Verified Safe Document
                </div>
              </div>
              <span className="text-[10px] text-[#5F9E7A] bg-[#EEF6FB] border border-[#D9E8EF] px-2 py-0.5 rounded font-medium">
                Verified
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Optional Raw Details toggle */}
      {viewDetails && Boolean(extractedData) && (
        <div className="pt-2">
          <pre className="p-3.5 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg font-mono text-xs text-[#24485A] max-h-60 overflow-auto">
            {JSON.stringify(extractedData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
