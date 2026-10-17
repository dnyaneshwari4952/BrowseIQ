"use client";

import React from "react";
import { AlertTriangle, RefreshCw, UserCheck, ShieldAlert } from "lucide-react";
import { ErrorCode } from "@/lib/types/errors";

interface ErrorPanelProps {
  error?: {
    code: string;
    message: string;
    stepId?: string;
  } | null;
  retries?: number;
  replans?: number;
  waitingForUser?: boolean;
  userPromptMessage?: string;
  onUserConfirm?: () => void;
}

export function ErrorPanel({
  error,
  retries = 0,
  replans = 0,
  waitingForUser,
  userPromptMessage,
  onUserConfirm,
}: ErrorPanelProps) {
  if (!error && !waitingForUser) return null;

  const isCaptcha = error?.code === ErrorCode.CAPTCHA_DETECTED;
  const isAuth = error?.code === ErrorCode.AUTH_REQUIRED;

  return (
    <div className="bg-[#FDF2F2] border border-[#F5D5D5] rounded-lg p-4 shadow-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {waitingForUser ? (
            <UserCheck className="w-4 h-4 text-[#C59A52]" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-[#C96B6B]" />
          )}
          <h3 className="text-sm font-semibold text-[#24485A]">
            {waitingForUser ? "User Intervention Required" : "Failure & Recovery Diagnostics"}
          </h3>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {retries > 0 && (
            <span className="bg-[#EEF6FB] text-[#24485A] px-2.5 py-0.5 rounded border border-[#D9E8EF] flex items-center gap-1 font-medium">
              <RefreshCw className="w-3 h-3 text-[#4F8EAD]" /> Retries: {retries}
            </span>
          )}
          {replans > 0 && (
            <span className="bg-[#E3F1F8] text-[#4F8EAD] px-2.5 py-0.5 rounded border border-[#D9E8EF] font-medium">
              Replans: {replans}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-[#FFFFFF] p-3 rounded border border-[#F5D5D5] font-mono text-xs space-y-1">
          <div className="text-[#C96B6B] font-semibold flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>CLASSIFICATION: {error.code}</span>
            {error.stepId && <span className="text-[#667784] font-normal">({error.stepId})</span>}
          </div>
          <div className="text-[#1F2933] font-sans text-xs">{error.message}</div>
        </div>
      )}

      {waitingForUser && (
        <div className="bg-[#FFF9EE] p-3.5 rounded border border-[#F2E5CE] text-xs space-y-2.5">
          <p className="text-[#24485A] font-medium">
            {userPromptMessage ||
              (isCaptcha
                ? "A CAPTCHA challenge was detected on the page. Complete the challenge in the browser window and confirm."
                : isAuth
                ? "Authentication credentials or 2FA verification required."
                : "A high-risk action requires human confirmation before execution.")}
          </p>
          {onUserConfirm && (
            <button
              onClick={onUserConfirm}
              className="px-3.5 py-1.5 bg-[#4F8EAD] hover:bg-[#437B96] text-white rounded text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <UserCheck className="w-3.5 h-3.5" /> Confirm and Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
}
