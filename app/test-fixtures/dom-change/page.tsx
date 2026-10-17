"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

export default function DomChangeFixturePage() {
  const [version, setVersion] = useState<"A" | "B" | "C">("A");
  const [clicked, setClicked] = useState(false);

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-2xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">DOM Variation & Locator Adaptation</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/dom-change
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#D9E8EF]">
          <span className="text-xs font-semibold text-[#24485A]">Active DOM Version:</span>
          <div className="flex gap-2">
            {(["A", "B", "C"] as const).map((v) => (
              <button
                key={v}
                onClick={() => {
                  setVersion(v);
                  setClicked(false);
                }}
                className={`px-3 py-1 text-xs rounded border transition-colors ${
                  version === v
                    ? "bg-[#4F8EAD] text-white border-[#4F8EAD] font-semibold"
                    : "bg-[#FFFFFF] text-[#24485A] border-[#D9E8EF] hover:bg-[#EEF6FB]"
                }`}
              >
                Version {v}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-[#667784]">
          This fixture tests whether the locator engine uses semantic hierarchy (role + label/name) instead of relying on fragile classnames or hardcoded text.
        </p>

        {/* DOM Variation Container */}
        <div className="p-5 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg flex flex-col items-center justify-center space-y-4">
          <input
            type="text"
            placeholder="Search catalog..."
            className="w-full max-w-xs px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded text-sm text-[#1F2933]"
          />

          {version === "A" && (
            <button
              onClick={() => setClicked(true)}
              className="px-5 py-2 bg-[#4F8EAD] text-white text-xs font-semibold rounded hover:bg-[#437B96]"
            >
              Search
            </button>
          )}

          {version === "B" && (
            <button
              onClick={() => setClicked(true)}
              className="px-5 py-2 bg-[#4F8EAD] text-white text-xs font-semibold rounded hover:bg-[#437B96]"
            >
              Find Products
            </button>
          )}

          {version === "C" && (
            <div className="wrapper-div-nested">
              <button
                data-testid="search-products"
                onClick={() => setClicked(true)}
                className="px-5 py-2 bg-[#4F8EAD] text-white text-xs font-semibold rounded hover:bg-[#437B96]"
              >
                Search
              </button>
            </div>
          )}

          {clicked && (
            <div className="p-2.5 bg-[#EEF6FB] border border-[#D9E8EF] rounded text-xs text-[#5F9E7A] font-semibold flex items-center gap-1.5" id="dom-success-message">
              <Check className="w-4 h-4" /> Correct button clicked under Version {version}!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
