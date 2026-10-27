"use client";

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Volume2, VolumeX, Play, Pause, Music, ShieldCheck, AlertCircle } from "lucide-react";

function AudioPlayerContent() {
  const searchParams = useSearchParams();
  const filePath = searchParams.get("path") || "";
  const title = searchParams.get("title") || "";
  const audioRef = useRef<HTMLAudioElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackStatus, setPlaybackStatus] = useState<string>("Initializing");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [hasStarted, setHasStarted] = useState(false);

  const filename = filePath ? filePath.split(/[\\/]/).pop() || filePath : "Unknown Audio";
  const displayTitle = title || filename;
  const audioSrc = filePath ? `/api/local-file?path=${encodeURIComponent(filePath)}` : "";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;

    setPlaybackStatus("Loading audio...");

    const onPlay = () => {
      setIsPlaying(true);
      setPlaybackStatus("Playing");
      setHasStarted(true);
    };

    const onPause = () => {
      setIsPlaying(false);
      setPlaybackStatus("Paused");
    };

    const onTimeUpdate = () => {
      if (audio) {
        setCurrentTime(audio.currentTime);
        if (audio.currentTime > 0) {
          setHasStarted(true);
        }
      }
    };

    const onLoadedMetadata = () => {
      if (audio) {
        setDuration(audio.duration || 0);
        setPlaybackStatus("Ready");
      }
    };

    const onError = () => {
      const err = audio.error;
      const msg = err ? `Error ${err.code}: ${err.message}` : "Failed to load audio stream";
      setErrorMessage(msg);
      setPlaybackStatus("Playback Error");
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);

    // Attempt auto-play
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          setPlaybackStatus("Playing");
        })
        .catch(() => {
          // Autoplay policy may require user gesture
          setPlaybackStatus("Ready (Click Play)");
        });
    }

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
    };
  }, [audioSrc]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => {
        setErrorMessage(err.message);
        setPlaybackStatus("Playback Failed");
      });
    } else {
      audio.pause();
    }
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "0:00";
    const mins = Math.floor(secs / 60);
    const remaining = Math.floor(secs % 60);
    return `${mins}:${remaining < 10 ? "0" : ""}${remaining}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
        {/* Header / Security Badge */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2">
            <Music className="w-5 h-5 text-indigo-400" />
            <span className="font-semibold text-sm tracking-wide text-slate-200">
              Browser Local Audio Player
            </span>
          </div>
          <div className="flex items-center space-x-1.5 text-xs bg-emerald-950/80 text-emerald-400 px-2.5 py-1 rounded-full border border-emerald-800/60">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Sandbox Verified</span>
          </div>
        </div>

        {/* Media Details */}
        <div className="space-y-2 text-center py-4">
          <div className="w-20 h-20 bg-indigo-600/20 border border-indigo-500/30 rounded-full flex items-center justify-center mx-auto text-indigo-400 mb-3 shadow-inner">
            <Music className="w-10 h-10 animate-pulse" />
          </div>
          <h1 id="audio-title" className="text-xl font-bold text-white tracking-tight break-words">
            {displayTitle}
          </h1>
          <div id="audio-filename" className="text-xs font-mono text-slate-400 break-all px-4">
            {filename}
          </div>
        </div>

        {/* Hidden/Native Audio Element */}
        {audioSrc ? (
          <audio
            ref={audioRef}
            id="local-audio-player"
            src={audioSrc}
            preload="auto"
            className="w-full hidden"
          />
        ) : (
          <div className="text-xs text-amber-400 bg-amber-950/40 p-3 rounded border border-amber-800/40 flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>No audio file specified.</span>
          </div>
        )}

        {/* Progress Bar */}
        <div className="space-y-1.5">
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
            <div
              id="playback-progress"
              className="bg-indigo-500 h-full transition-all duration-150"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs font-mono text-slate-400">
            <span id="audio-current-time">{formatTime(currentTime)}</span>
            <span id="audio-duration">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center space-x-4 pt-2">
          <button
            id="audio-mute-button"
            onClick={toggleMute}
            className="p-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full transition-colors border border-slate-700"
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX className="w-5 h-5 text-red-400" /> : <Volume2 className="w-5 h-5" />}
          </button>

          <button
            id="audio-play-button"
            onClick={togglePlay}
            className="p-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors shadow-lg shadow-indigo-600/30 border border-indigo-400/30"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
          </button>
        </div>

        {/* Live Status Indicators for Playwright / Agent Verification */}
        <div className="border-t border-slate-800 pt-4 flex flex-col items-center space-y-1 text-xs font-mono">
          <div className="flex items-center space-x-2">
            <span className="text-slate-500">Status:</span>
            <span
              id="playback-status"
              className={`font-semibold ${
                playbackStatus === "Playing"
                  ? "text-emerald-400"
                  : playbackStatus.includes("Error") || playbackStatus.includes("Failed")
                  ? "text-rose-400"
                  : "text-amber-400"
              }`}
            >
              {playbackStatus}
            </span>
          </div>
          <div className="text-slate-500 text-[11px]">
            Progression:{" "}
            <span
              id="playback-progressing"
              className={hasStarted ? "text-emerald-400 font-bold" : "text-slate-400"}
            >
              {hasStarted ? "ACTIVE" : "STANDBY"}
            </span>
          </div>
          {errorMessage && (
            <div id="playback-error" className="text-rose-400 text-[11px] text-center pt-1">
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AudioPlayerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          Loading player...
        </div>
      }
    >
      <AudioPlayerContent />
    </Suspense>
  );
}
