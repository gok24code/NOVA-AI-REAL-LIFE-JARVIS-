"use client";

import { useEffect } from "react";

interface Props {
  videoId: string | null;
  title?: string;
  onClose: () => void;
}

export default function VideoOverlay({ videoId, title, onClose }: Props) {
  useEffect(() => {
    if (!videoId) return;
    function handleMessage(event: MessageEvent) {
      if (event.origin !== "https://www.youtube.com") return;
      try {
        const data = JSON.parse(event.data as string) as { event?: string; info?: number };
        // state 0 = ended
        if (data.event === "onStateChange" && data.info === 0) {
          onClose();
        }
      } catch {}
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [videoId, onClose]);

  if (!videoId) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 4, 8, 0.92)",
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Courier New, monospace",
      }}
    >
      {title && (
        <div
          style={{
            color: "#06b6d4",
            fontSize: 12,
            letterSpacing: "0.1em",
            marginBottom: 12,
            opacity: 0.8,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ position: "relative", width: "80vw", maxWidth: 960 }}>
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          style={{
            width: "100%",
            aspectRatio: "16/9",
            border: "1px solid rgba(6, 182, 212, 0.4)",
            background: "#000",
            display: "block",
          }}
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          marginTop: 16,
          background: "transparent",
          border: "1px solid rgba(6, 182, 212, 0.4)",
          color: "#06b6d4",
          fontFamily: "Courier New, monospace",
          fontSize: 11,
          letterSpacing: "0.12em",
          padding: "5px 16px",
          cursor: "pointer",
        }}
      >
        ✕ KAPAT
      </button>
    </div>
  );
}
