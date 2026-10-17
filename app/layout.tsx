import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Browser Automation Agent | Production Autonomous Controller",
  description:
    "Production-grade intelligent browser automation agent with structured planning, deterministic execution, pre-execution guardrails, verification, and self-healing.",
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
