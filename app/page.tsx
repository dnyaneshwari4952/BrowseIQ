"use client";

import React, { useState, useEffect, useRef, useReducer, useCallback } from "react";
import { Bot, Sliders, ShieldCheck, Activity, Terminal, ChevronDown, ChevronUp, Layers, Compass, Zap, AlertTriangle } from "lucide-react";
import { TaskInput } from "@/components/task-input";
import { ExecutionPanel } from "@/components/execution-panel";
import { PlanViewer } from "@/components/plan-viewer";
import { BrowserState } from "@/components/browser-state";
import { ActionLog } from "@/components/action-log";
import { ResultPanel } from "@/components/result-panel";
import { ErrorPanel } from "@/components/error-panel";
import { SettingsPanel, AgentSettings } from "@/components/settings-panel";
import { AgentState } from "@/lib/types/plans";
import { ExecutionEvent } from "@/lib/observability/trace";
import { ExecutionContext } from "@/lib/types/results";
import {
  taskSessionReducer,
  INITIAL_TASK_SESSION_STATE,
  hasSessionData,
} from "@/lib/state/task-session";

export default function DashboardPage() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [systemHealthy, setSystemHealthy] = useState<boolean | null>(null);

  // Settings State (Persistent user configuration — NOT cleared by task reset)
  const [settings, setSettings] = useState<AgentSettings>({
    actionTimeout: 15000,
    maxRetries: 3,
    maxReplans: 3,
    requireConfirmation: true,
    localFilesEnabled: false,
    approvedDirectory: "",
  });

  // Centralized Task Session State
  const [session, dispatch] = useReducer(taskSessionReducer, INITIAL_TASK_SESSION_STATE);

  // Session / run invalidation token and network abort controller
  const currentRunIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const executionMode = "live" as const;

  // Migrate legacy operating mode preference safely from localStorage
  useEffect(() => {
    try {
      localStorage.removeItem("baa_operating_mode");
      localStorage.removeItem("operatingMode");
    } catch {
      // localStorage unavailable (SSR or private browsing)
    }
  }, []);

  const [engineHealthText, setEngineHealthText] = useState<string>("Connecting...");
  const [providerInfo, setProviderInfo] = useState<{ provider: string; isLive: boolean } | null>(null);
  const [displayLimitation, setDisplayLimitation] = useState<string | null>(null);
  const [verifiedBrowserState, setVerifiedBrowserState] = useState<{
    isLaunched: boolean;
    openWindows: number;
    activeSessions: number;
    displayAvailable: boolean;
    displayType: string;
  } | null>(null);

  // Initial health check distinguishing process, browser, and provider configuration
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        const isHealthy = data.status === "healthy";
        setSystemHealthy(isHealthy);
        const prov = data.system?.llmProvider || data.components?.primaryProvider?.name || "gemini";
        setProviderInfo({
          provider: prov.charAt(0).toUpperCase() + prov.slice(1),
          isLive: prov !== "mock",
        });
        const limitation = data.components?.browser?.displayLimitation || null;
        setDisplayLimitation(limitation);

        if (data.components?.browser) {
          setVerifiedBrowserState({
            isLaunched: Boolean(data.components.browser.isLaunched),
            openWindows: Number(data.components.browser.openWindows || 0),
            activeSessions: Number(data.components.browser.activeSessions || 0),
            displayAvailable: Boolean(data.components.browser.displayAvailable),
            displayType: String(data.components.browser.displayType || "unknown"),
          });
        }

        if (isHealthy) {
          setEngineHealthText("Engine Online");
        } else if (data.status === "degraded") {
          const providerStatus = data.components?.primaryProvider?.status;
          if (data.system?.displayAvailable === false || limitation) {
            setEngineHealthText("Degraded: No Graphical Display");
          } else if (providerStatus === "missing_credentials") {
            setEngineHealthText("Degraded: Missing API Key");
          } else {
            setEngineHealthText("Degraded: Config Warning");
          }
        } else {
          setEngineHealthText("Offline");
        }
      })
      .catch(() => {
        setSystemHealthy(false);
        setEngineHealthText("Offline");
      });

    // Load initial Local File permission status
    fetch("/api/local-file/permission")
      .then((res) => res.json())
      .then((perm) => {
        if (perm) {
          setSettings((prev) => ({
            ...prev,
            localFilesEnabled: Boolean(perm.enabled),
            accessMode: perm.accessMode || "selected_folders",
            wholeComputerConfirmed: Boolean(perm.wholeComputerConfirmed),
            approvedDirectories: perm.approvedDirectories || (perm.defaultDirectory ? [perm.defaultDirectory] : []),
            approvedDirectory: perm.approvedDirectory || perm.defaultDirectory || "",
          }));
        }
      })
      .catch(() => {});
  }, []);

  /**
   * Centralized Task Session Reset
   * Safely cancels any active in-flight execution and resets ALL task session state
   * to initial idle state, without modifying user preferences, API keys, or browser engine.
   */
  const resetTaskSession = useCallback(() => {
    // 1. Invalidate current run generation so late or asynchronous updates are dropped
    currentRunIdRef.current++;

    // 2. Abort running fetch/stream connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 3. Atomically reset all task session state variables
    dispatch({ type: "RESET_SESSION" });
  }, []);

  const handleRunTask = async (task: string, targetUrl?: string) => {
    // Abort previous run if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const runId = ++currentRunIdRef.current;
    const now = new Date().toISOString();

    dispatch({
      type: "START_TASK",
      payload: { task, targetUrl, now },
    });

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ task, targetUrl, settings, mode: "live" }),
        signal: abortController.signal,
      });

      if (currentRunIdRef.current !== runId) return;

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      // Check if streaming SSE response
      if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let hasReceivedResult = false;

        while (true) {
          if (currentRunIdRef.current !== runId) {
            reader.cancel().catch(() => {});
            return;
          }

          const { done, value } = await reader.read();
          if (done) break;

          if (currentRunIdRef.current !== runId) {
            reader.cancel().catch(() => {});
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const chunk of lines) {
            if (currentRunIdRef.current !== runId) return;
            const trimmed = chunk.trim();
            if (!trimmed) continue;

            const eventMatch = trimmed.match(/^event:\s*(\w+)/m);
            const dataMatch = trimmed.match(/^data:\s*(.+)$/m);

            if (eventMatch && dataMatch) {
              const eventType = eventMatch[1];
              try {
                const data = JSON.parse(dataMatch[1]);
                if (currentRunIdRef.current !== runId) return;

                if (eventType === "event") {
                  if (hasReceivedResult) continue; // Ignore late events after final result
                  const ev = data as ExecutionEvent;
                  dispatch({ type: "APPEND_EVENT", payload: ev });

                  if (ev.type === "PLAN_READY" && ev.data && (ev.data as any).plan) {
                    dispatch({ type: "SET_PLAN", payload: (ev.data as any).plan });
                  }
                  if (ev.type === "BROWSER_LAUNCHED" && ev.data) {
                    dispatch({
                      type: "SET_BROWSER_WINDOW",
                      payload: {
                        taskId: (ev.data as any).taskId,
                        isVisible: true,
                        isOpen: true,
                      },
                    });
                  }
                  if (ev.data && (ev.data as any).observation) {
                    dispatch({ type: "SET_OBSERVATION", payload: (ev.data as any).observation });
                  }
                } else if (eventType === "state" || eventType === "lifecycle") {
                  if (hasReceivedResult) continue; // Ignore late state transitions after final result
                  dispatch({ type: "UPDATE_STATE", payload: data });
                } else if (eventType === "result") {
                  hasReceivedResult = true;
                  dispatch({ type: "SET_RESULT", payload: data as ExecutionContext });
                } else if (eventType === "error") {
                  hasReceivedResult = true;
                  dispatch({ type: "SET_ERROR", payload: { message: data.message } });
                }
              } catch {
                // Ignore parse errors on partial stream chunks
              }
            }
          }
        }

        if (currentRunIdRef.current !== runId) return;

        // If stream closed unexpectedly before sending a terminal result event
        if (!hasReceivedResult && !abortController.signal.aborted) {
          dispatch({
            type: "SET_ERROR",
            payload: {
              code: "STREAM_DISCONNECTED",
              message: "Server connection closed prematurely.",
            },
          });
        }
      } else {
        // Fallback synchronous JSON
        const ctx: ExecutionContext = await response.json();
        if (currentRunIdRef.current !== runId) return;
        dispatch({ type: "SET_RESULT", payload: ctx });
      }
    } catch (err: unknown) {
      if (currentRunIdRef.current !== runId) {
        return; // Session cleared or re-run started; ignore stale errors
      }
      if (abortController.signal.aborted) {
        dispatch({
          type: "STOP_TASK",
          payload: { message: "Task stopped by user." },
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "SET_ERROR",
        payload: { code: "NETWORK_ERROR", message },
      });
    } finally {
      if (currentRunIdRef.current === runId) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleStopTask = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (session.activeTaskId) {
      fetch(`/api/agent?taskId=${encodeURIComponent(session.activeTaskId)}`, { method: "DELETE" }).catch(() => {});
    }
    dispatch({ type: "STOP_TASK" });
  };

  const isTerminalOrAwaiting =
    Boolean(session.finalStatus) ||
    session.waitingForUser ||
    session.agentState === AgentState.IDLE ||
    session.agentState === AgentState.COMPLETED ||
    session.agentState === AgentState.FAILED ||
    session.agentState === AgentState.CANCELLED ||
    session.agentState === AgentState.WAITING_FOR_USER ||
    session.lifecycleState === "needs_clarification" ||
    session.lifecycleState === "waiting_for_user" ||
    session.lifecycleState === "blocked" ||
    session.lifecycleState === "cancelled" ||
    session.lifecycleState === "failed" ||
    session.lifecycleState === "timed_out" ||
    session.lifecycleState === "completed" ||
    session.lifecycleState === "success" ||
    session.lifecycleState === "partial_success";

  const isRunning = !isTerminalOrAwaiting;

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
              BrowseIQ
              <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-[#EEF6FB] text-[#24485A] border border-[#D9E8EF]">
                v1.0
              </span>
            </h1>
            <p className="text-xs text-[#667784]">Describe a task and let the agent complete it.</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Enforced Live Browser Execution Indicator */}
          <div
            id="exec-mode-live-indicator"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#EEF6FB] text-[#24485A] border border-[#D9E8EF] shadow-sm select-none"
            title="Real Playwright browser execution against live websites and resources"
          >
            <span className="w-2 h-2 rounded-full bg-[#5F9E7A]"></span>
            <span>Live Mode</span>
          </div>

          {/* Visible Browser Window Indicator */}
          <div
            id="visible-browser-indicator"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#EEF6FB] text-[#24485A] border border-[#D9E8EF] shadow-sm select-none"
            title={
              session.browserWindow.isOpen
                ? `Visible browser window open (${session.browserWindow.taskId || "active"})`
                : verifiedBrowserState?.isLaunched && verifiedBrowserState.openWindows > 0
                ? `Visible Playwright Chromium instance active (${verifiedBrowserState.openWindows} window${verifiedBrowserState.openWindows === 1 ? "" : "s"} retained)`
                : verifiedBrowserState?.displayAvailable === false
                ? "No active display server detected: cannot render visible browser window"
                : "Launches an isolated visible Chromium window for each task"
            }
          >
            <span
              className={`w-2 h-2 rounded-full ${
                session.browserWindow.isOpen
                  ? "bg-[#5F9E7A]"
                  : verifiedBrowserState?.isLaunched && verifiedBrowserState.openWindows > 0
                  ? "bg-[#5F9E7A]"
                  : verifiedBrowserState?.displayAvailable === false
                  ? "bg-[#D97706]"
                  : session.browserWindow.isVisible
                  ? "bg-[#667784]"
                  : "bg-[#4F8EAD]"
              }`}
            />
            <span>
              {session.browserWindow.isOpen
                ? `Visible Window (${session.browserWindow.taskId ? session.browserWindow.taskId.slice(-5) : "Open"})`
                : verifiedBrowserState?.isLaunched && verifiedBrowserState.openWindows > 0
                ? `Visible Windows (${verifiedBrowserState.openWindows})`
                : verifiedBrowserState?.displayAvailable === false
                ? "No Display"
                : session.browserWindow.isVisible
                ? "Window Closed"
                : "Visible Browser"}
            </span>
          </div>

          {providerInfo && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${
                providerInfo.isLive
                  ? "bg-[#EEF6FB] text-[#24485A] border-[#D9E8EF]"
                  : "bg-[#FFF8E7] text-[#8C6D23] border-[#F1DFB5]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  providerInfo.isLive ? "bg-[#4F8EAD]" : "bg-[#C59A52]"
                }`}
              />
              <span>{providerInfo.isLive ? "Live" : "Mock"} • {providerInfo.provider}</span>
            </div>
          )}

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
              {engineHealthText}
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
        {/* Remote / Headless Environment Warning */}
        {displayLimitation && (
          <div
            id="display-limitation-banner"
            className="flex items-start gap-3 p-3.5 bg-[#FFF8E7] border border-[#F1DFB5] rounded-xl text-xs text-[#8C6D23] shadow-sm animate-in fade-in"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-[#C59A52] mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-[#6E4F10]">
                Graphical Display Unavailable in Current Environment
              </div>
              <div className="text-[#8C6D23] leading-relaxed">
                {displayLimitation}
              </div>
            </div>
          </div>
        )}

        {/* Task Input Card */}
        <TaskInput
          task={session.taskPrompt}
          targetUrl={session.targetUrlInput}
          onTaskChange={(task) => dispatch({ type: "SET_TASK_PROMPT", payload: task })}
          onTargetUrlChange={(url) => dispatch({ type: "SET_TARGET_URL", payload: url })}
          onRun={handleRunTask}
          onStop={handleStopTask}
          onClear={resetTaskSession}
          isRunning={isRunning}
          hasSessionData={hasSessionData(session)}
        />

        {/* Simple Status Card (Part 25) */}
        <ExecutionPanel
          state={session.agentState}
          lifecycleState={session.lifecycleState}
          finalStatus={session.finalStatus}
          currentUrl={session.currentUrl}
          currentPageTitle={session.currentPageTitle}
          currentActionName={session.currentActionName}
          startTime={session.startTime}
          totalSteps={session.plan?.actions.length || 0}
          currentStepIndex={session.currentStepIndex}
          statusMessage={session.statusMessage}
          browserWindow={session.browserWindow}
        />

        {/* Error / User Intervention Panel */}
        <ErrorPanel
          error={session.errorDetails}
          retries={session.retriesCount}
          replans={session.replansCount}
          waitingForUser={session.waitingForUser}
          onUserConfirm={() => dispatch({ type: "SET_WAITING_FOR_USER", payload: false })}
        />

        {/* Result-First Display (Part 27) */}
        <ResultPanel
          status={session.finalStatus}
          statusMessage={session.statusMessage}
          extractedData={session.extractedData}
          downloads={session.downloads}
          screenshots={session.screenshots}
          sourceUrl={session.currentUrl}
          taskVerification={session.taskVerification}
          executionMode={executionMode}
          interpretedTask={session.plan?.taskSpec?.target?.entity || session.plan?.taskSpec?.rawTask}
          constraints={session.plan?.taskSpec?.constraints?.map((c: any) => `${c.type}: ${c.value ?? c.field}`)}
          recoveryHistory={session.recoveryHistory}
          taskId={session.activeTaskId}
          planningMetadata={session.planningMetadata}
        />

        {/* Collapsible Advanced Details (Part 26) */}
        <div className="border border-[#D9E8EF] rounded-xl bg-[#FFFFFF] overflow-hidden transition-all shadow-subtle">
          <button
            onClick={() => dispatch({ type: "SET_ADVANCED_OPEN", payload: !session.isAdvancedOpen })}
            className="w-full px-5 py-3.5 bg-[#F7FAFC] hover:bg-[#EEF6FB] flex items-center justify-between text-xs font-semibold text-[#24485A] transition-colors"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#4F8EAD]" />
              Advanced Details
            </span>
            <span className="flex items-center gap-1 text-[#667784]">
              {session.isAdvancedOpen ? (
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

          {session.isAdvancedOpen && (
            <div className="p-5 space-y-4 border-t border-[#D9E8EF]">
              {/* Tab Navigation */}
              <div className="flex items-center gap-1 border-b border-[#D9E8EF] pb-2 text-xs">
                <button
                  onClick={() => dispatch({ type: "SET_ADVANCED_TAB", payload: "plan" })}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    session.advancedTab === "plan"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Plan
                </button>
                <button
                  onClick={() => dispatch({ type: "SET_ADVANCED_TAB", payload: "page" })}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    session.advancedTab === "page"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Page Details
                </button>
                <button
                  onClick={() => dispatch({ type: "SET_ADVANCED_TAB", payload: "trace" })}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    session.advancedTab === "trace"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Execution Trace ({session.events.length})
                </button>
                <button
                  onClick={() => dispatch({ type: "SET_ADVANCED_TAB", payload: "diagnostics" })}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    session.advancedTab === "diagnostics"
                      ? "bg-[#4F8EAD] text-white"
                      : "text-[#667784] hover:text-[#24485A] hover:bg-[#EEF6FB]"
                  }`}
                >
                  Diagnostics & Routing
                </button>
              </div>

              {/* Tab Contents */}
              {session.advancedTab === "plan" && (
                <PlanViewer
                  plan={session.plan}
                  currentStepIndex={session.currentStepIndex}
                  isTaskVerified={session.taskVerification?.passed ?? false}
                />
              )}

              {session.advancedTab === "page" && (
                <BrowserState observation={session.observation} tabs={session.browserTabs} />
              )}

              {session.advancedTab === "trace" && (
                <ActionLog events={session.events} />
              )}

              {session.advancedTab === "diagnostics" && (
                <div className="space-y-3 text-xs">
                  <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-3 space-y-2">
                    <div className="font-semibold text-[#24485A] flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-[#4F8EAD]" />
                      Route Decision
                    </div>
                    <div className="text-[#1F2933]">
                      Route: <span className="font-semibold text-[#4F8EAD]">{session.plan?.routeDecision?.route.toUpperCase() || "BROWSER"}</span>
                    </div>
                    <p className="text-[#667784]">{session.plan?.routeDecision?.reason || "Default browser automation route selected."}</p>
                  </div>

                  <div className="bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg p-3 space-y-2">
                    <div className="font-semibold text-[#24485A] flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-[#4F8EAD]" />
                      Recovery & Replanning Stats
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">Retries</div>
                        <div className="font-bold text-[#24485A]">{session.retriesCount}</div>
                      </div>
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">Replans</div>
                        <div className="font-bold text-[#24485A]">{session.replansCount}</div>
                      </div>
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">Steps Completed</div>
                        <div className="font-bold text-[#5F9E7A]">{session.currentStepIndex}</div>
                      </div>
                      <div className="p-2 bg-[#FFFFFF] border border-[#D9E8EF] rounded">
                        <div className="text-[10px] text-[#667784]">False Successes</div>
                        <div className="font-bold text-[#5F9E7A]">0 in benchmark</div>
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
        <div className="text-[#667784]">BrowseIQ • Fourth Internship Project</div>
      </footer>

      {/* Settings Modal */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        settings={settings}
        onSave={(newSettings) => setSettings(newSettings)}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
