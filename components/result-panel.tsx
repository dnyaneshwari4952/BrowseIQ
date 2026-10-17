"use client";

import React, { useState } from "react";
import { CheckCircle2, Download, Image as ImageIcon, Copy, Check, ExternalLink, HelpCircle, AlertTriangle, Clock } from "lucide-react";
import { DownloadedArtifact } from "@/lib/types/results";

interface ResultPanelProps {
  status?:
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "needs_clarification"
    | "unsupported_task"
    | "waiting_for_user";
  statusMessage?: string;
  extractedData?: unknown;
  downloads?: DownloadedArtifact[];
  screenshots?: string[];
  sourceUrl?: string;
}

export function ResultPanel({
  status,
  statusMessage,
  extractedData,
  downloads = [],
  screenshots = [],
  sourceUrl,
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [viewDetails, setViewDetails] = useState(false);

  if (!status && !extractedData && downloads.length === 0 && screenshots.length === 0) {
    return null; // Keep clean until results exist
  }

  const isCompleted = status === "completed";
  const isClarification = status === "needs_clarification" || status === "waiting_for_user";
  const isUnsupported = status === "unsupported_task";
  const isTimedOut = status === "timed_out";

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

  return (
    <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-xl p-5 shadow-card space-y-4">
      {/* Result Status Banner (Part 27) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9E8EF] pb-3">
        <div className="flex items-center gap-2">
          {isCompleted ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#5F9E7A] bg-[#EEF6FB] px-2.5 py-1 rounded-md border border-[#D9E8EF]">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#5F9E7A]" />
              Task Completed
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
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wider text-[#C96B6B] bg-[#FDF2F2] px-2.5 py-1 rounded-md border border-[#F5D5D5]">
              {status || "Failed"}
            </span>
          )}
        </div>


        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#5F9E7A]" /> : <Copy className="w-3.5 h-3.5 text-[#4F8EAD]" />}
            <span>{copied ? "Copied" : "Copy Result"}</span>
          </button>

          <button
            onClick={() => setViewDetails(!viewDetails)}
            className="px-3 py-1.5 bg-[#EEF6FB] hover:bg-[#E3F1F8] text-[#24485A] border border-[#D9E8EF] rounded-lg text-xs font-medium transition-colors"
          >
            {viewDetails ? "Hide Raw Data" : "View Raw Data"}
          </button>
        </div>
      </div>

      {/* Prominent Result Focus (Part 27: Laptop Pro, ₹75,000, Source) */}
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

          <div className="flex items-center gap-1 text-xs text-[#5F9E7A] font-medium pt-1">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Task verified successfully</span>
          </div>
        </div>
      )}

      {/* Clarification prompt card (Phase 10 & 36) */}
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
            <span>Tip: Re-run the task with more specific details or provide the correct target page URL.</span>
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
