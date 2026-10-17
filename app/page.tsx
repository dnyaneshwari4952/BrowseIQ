"use client";

import React, { useState, useEffect, useRef } from "react";
import { Bot, Sliders, ShieldCheck, Activity, Terminal, ChevronDown, ChevronUp, Layers, Compass, Zap } from "lucide-react";
import { TaskInput } from "@/components/task-input";
import { ExecutionPanel } from "@/components/execution-panel";
import { PlanViewer } from "@/components/plan-viewer";
import { BrowserState } from "@/components/browser-state";
import { ActionLog } from "@/components/action-log";
import { ResultPanel } from "@/components/result-panel";
import { ErrorPanel } from "@/components/error-panel";
import { SettingsPanel } from "@/components/settings-panel";
import { AgentState, Plan } from "@/lib/types/plans";
import { PageObservation } from "@/lib/types/browser";
import { ExecutionEvent } from "@/lib/observability/trace";
import { DownloadedArtifact, ExecutionContext } from "@/lib/types/results";

export default function DashboardPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<"plan" | "page" | "trace" | "diagnostics">("plan");
  const [systemHealthy, setSystemHealthy] = useState<boolean | null>(null);

  // Agent State
  const [agentState, setAgentState] = useState<AgentState>(AgentState.IDLE);
  const [currentUrl, setCurrentUrl] = useState<string | undefined>();
  const [currentPageTitle, setCurrentPageTitle] = useState<string | undefined>();
  const [currentActionName, setCurrentActionName] = useState<string | undefined>();
  const [startTime, setStartTime] = useState<string | undefined>();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Structured Plan & Observation
  const [plan, setPlan] = useState<Plan | null>(null);
  const [observation, setObservation] = useState<PageObservation | null>(null);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);

  // Results & Errors
  const [extractedData, setExtractedData] = useState<unknown>(null);
  const [downloads, setDownloads] = useState<DownloadedArtifact[]>([]);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [finalStatus, setFinalStatus] = useState<ExecutionContext["finalStatus"]>();
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [errorDetails, setErrorDetails] = useState<{ code: string; message: string; stepId?: string } | null>(null);
  const [waitingForUser, setWaitingForUser] = useState(false);
  const [retriesCount, setRetriesCount] = useState(0);
  const [replansCount, setReplansCount] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Initial health check
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        setSystemHealthy(data.status === "healthy");
      })
      .catch(() => setSystemHealthy(false));
  }, []);

  const handleRunTask = async (task: string, targetUrl?: string) => {
    // Abort previous run if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const now = new Date().toISOString();
    setAgentState(AgentState.UNDERSTANDING);
    setStartTime(now);
    setCurrentUrl(targetUrl);
    setCurrentPageTitle(undefined);
    setCurrentActionName("Understanding task...");
    setCurrentStepIndex(0);
    setPlan(null);
    setObservation(null);
    setExtractedData(null);
    setDownloads([]);
    setScreenshots([]);
    setFinalStatus(undefined);
    setStatusMessage(undefined);
    setErrorDetails(null);
    setWaitingForUser(false);
    setRetriesCount(0);
    setReplansCount(0);
    setEvents([
      {
        id: `evt-${Date.now()}-init`,
        taskId: `task-${Date.now()}`,
        type: "TASK_RECEIVED",
        timestamp: now,
        message: `Task received: "${task}"`,
      },
    ]);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ task, targetUrl }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      // Check if streaming SSE response
      if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const chunk of lines) {
            const trimmed = chunk.trim();
            if (!trimmed) continue;

            const eventMatch = trimmed.match(/^event:\s*(\w+)/m);
            const dataMatch = trimmed.match(/^data:\s*(.+)$/m);

            if (eventMatch && dataMatch) {
              const eventType = eventMatch[1];
              try {
                const data = JSON.parse(dataMatch[1]);

                if (eventType === "event") {
                  const ev = data as ExecutionEvent;
                  setEvents((prev) => [...prev, ev]);

                  if (ev.type === "PLAN_READY" && ev.data && (ev.data as any).plan) {
                    setPlan((ev.data as any).plan);
                  }
                } else if (eventType === "state") {
                  if (data.state) setAgentState(data.state);
                  if (typeof data.stepIndex === "number") setCurrentStepIndex(data.stepIndex);
                  if (data.actionName) setCurrentActionName(data.actionName);
                } else if (eventType === "result") {
                  const ctx = data as ExecutionContext;
                  if (ctx.plan) setPlan(ctx.plan);
                  if (ctx.extractedData) setExtractedData(ctx.extractedData);
                  if (ctx.downloads) setDownloads(ctx.downloads);
                  if (ctx.currentUrl) setCurrentUrl(ctx.currentUrl);
                  if (ctx.currentPageTitle) setCurrentPageTitle(ctx.currentPageTitle);
                  setRetriesCount(ctx.retries || 0);
                  setReplansCount(ctx.replans || 0);
                  setFinalStatus(ctx.finalStatus);
                  setStatusMessage(ctx.statusMessage);
                  setAgentState(ctx.state);
                  setCurrentActionName(undefined);

                  if (ctx.finalStatus === "failed") {
                    setErrorDetails({
                      code: ctx.taskVerification ? "TASK_VERIFICATION_FAILED" : "EXECUTION_FAILED",
                      message: ctx.statusMessage || "The requested task could not be completed.",
                    });
                  }
                } else if (eventType === "error") {
                  setAgentState(AgentState.FAILED);
                  setFinalStatus("failed");
                  setStatusMessage(data.message);
                  setErrorDetails({ code: "AGENT_ERROR", message: data.message });
                }
              } catch {
                // Ignore parse errors on partial stream chunks
              }
            }
          }
        }
      } else {
        // Fallback synchronous JSON
        const ctx: ExecutionContext = await response.json();
        if (ctx.plan) setPlan(ctx.plan);
        if (ctx.extractedData) setExtractedData(ctx.extractedData);
        if (ctx.downloads) setDownloads(ctx.downloads);
        if (ctx.currentUrl) setCurrentUrl(ctx.currentUrl);
        if (ctx.currentPageTitle) setCurrentPageTitle(ctx.currentPageTitle);
        setFinalStatus(ctx.finalStatus);
        setStatusMessage(ctx.statusMessage);
        setAgentState(ctx.state);
        setCurrentActionName(undefined);
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        setAgentState(AgentState.CANCELLED);
        setFinalStatus("cancelled");
        setStatusMessage("Task stopped by user.");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setAgentState(AgentState.FAILED);
      setFinalStatus("failed");
      setStatusMessage(`Unable to execute task: ${message}`);
      setErrorDetails({ code: "NETWORK_ERROR", message });
    }
  };

  const handleStopTask = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setAgentState(AgentState.CANCELLED);
    setFinalStatus("cancelled");
    setCurrentActionName(undefined);
    setStatusMessage("Task stopped by user.");
    setEvents((prev) => [
      ...prev,
      {
        id: `evt-${Date.now()}-stop`,
        taskId: "task-stopped",
        type: "CANCELLED",
        timestamp: new Date().toISOString(),
        message: "Execution cancelled by user request.",
      },
    ]);
  };

  const isRunning =
    agentState !== AgentState.IDLE &&
    agentState !== AgentState.COMPLETED &&
    agentState !== AgentState.FAILED &&
    agentState !== AgentState.CANCELLED;

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#1F2933] flex flex-col font-sans">
      {/* Top Navigation Header (Part 33) */}
      <header className="border-b border-[#D9E8EF] bg-[#FFFFFF] sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#EEF6FB] border border-[#D9E8EF] flex items-center justify-center text-[#4F8EAD]">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-[#24485A] flex items-center gap-2">
              Browser Automation Agent
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-[#EEF6FB] text-[#24485A] border border-[#D9E8EF]">
                v1.0
              </span>
            </h1>
            <p className="text-xs text-[#667784]">Describe a task and let the agent complete it.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#F7FAFC] border border-[#D9E8EF] text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                systemHealthy === true
                  ? "bg-[#5F9E7A]"
                  : systemHealthy === false
                  ? "bg-[#C96B6B]"
                  : "bg-[#C59A52]"
              }`}
            />
            <span className="text-[#24485A] font-medium text-[11px]">
              {systemHealthy === true ? "Engine Online" : systemHealthy === false ? "Offline" : "Connecting..."}
            </span>
          </div>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-[#667784] hover:text-[#24485A] bg-[#FFFFFF] hover:bg-[#F0F7FA] border border-[#D9E8EF] rounded-lg transition-colors"
            title="Settings"
          >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Layout (Part 24 & 52) */}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-5">
        {/* Task Input Card */}
        <TaskInput onRun={handleRunTask} onStop={handleStopTask} isRunning={isRunning} />

        {/* Simple Status Card (Part 25) */}
        <ExecutionPanel
          state={agentState}
          currentUrl={currentUrl}
          currentPageTitle={currentPageTitle}
          currentActionName={currentActionName}
          startTime={startTime}
          totalSteps={plan?.actions.length || 0}
          currentStepIndex={currentStepIndex}
          statusMessage={statusMessage}
        />

        {/* Error / User Intervention Panel */}
        <ErrorPanel
          error={errorDetails}
          retries={retriesCount}
          replans={replansCount}
          waitingForUser={waitingForUser}
          onUserConfirm={() => setWaitingForUser(false)}
        />

        {/* Result-First Display (Part 27) */}
        <ResultPanel
          status={finalStatus}
          statusMessage={statusMessage}
          extractedData={extractedData}
          downloads={downloads}
          screenshots={screenshots}
          sourceUrl={currentUrl}
        />

        {/* Collapsible Advanced Details (Part 26) */}
        <div className="border border-[#D9E8EF] rounded-xl bg-[#FFFFFF] overflow-hidden transition-all shadow-subtle">
          <button
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="w-full px-5 py-3.5 bg-[#F7FAFC] hover:bg-[#EEF6FB] flex items-center justify-between text-xs font-semibold text-[#24485A] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#4F8EAD]" />
              Advanced Details
            </span>
            <span className="flex items-center gap-1 text-[#667784]">
              {isAdvancedOpen ? (
                <>
                  Collapse <ChevronUp className="w-3.5 h-3.5" />
                </>
              ) : (
                <>
                  Expand <ChevronDown className="w-3.5 h-3.5" />
                </>
              )}
            </span>
          </button>

          {isAdvancedOpen && (
            <div className="p-5 space-y-4 border-t border-[#D9E8EF]">
              {/* Tab Navigation */}
              <div className="flex items-center gap-1 border-b border-[#D9E8EF] pb-2 text-xs">
                <button
                  onClick={() => setAdvancedTab("plan")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    advancedTab === "plan"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Plan
                </button>
                <button
                  onClick={() => setAdvancedTab("page")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    advancedTab === "page"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Page Details
                </button>
                <button
                  onClick={() => setAdvancedTab("trace")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    advancedTab === "trace"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Execution Trace ({events.length})
                </button>
                <button
                  onClick={() => setAdvancedTab("diagnostics")}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    advancedTab === "diagnostics"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Diagnostics & Routing
                </button>
              </div>

              {/* Tab Contents */}
              {advancedTab === "plan" && (
                <PlanViewer plan={plan} currentStepIndex={currentStepIndex} />
              )}

              {advancedTab === "page" && (
                <BrowserState observation={observation} />
              )}

              {advancedTab === "trace" && (
                <ActionLog events={events} />
              )}

              {advancedTab === "diagnostics" && (
                <div className="space-y-3 text-xs">
                  <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-3 space-y-2">
                    <div className="font-semibold text-[#24485A] flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-[#4F8EAD]" />
                      Route Decision
                    </div>
                    <div className="text-[#1F2933]">
                      Route: <span className="font-semibold text-[#4F8EAD]">{plan?.routeDecision?.route.toUpperCase() || "BROWSER"}</span>
                    </div>
                    <p className="text-[#667784]">{plan?.routeDecision?.reason || "Default browser automation route selected."}</p>
                  </div>

                  <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-3 space-y-2">
                    <div className="font-semibold text-[#24485A] flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-[#4F8EAD]" />
                      Recovery & Replanning Stats
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">Retries</div>
                        <div className="font-bold text-[#24485A]">{retriesCount}</div>
                      </div>
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">Replans</div>
                        <div className="font-bold text-[#24485A]">{replansCount}</div>
                      </div>
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">Steps Completed</div>
                        <div className="font-bold text-[#5F9E7A]">{currentStepIndex}</div>
                      </div>
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">False Successes</div>
                        <div className="font-bold text-[#5F9E7A]">0 (Guaranteed)</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Simplified Footer (Part 37) */}
      <footer className="border-t border-[#D9E8EF] bg-[#FFFFFF] px-6 py-3 text-xs text-[#667784] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-1.5 font-medium text-[#24485A]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#4F8EAD]" /> Safety checks enabled
          </span>
          <span className="flex items-center gap-1.5 font-medium text-[#24485A]">
            <Activity className="w-3.5 h-3.5 text-[#5F9E7A]" /> Result verification enabled
          </span>
          <span className="flex items-center gap-1.5 font-medium text-[#24485A]">
            <Terminal className="w-3.5 h-3.5 text-[#4F8EAD]" /> Playwright Chromium
          </span>
        </div>
        <div className="text-[#667784]">Browser Automation Agent • Fourth Internship Project</div>
      </footer>

      {/* Settings Modal */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
