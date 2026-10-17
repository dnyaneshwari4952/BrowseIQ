import Link from "next/link";
import { CheckCircle2, Layers } from "lucide-react";

export default function MultiTabTargetPage() {
  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-xl mx-auto font-sans">
      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card space-y-4">
        <div className="flex items-center gap-2 text-[#4F8EAD] font-semibold text-base">
          <Layers className="w-5 h-5" /> Secondary Browser Tab
        </div>
        <div className="p-4 bg-[#EEF6FB] border border-[#D9E8EF] rounded-lg text-xs space-y-2">
          <div className="text-[#24485A] font-bold text-sm" id="target-tab-heading">
            Target Tab Verification Document
          </div>
          <p className="text-[#1F2933]">
            This page opened in a separate browser tab to test multi-tab detection and context tracking.
          </p>
          <div className="pt-2">
            <span className="text-[#667784]">Verification Token: </span>
            <span className="font-mono text-[#24485A] font-bold text-xs" id="target-tab-token">
              TAB-SECRET-4401
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
