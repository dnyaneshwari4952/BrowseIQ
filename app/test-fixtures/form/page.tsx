"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Send, CheckCircle2 } from "lucide-react";

export default function FormFixturePage() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState<typeof formData | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName || !formData.email) return;
    setSubmitted({ ...formData });
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-2xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">Contact Form Submission</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/form
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card">
        {submitted ? (
          <div className="p-4 bg-[#EEF6FB] border border-[#D9E8EF] rounded-lg space-y-3" id="submission-confirmation">
            <div className="flex items-center gap-2 text-[#5F9E7A] font-semibold text-sm">
              <CheckCircle2 className="w-5 h-5" /> Form submitted successfully!
            </div>
            <div className="text-xs text-[#1F2933] space-y-1">
              <div><strong>Name:</strong> {submitted.fullName}</div>
              <div><strong>Email:</strong> {submitted.email}</div>
              {submitted.phone && <div><strong>Phone:</strong> {submitted.phone}</div>}
              {submitted.message && <div><strong>Message:</strong> {submitted.message}</div>}
            </div>
            <button
              onClick={() => setSubmitted(null)}
              className="text-xs text-[#4F8EAD] hover:underline pt-2 font-medium"
            >
              Reset Form
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#24485A] mb-1" htmlFor="fullName">
                Full Name *
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                required
                aria-label="Full Name"
                placeholder="Alex Rivera"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5] focus:ring-1 focus:ring-[#6FA8C5]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#24485A] mb-1" htmlFor="email">
                Email Address *
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                aria-label="Email Address"
                placeholder="alex@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5] focus:ring-1 focus:ring-[#6FA8C5]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#24485A] mb-1" htmlFor="phone">
                Phone Number
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                aria-label="Phone Number"
                placeholder="+1 (555) 234-5678"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5] focus:ring-1 focus:ring-[#6FA8C5]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#24485A] mb-1" htmlFor="message">
                Message
              </label>
              <textarea
                id="message"
                name="message"
                rows={3}
                aria-label="Message"
                placeholder="I would like to inquire about..."
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5] focus:ring-1 focus:ring-[#6FA8C5]"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-[#4F8EAD] hover:bg-[#437B96] text-white text-sm font-semibold rounded-md transition-colors flex items-center justify-center gap-2 shadow-sm"
            >
              <Send className="w-4 h-4" /> Submit Contact Form
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
