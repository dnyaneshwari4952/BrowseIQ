import Link from "next/link";
import { ExternalLink } from "lucide-react";

export default function MultiTabFixturePage() {
  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-2xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">Multi-Tab Workflow Test</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/multi-tab
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card space-y-4">
        <p className="text-xs text-[#667784]">
          Clicking the link below opens a new browser tab. The agent must detect the new tab, switch its active context, extract the secret token, and verify the result.
        </p>

        <div className="p-4 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg flex items-center justify-between">
          <div className="text-xs text-[#24485A] font-semibold">
            Secondary Verification Document
          </div>

          <a
            href="/test-fixtures/multi-tab/target"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-[#4F8EAD] hover:bg-[#437B96] text-white text-xs font-semibold rounded flex items-center gap-1.5 transition-colors shadow-sm"
            id="open-tab-btn"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open Target Tab
          </a>
        </div>
      </div>
    </div>
  );
}
