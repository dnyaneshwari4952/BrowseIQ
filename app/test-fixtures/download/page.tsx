"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Download, FileText, CheckCircle2 } from "lucide-react";

export default function DownloadFixturePage() {
  const [downloadStarted, setDownloadStarted] = useState(false);

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-2xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">File Download Testing</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/download
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card space-y-4">
        <p className="text-xs text-[#667784]">
          This page tests the agent&apos;s ability to trigger, capture, and verify browser file downloads without relying on external websites.
        </p>

        <div className="p-4 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#EEF6FB] text-[#4F8EAD] rounded-md">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#24485A]" id="invoice-doc-title">Invoice-2026.pdf</div>
              <div className="text-[11px] text-[#667784]">PDF Document • Official Invoice #INV-2026</div>
            </div>
          </div>

          <a
            href="/api/test-fixtures/download-file"
            download="invoice-2026.pdf"
            onClick={() => setDownloadStarted(true)}
            className="px-4 py-2 bg-[#4F8EAD] hover:bg-[#437B96] text-white text-xs font-semibold rounded flex items-center gap-1.5 transition-colors shadow-sm"
            id="download-invoice-btn"
          >
            <Download className="w-3.5 h-3.5" /> Download PDF
          </a>
        </div>

        {downloadStarted && (
          <div className="p-3 bg-[#EEF6FB] border border-[#D9E8EF] rounded text-xs text-[#5F9E7A] font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> Download request initiated!
          </div>
        )}
      </div>
    </div>
  );
}
