"use client";

import { useState, useRef, useEffect } from "react";

export default function MediaTestFixturePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    // Generate a minimal animated synthetic canvas stream so the video element can genuinely play
    const video = videoRef.current;
    if (!video) return;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      let frame = 0;

      const draw = () => {
        if (!ctx) return;
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(160 + Math.sin(frame * 0.05) * 80, 120, 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f8fafc";
        ctx.font = "16px sans-serif";
        ctx.fillText(`Frame ${frame}`, 20, 30);
        frame++;
      };
      draw();

      if (typeof canvas.captureStream === "function") {
        const stream = canvas.captureStream(25);
        video.srcObject = stream;
        setInterval(draw, 40);
      }
    } catch {
      // Fallback
    }

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (video) setCurrentTime(Number(video.currentTime.toFixed(2)));
    };
    const onVolumeChange = () => {
      if (video) setIsMuted(video.muted);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("volumechange", onVolumeChange);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("volumechange", onVolumeChange);
    };
  }, []);

  const handlePlay = async () => {
    if (hasError) {
      setErrorMessage("Playback failed: DRM or format unsupported");
      return;
    }
    if (videoRef.current) {
      try {
        await videoRef.current.play();
        setIsPlaying(true);
      } catch (err: any) {
        setErrorMessage(err.message);
      }
    }
  };

  const handlePause = () => {
    if (videoRef.current) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleUnmute = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  return (
    <div style={{ padding: "30px", fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Media Discovery and Playback Test Fixture</h1>
      <p>Controlled test page for HTML5 video/audio playback, pause, mute, seek, and error handling.</p>

      <div style={{ border: "1px solid #cbd5e1", borderRadius: "8px", padding: "16px", marginTop: "20px" }}>
        <h2 data-testid="media-title">Nature Documentary Clip</h2>
        <p style={{ color: "#64748b" }}>Duration: 10s • Format: WebM / Canvas Stream</p>

        <video
          id="fixture-video"
          ref={videoRef}
          data-testid="fixture-video"
          width="100%"
          height="240"
          controls
          style={{ background: "#0f172a", borderRadius: "4px" }}
        />

        <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            id="play-button"
            data-testid="play-btn"
            aria-label="Play"
            onClick={handlePlay}
            style={{ padding: "8px 16px", background: "#0284c7", color: "white", borderRadius: "4px", border: "none", cursor: "pointer" }}
          >
            Play
          </button>
          <button
            id="pause-button"
            data-testid="pause-btn"
            aria-label="Pause"
            onClick={handlePause}
            style={{ padding: "8px 16px", background: "#475569", color: "white", borderRadius: "4px", border: "none", cursor: "pointer" }}
          >
            Pause
          </button>
          <button
            id="mute-button"
            data-testid="mute-btn"
            aria-label="Mute"
            onClick={isMuted ? handleUnmute : handleMute}
            style={{ padding: "8px 16px", background: "#64748b", color: "white", borderRadius: "4px", border: "none", cursor: "pointer" }}
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            id="simulate-error-btn"
            data-testid="error-btn"
            onClick={() => {
              setHasError(true);
              setErrorMessage("Simulated Media Error: MEDIA_ERR_SRC_NOT_SUPPORTED");
            }}
            style={{ padding: "8px 16px", background: "#ef4444", color: "white", borderRadius: "4px", border: "none", cursor: "pointer" }}
          >
            Simulate Playback Error
          </button>
        </div>

        <div style={{ marginTop: "20px", padding: "12px", background: "#f8fafc", borderRadius: "4px" }}>
          <div><strong>Playback State:</strong> <span data-testid="playback-status">{isPlaying ? "playing" : "paused"}</span></div>
          <div><strong>Audio State:</strong> <span data-testid="audio-status">{isMuted ? "muted" : "unmuted"}</span></div>
          <div><strong>Current Position:</strong> <span data-testid="current-time">{currentTime}s</span></div>
          {errorMessage && (
            <div data-testid="media-error" style={{ color: "#dc2626", marginTop: "8px", fontWeight: "bold" }}>
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
