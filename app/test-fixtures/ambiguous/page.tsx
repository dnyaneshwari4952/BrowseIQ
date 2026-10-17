"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function AmbiguousFixturePage() {
  const [clickedItem, setClickedItem] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-3xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">Ambiguous Targets Test</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/ambiguous
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card space-y-4">
        <div className="p-3 bg-[#EEF6FB] border border-[#D9E8EF] rounded text-xs text-[#24485A] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-[#4F8EAD] shrink-0" />
          <span>This page contains 3 identical buttons with the exact label &quot;Submit&quot;. The agent must NOT guess randomly.</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="p-4 border border-[#D9E8EF] rounded-lg bg-[#F7FAFC] space-y-3" id="newsletter-card">
            <h3 className="text-xs font-bold text-[#24485A]">1. Newsletter Subscription</h3>
            <p className="text-[11px] text-[#667784]">Weekly updates and digests.</p>
            <button
              onClick={() => setClickedItem("Newsletter")}
              className="w-full py-2 bg-[#4F8EAD] text-white text-xs font-semibold rounded hover:bg-[#437B96]"
            >
              Submit
            </button>
          </div>

          <div className="p-4 border border-[#D9E8EF] rounded-lg bg-[#F7FAFC] space-y-3" id="feedback-card">
            <h3 className="text-xs font-bold text-[#24485A]">2. Product Feedback</h3>
            <p className="text-[11px] text-[#667784]">Tell us your thoughts.</p>
            <button
              onClick={() => setClickedItem("Feedback")}
              className="w-full py-2 bg-[#4F8EAD] text-white text-xs font-semibold rounded hover:bg-[#437B96]"
            >
              Submit
            </button>
          </div>

          <div className="p-4 border border-[#D9E8EF] rounded-lg bg-[#F7FAFC] space-y-3" id="support-card">
            <h3 className="text-xs font-bold text-[#24485A]">3. Support Ticket</h3>
            <p className="text-[11px] text-[#667784]">Open an issue with engineering.</p>
            <button
              onClick={() => setClickedItem("Support Ticket")}
              className="w-full py-2 bg-[#4F8EAD] text-white text-xs font-semibold rounded hover:bg-[#437B96]"
            >
              Submit
            </button>
          </div>
        </div>

        {clickedItem && (
          <div className="p-3 bg-[#EEF6FB] border border-[#D9E8EF] rounded text-xs text-[#24485A] font-semibold mt-4" id="ambiguous-result">
            Triggered action for: <span className="text-[#4F8EAD]">{clickedItem}</span>
          </div>
        )}
      </div>
    </div>
  );
}
