import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function FailureFixturePage() {
  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-2xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">Empty / Non-Applicable Page</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/failure
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-8 shadow-card text-center space-y-3">
        <div className="w-10 h-10 rounded-full bg-[#FFF9EE] text-[#C59A52] flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-bold text-[#24485A]">Static Informational Notice</h2>
        <p className="text-xs text-[#667784] max-w-md mx-auto">
          This page is a plain informational placeholder. It contains no search input, no product catalog, no contact forms, and no downloads.
        </p>
        <div className="pt-2 text-[11px] text-[#667784] font-mono">
          Expected behavior: Tasks requiring interaction must report FAILED with honest diagnostic reasons.
        </div>
      </div>
    </div>
  );
}
