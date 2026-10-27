import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BrowseIQ | Production Autonomous Browser Controller",
  description:
    "BrowseIQ — Production-grade intelligent browser automation agent with structured planning, deterministic Playwright execution, pre-execution guardrails, AI-assisted planning, verification, and self-healing.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#F7FAFC] text-[#1F2933] antialiased">
        {children}
      </body>
    </html>
  );
}
