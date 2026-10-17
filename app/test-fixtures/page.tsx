import Link from "next/link";
import { Search, FileText, Clock, Shuffle, HelpCircle, Download, ExternalLink, Lock, AlertTriangle, XOctagon } from "lucide-react";

const FIXTURES = [
  {
    href: "/test-fixtures/search",
    title: "1. Search Page",
    desc: "Search products for 'laptop', filters results, shows Laptop Pro (₹75,000) and details.",
    icon: Search,
  },
  {
    href: "/test-fixtures/form",
    title: "2. Form Submission",
    desc: "Interactive contact form with Name, Email, Phone, Message and validation verification.",
    icon: FileText,
  },
  {
    href: "/test-fixtures/dynamic",
    title: "3. Dynamic Content",
    desc: "Elements render asynchronously after a 1.5-second artificial delay.",
    icon: Clock,
  },
  {
    href: "/test-fixtures/dom-change",
    title: "4. DOM Variation / Change",
    desc: "Buttons toggle text ('Search' vs 'Find Products') and attributes to test semantic locators.",
    icon: Shuffle,
  },
  {
    href: "/test-fixtures/ambiguous",
    title: "5. Ambiguous Targets",
    desc: "Multiple identical 'Submit' and 'Buy' buttons to test candidate disambiguation.",
    icon: HelpCircle,
  },
  {
    href: "/test-fixtures/download",
    title: "6. File Download",
    desc: "Triggers a browser download of an invoice document for verification.",
    icon: Download,
  },
  {
    href: "/test-fixtures/multi-tab",
    title: "7. Multi-Tab Workflow",
    desc: "Opens a secondary browser tab to test tab detection and context switching.",
    icon: ExternalLink,
  },
  {
    href: "/test-fixtures/auth",
    title: "8. Authentication Simulation",
    desc: "Simulates user login and dashboard access with credential validation.",
    icon: Lock,
  },
  {
    href: "/test-fixtures/prompt-injection",
    title: "9. Prompt Injection Defense",
    desc: "Contains adversarial text attempting to override system instructions.",
    icon: AlertTriangle,
  },
  {
    href: "/test-fixtures/failure",
    title: "10. Broken / Empty Page",
    desc: "Page with no search or matching controls to verify honest FAILED reporting.",
    icon: XOctagon,
  },
];

export default function TestFixturesIndex() {
  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-5xl mx-auto font-sans">
      <div className="mb-8">
        <Link href="/" className="text-xs font-semibold text-[#4F8EAD] hover:underline mb-2 inline-block">
          ← Back to Agent Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-[#24485A]">Controlled Test Website Fixtures</h1>
        <p className="text-sm text-[#667784] mt-1">
          Deterministic local environments for rigorous browser agent validation, mentor testing, and adversarial benchmarking.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIXTURES.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="p-4 bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg shadow-card hover:border-[#6FA8C5] hover:bg-[#EEF6FB]/30 transition-all flex items-start gap-3.5 group"
            >
              <div className="p-2.5 rounded-md bg-[#EEF6FB] text-[#4F8EAD] group-hover:bg-[#E3F1F8] transition-colors">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[#24485A] group-hover:text-[#4F8EAD] transition-colors">
                  {item.title}
                </h2>
                <p className="text-xs text-[#667784] mt-1">{item.desc}</p>
                <span className="text-[11px] font-mono text-[#4F8EAD] mt-2 inline-block">
                  {item.href}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
