"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Lock, LogOut, CheckCircle2 } from "lucide-react";

export default function AuthFixturePage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "admin@test.com" && password === "securePass123") {
      setIsLoggedIn(true);
      setErrorMsg("");
    } else {
      setErrorMsg("Invalid credentials. Use 'admin@test.com' and 'securePass123'");
    }
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-8 max-w-xl mx-auto font-sans">
      <div className="border-b border-[#D9E8EF] pb-4 mb-6 flex items-center justify-between">
        <div>
          <Link href="/test-fixtures" className="text-xs text-[#4F8EAD] hover:underline mb-1 inline-block">
            ← All Fixtures
          </Link>
          <h1 className="text-xl font-bold text-[#24485A]">Authentication Simulation</h1>
        </div>
        <span className="text-xs font-mono bg-[#EEF6FB] text-[#24485A] px-2.5 py-1 rounded border border-[#D9E8EF]">
          Fixture: /test-fixtures/auth
        </span>
      </div>

      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg p-6 shadow-card">
        {isLoggedIn ? (
          <div className="space-y-4" id="authenticated-dashboard">
            <div className="p-3 bg-[#EEF6FB] border border-[#D9E8EF] rounded text-xs text-[#5F9E7A] font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Authenticated as Administrator
            </div>

            <div className="p-4 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-2 text-xs">
              <div className="text-sm font-bold text-[#24485A]" id="account-heading">Internal Dashboard</div>
              <div className="text-[#1F2933]">Account Holder: <strong>Admin User</strong></div>
              <div className="text-[#1F2933]">Account Balance: <strong className="text-[#5F9E7A] font-mono text-sm" id="account-balance">₹1,25,000</strong></div>
              <div className="text-[#667784]">Status: Active Enterprise Tier</div>
            </div>

            <button
              onClick={() => setIsLoggedIn(false)}
              className="px-3.5 py-1.5 bg-[#FFFFFF] border border-[#D9E8EF] hover:bg-[#F0F7FA] text-[#24485A] text-xs font-semibold rounded flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5 text-[#667784]" /> Logout
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4" id="login-form">
            <div className="flex items-center gap-2 text-xs text-[#667784] pb-2">
              <Lock className="w-4 h-4 text-[#4F8EAD]" />
              <span>Enter test credentials: <code className="text-[#24485A] font-mono">admin@test.com</code> / <code className="text-[#24485A] font-mono">securePass123</code></span>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-[#FDF2F2] border border-[#F5D5D5] text-[#C96B6B] text-xs rounded font-medium" id="auth-error">
                {errorMsg}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#24485A] mb-1" htmlFor="username">
                Username / Email
              </label>
              <input
                id="username"
                name="username"
                type="email"
                required
                aria-label="Username or Email"
                placeholder="admin@test.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#24485A] mb-1" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                aria-label="Password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded-md text-sm text-[#1F2933] placeholder-[#667784] focus:outline-none focus:border-[#6FA8C5]"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-[#4F8EAD] hover:bg-[#437B96] text-white text-xs font-semibold rounded transition-colors shadow-sm"
              id="login-submit-btn"
            >
              Sign In
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
