"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function DynamicFixturePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ id: string; status: string; code: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setData({
        id: "rep-984",
        status: "READY",
        code: "CONFIRMED-8912",
      });
      setLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-2xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">Delayed / Dynamic Content Loading</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/dynamic
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3" id="loading-indicator">
            <Loader2 className="w-8 h-8 text-[#4F8EAD] animate-spin" />
            <p className="text-xs text-[#667784]">Loading dynamic content (1.5s delay simulation)...</p>
          </div>
        ) : (
          <div className="p-4 bg-[#EEF6FB] border border-[#D9E8EF] rounded-lg space-y-2 animate-in fade-in" id="delayed-card">
            <div className="flex items-center gap-2 text-[#5F9E7A] font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5" /> Dynamic Content Successfully Loaded
            </div>
            <div className="text-xs text-[#1F2933] space-y-1">
              <div><strong>Document ID:</strong> {data?.id}</div>
              <div><strong>Status:</strong> {data?.status}</div>
              <div><strong>Verification Code:</strong> <span className="font-mono text-[#24485A] font-bold">{data?.code}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
