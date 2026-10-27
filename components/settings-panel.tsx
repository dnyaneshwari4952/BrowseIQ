"use client";

import React, { useState, useEffect } from "react";
import {
  Sliders,
  X,
  Check,
  Save,
  FolderLock,
  ShieldCheck,
  AlertCircle,
  HardDrive,
  FolderCheck,
  AlertTriangle,
  Plus,
  Trash2,
} from "lucide-react";

export type LocalAccessMode = "selected_folders" | "whole_computer";

export interface AgentSettings {
  actionTimeout: number;
  maxRetries: number;
  maxReplans: number;
  requireConfirmation: boolean;
  localFilesEnabled?: boolean;
  accessMode?: LocalAccessMode;
  wholeComputerConfirmed?: boolean;
  approvedDirectories?: string[];
  approvedDirectory?: string;
}

interface SettingsPanelProps {
  isOpen: boolean;
  settings?: AgentSettings;
  onSave?: (settings: AgentSettings) => void;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, settings, onSave, onClose }: SettingsPanelProps) {
  const [actionTimeout, setActionTimeout] = useState(settings?.actionTimeout ?? 15000);
  const [maxRetries, setMaxRetries] = useState(settings?.maxRetries ?? 3);
  const [maxReplans, setMaxReplans] = useState(settings?.maxReplans ?? 3);
  const [requireConfirmation, setRequireConfirmation] = useState(settings?.requireConfirmation ?? true);

  // Local Storage Access Settings
  const [localFilesEnabled, setLocalFilesEnabled] = useState(settings?.localFilesEnabled ?? false);
  const [accessMode, setAccessMode] = useState<LocalAccessMode>(settings?.accessMode ?? "selected_folders");
  const [wholeComputerConfirmed, setWholeComputerConfirmed] = useState(settings?.wholeComputerConfirmed ?? false);
  const [approvedDirectories, setApprovedDirectories] = useState<string[]>(
    settings?.approvedDirectories ?? (settings?.approvedDirectory ? [settings.approvedDirectory] : [])
  );
  const [userLibraries, setUserLibraries] = useState<Record<string, string>>({});
  const [newCustomPath, setNewCustomPath] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/local-file/permission")
        .then((res) => res.json())
        .then((data) => {
          if (data) {
            if (settings?.localFilesEnabled !== undefined) {
              setLocalFilesEnabled(settings.localFilesEnabled);
            } else if (data.enabled !== undefined) {
              setLocalFilesEnabled(data.enabled);
            }

            if (settings?.accessMode) {
              setAccessMode(settings.accessMode);
            } else if (data.accessMode) {
              setAccessMode(data.accessMode);
            }

            if (settings?.wholeComputerConfirmed !== undefined) {
              setWholeComputerConfirmed(settings.wholeComputerConfirmed);
            } else if (data.wholeComputerConfirmed !== undefined) {
              setWholeComputerConfirmed(data.wholeComputerConfirmed);
            }

            if (data.userLibraryDirectories) {
              setUserLibraries(data.userLibraryDirectories);
            }

            if (settings?.approvedDirectories && settings.approvedDirectories.length > 0) {
              setApprovedDirectories(settings.approvedDirectories);
            } else if (Array.isArray(data.approvedDirectories) && data.approvedDirectories.length > 0) {
              setApprovedDirectories(data.approvedDirectories);
            } else if (data.defaultDirectory) {
              setApprovedDirectories([data.defaultDirectory]);
            }
          }
        })
        .catch(() => {});
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleModeChange = (newMode: LocalAccessMode) => {
    if (newMode === "whole_computer") {
      if (!wholeComputerConfirmed) {
        setShowConfirmModal(true);
        return;
      }
      setAccessMode("whole_computer");
    } else {
      setAccessMode("selected_folders");
    }
  };

  const confirmWholeComputer = () => {
    setWholeComputerConfirmed(true);
    setAccessMode("whole_computer");
    setShowConfirmModal(false);
  };

  const cancelWholeComputer = () => {
    setShowConfirmModal(false);
    setAccessMode("selected_folders");
  };

  const toggleLibraryDirectory = (dirPath: string) => {
    if (!dirPath) return;
    setApprovedDirectories((prev) => {
      const exists = prev.some((d) => d.toLowerCase() === dirPath.toLowerCase());
      if (exists) {
        // Keep at least one directory if possible
        const remaining = prev.filter((d) => d.toLowerCase() !== dirPath.toLowerCase());
        return remaining.length > 0 ? remaining : prev;
      }
      return [...prev, dirPath];
    });
  };

  const addCustomDirectory = () => {
    const trimmed = newCustomPath.trim();
    if (!trimmed) return;
    if (!approvedDirectories.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      setApprovedDirectories((prev) => [...prev, trimmed]);
    }
    setNewCustomPath("");
  };

  const removeDirectory = (dirPath: string) => {
    setApprovedDirectories((prev) => {
      const remaining = prev.filter((d) => d.toLowerCase() !== dirPath.toLowerCase());
      return remaining.length > 0 ? remaining : prev;
    });
  };

  const handleSave = async () => {
    const primaryDir = approvedDirectories[0] || userLibraries.downloads || "";
    try {
      await fetch("/api/local-file/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: localFilesEnabled,
          accessMode,
          wholeComputerConfirmed,
          approvedDirectories,
          approvedDirectory: primaryDir,
        }),
      });
    } catch {}

    if (onSave) {
      onSave({
        actionTimeout,
        maxRetries: Math.min(5, Math.max(0, maxRetries)),
        maxReplans: Math.min(5, Math.max(0, maxReplans)),
        requireConfirmation,
        localFilesEnabled,
        accessMode,
        wholeComputerConfirmed,
        approvedDirectories,
        approvedDirectory: primaryDir,
      });
    }
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#24485A]/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#FFFFFF] border border-[#D9E8EF] rounded-lg max-w-lg w-full p-6 shadow-dropdown space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#D9E8EF] pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[#4F8EAD]" />
            <h3 className="text-base font-semibold text-[#24485A]">Agent & Automation Settings</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#667784] hover:text-[#24485A] rounded hover:bg-[#F0F7FA] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3.5 text-xs">
          {/* Visible Browser Execution */}
          <div className="flex items-center justify-between p-3 bg-[#EEF6FB] border border-[#D9E8EF] rounded-lg">
            <div>
              <div className="font-semibold text-[#24485A] flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#5F9E7A]"></span>
                Visible Browser Execution
              </div>
              <div className="text-[#667784] text-[11px]">Every task opens an isolated, visible Playwright browser window</div>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[#FFFFFF] text-[#24485A] border border-[#D9E8EF]">
              Enforced
            </span>
          </div>

          {/* Redesigned Local Storage Access (Section 1) */}
          <div className="p-3.5 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <div className="font-semibold text-[#24485A] flex items-center gap-1.5">
                  <FolderLock className="w-4 h-4 text-[#4F8EAD]" />
                  <span>Local Storage Access</span>
                </div>
                <div className="text-[#667784] text-[11px]">
                  Allow the agent to find and open files in authorized locations on this computer.
                </div>
              </div>
              <input
                id="toggle-local-files-permission"
                type="checkbox"
                checked={localFilesEnabled}
                onChange={(e) => setLocalFilesEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#4F8EAD] rounded cursor-pointer mt-0.5"
              />
            </div>

            {/* Active Permission Status Badge */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#667784]">Current Status:</span>
              <span
                id="local-file-permission-state"
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                  !localFilesEnabled
                    ? "bg-slate-100 text-slate-600 border-slate-300"
                    : accessMode === "whole_computer"
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : "bg-emerald-50 text-emerald-700 border-emerald-200"
                }`}
              >
                {!localFilesEnabled
                  ? "Disabled"
                  : accessMode === "whole_computer"
                  ? "Enabled (Whole Computer • Read-Only)"
                  : "Enabled (Selected Folders • Read-Only)"}
              </span>
            </div>

            {/* Access Mode Selector */}
            {localFilesEnabled && (
              <div className="space-y-2.5 pt-1 border-t border-[#E2EEF4]">
                <div className="text-[#24485A] font-semibold text-[11px]">Access Scope:</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    id="mode-selected-folders-btn"
                    onClick={() => handleModeChange("selected_folders")}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${
                      accessMode === "selected_folders"
                        ? "bg-[#EEF6FB] border-[#4F8EAD] text-[#1F2933] font-medium shadow-xs"
                        : "bg-[#FFFFFF] border-[#D9E8EF] text-[#667784] hover:border-[#B2D4E5]"
                    }`}
                  >
                    <FolderCheck className="w-4 h-4 text-[#4F8EAD] shrink-0" />
                    <div>
                      <div className="text-[11px] font-semibold">Selected folders</div>
                      <div className="text-[10px] text-[#667784] leading-tight">Authorize specific user library folders</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="mode-whole-computer-btn"
                    onClick={() => handleModeChange("whole_computer")}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border text-left transition-all ${
                      accessMode === "whole_computer"
                        ? "bg-indigo-50/80 border-indigo-400 text-[#1F2933] font-medium shadow-xs"
                        : "bg-[#FFFFFF] border-[#D9E8EF] text-[#667784] hover:border-[#B2D4E5]"
                    }`}
                  >
                    <HardDrive className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <div className="text-[11px] font-semibold">Whole computer</div>
                      <div className="text-[10px] text-[#667784] leading-tight">Search across accessible non-system drives</div>
                    </div>
                  </button>
                </div>

                {/* Selected Folders View */}
                {accessMode === "selected_folders" && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-100">
                    <div className="text-[11px] text-[#667784]">Authorized Folders:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { key: "downloads", label: "Downloads", path: userLibraries.downloads },
                        { key: "documents", label: "Documents", path: userLibraries.documents },
                        { key: "desktop", label: "Desktop", path: userLibraries.desktop },
                        { key: "music", label: "Music", path: userLibraries.music },
                        { key: "videos", label: "Videos", path: userLibraries.videos },
                      ].map((item) => {
                        const isApproved = approvedDirectories.some(
                          (d) => d.toLowerCase() === (item.path || "").toLowerCase()
                        );
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => toggleLibraryDirectory(item.path)}
                            className={`px-2 py-1 rounded-md text-[10px] font-medium border flex items-center gap-1 transition-colors ${
                              isApproved
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold"
                                : "bg-[#FFFFFF] text-slate-500 border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            <span>{isApproved ? "✓" : "+"}</span>
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Active Directory Paths */}
                    <div className="space-y-1 pt-1">
                      {approvedDirectories.map((dir) => (
                        <div
                          key={dir}
                          className="flex items-center justify-between bg-[#FFFFFF] border border-[#D9E8EF] px-2 py-1 rounded text-[10px] font-mono text-[#1F2933]"
                        >
                          <span className="truncate pr-2">{dir}</span>
                          {approvedDirectories.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeDirectory(dir)}
                              className="text-slate-400 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Add Custom Directory */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <input
                        type="text"
                        value={newCustomPath}
                        onChange={(e) => setNewCustomPath(e.target.value)}
                        placeholder="Add another folder path (e.g. D:\Music)..."
                        className="flex-1 bg-[#FFFFFF] border border-[#D9E8EF] rounded px-2 py-1 text-[#1F2933] font-mono text-[10px] focus:outline-none focus:border-[#6FA8C5]"
                      />
                      <button
                        type="button"
                        onClick={addCustomDirectory}
                        className="px-2.5 py-1 bg-[#EEF6FB] hover:bg-[#D9E8EF] text-[#24485A] rounded text-[10px] font-medium border border-[#B2D4E5] flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add</span>
                      </button>
                    </div>

                    <div className="text-[10px] text-[#667784] flex items-center gap-1 pt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Strict read-only boundary: Traversal outside authorized folders is blocked.</span>
                    </div>
                  </div>
                )}

                {/* Whole Computer View */}
                {accessMode === "whole_computer" && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-100">
                    <div className="p-2.5 bg-indigo-50/60 border border-indigo-200/80 rounded-md space-y-1">
                      <div className="flex items-center gap-1.5 text-indigo-900 font-semibold text-[11px]">
                        <HardDrive className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Whole-Computer Access Active</span>
                      </div>
                      <div className="text-[10px] text-indigo-800 leading-normal">
                        The agent can search accessible storage across this PC under your Windows user account.
                        Protected system files (<code>C:\Windows</code>), browser profiles, app data, and credentials remain strictly excluded and protected.
                      </div>
                    </div>
                    <div className="text-[10px] text-[#667784] flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>Read-only access: Files are never modified, deleted, uploaded, or executed.</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* High-Risk Action Guardrail */}
          <div className="flex items-center justify-between p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg">
            <div>
              <div className="font-semibold text-[#24485A]">High-Risk Action Guardrail</div>
              <div className="text-[#667784] text-[11px]">Require explicit human confirmation for submissions or deletions</div>
            </div>
            <input
              type="checkbox"
              checked={requireConfirmation}
              onChange={(e) => setRequireConfirmation(e.target.checked)}
              className="w-4 h-4 accent-[#4F8EAD] rounded cursor-pointer"
            />
          </div>

          {/* Action Timeout */}
          <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="font-semibold text-[#24485A]">Default Action Timeout</span>
              <span className="font-mono text-[#4F8EAD] font-semibold">{actionTimeout / 1000}s</span>
            </div>
            <input
              type="range"
              min="5000"
              max="60000"
              step="5000"
              value={actionTimeout}
              onChange={(e) => setActionTimeout(Number(e.target.value))}
              className="w-full accent-[#4F8EAD] cursor-pointer"
            />
          </div>

          {/* Retries and Replans */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-1">
              <label className="font-semibold text-[#24485A] block">Max Retries</label>
              <input
                type="number"
                min="0"
                max="5"
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="w-full bg-[#FFFFFF] border border-[#D9E8EF] rounded p-1.5 text-[#1F2933] font-mono focus:outline-none focus:border-[#6FA8C5]"
              />
            </div>
            <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-lg space-y-1">
              <label className="font-semibold text-[#24485A] block">Max Replans</label>
              <input
                type="number"
                min="0"
                max="5"
                value={maxReplans}
                onChange={(e) => setMaxReplans(Number(e.target.value))}
                className="w-full bg-[#FFFFFF] border border-[#D9E8EF] rounded p-1.5 text-[#1F2933] font-mono focus:outline-none focus:border-[#6FA8C5]"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#D9E8EF]">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] rounded text-xs font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 bg-[#4F8EAD] hover:bg-[#3D708A] text-white rounded text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm"
          >
            {saved ? <Check className="w-4 h-4 text-emerald-300" /> : <Save className="w-4 h-4" />}
            <span>{saved ? "Saved" : "Save Changes"}</span>
          </button>
        </div>
      </div>

      {/* Whole Computer Explicit Confirmation Modal (Requirement 1 & 5) */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-60 bg-[#24485A]/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-amber-300 rounded-lg max-w-md w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-full text-amber-700 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-[#24485A]">Confirm Whole-Computer Storage Access</h4>
                <p className="text-xs text-[#667784] leading-relaxed">
                  You are about to enable Whole-Computer local storage access.
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#F7FAFC] border border-[#D9E8EF] rounded-md text-xs text-[#24485A] space-y-1.5 leading-normal">
              <div><strong>Scope & Security Boundaries:</strong></div>
              <ul className="list-disc pl-4 space-y-1 text-[#667784] text-[11px]">
                <li>The agent will search accessible storage across your Windows drives (e.g. C:, D:).</li>
                <li>Operates strictly with your current Windows user account privileges (no privilege elevation).</li>
                <li>Protected system directories (<code>C:\Windows</code>, <code>Program Files</code>), browser user profiles, credentials, and app data remain <strong>strictly excluded</strong>.</li>
                <li>Access is <strong>strictly read-only</strong> (no modifying, deleting, uploading, or executing files).</li>
                <li>File contents and filesystem listings are <strong>never</strong> transmitted to external AI providers.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-[#D9E8EF]">
              <button
                type="button"
                onClick={cancelWholeComputer}
                className="px-3 py-1.5 bg-[#FFFFFF] hover:bg-[#F0F7FA] text-[#24485A] border border-[#D9E8EF] rounded text-xs font-medium"
              >
                Keep Selected Folders Only
              </button>
              <button
                type="button"
                id="confirm-whole-computer-btn"
                onClick={confirmWholeComputer}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold shadow-xs"
              >
                Confirm Whole Computer Access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
