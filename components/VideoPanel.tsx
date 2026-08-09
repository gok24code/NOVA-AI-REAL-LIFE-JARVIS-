"use client";

import { useRef, useState } from "react";
import type { OrbSceneApi } from "@/lib/orbScene";

const panelStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 80,
  left: "50%",
  transform: "translateX(-50%)",
  width: 280,
  background: "rgba(0, 8, 16, 0.88)",
  border: "1px solid rgba(6, 182, 212, 0.3)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 11,
  letterSpacing: "0.1em",
  padding: 12,
  zIndex: 100,
};

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(6, 182, 212, 0.5)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 10,
  letterSpacing: "0.1em",
  padding: "3px 8px",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  ...btnStyle,
  flex: 1,
  padding: "3px 6px",
  background: "rgba(0,0,0,0.3)",
};

export default function VideoPanel({ scene }: { scene: OrbSceneApi | null }) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const localUrlRef = useRef<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !scene) return;
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const url = URL.createObjectURL(file);
    localUrlRef.current = url;
    scene.loadVideo(url);
  }

  function loadUrl() {
    if (!urlInput.trim() || !scene) return;
    scene.loadVideo(urlInput.trim());
  }

  function stop() {
    scene?.stopVideo();
    if (localUrlRef.current) {
      URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = null;
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...btnStyle,
          position: "fixed",
          bottom: 50,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 101,
        }}
      >
        VID
      </button>

      {open && (
        <div style={panelStyle}>
          <div style={{ marginBottom: 8, fontSize: 10, opacity: 0.7 }}>// VIDEO PANEL</div>

          <div style={{ marginBottom: 8 }}>
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              style={{ display: "none" }}
              onChange={handleFile}
            />
            <button
              type="button"
              style={btnStyle}
              onClick={() => fileRef.current?.click()}
            >
              DOSYA SEÇ
            </button>
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="video URL..."
              style={inputStyle}
              onKeyDown={(e) => e.key === "Enter" && loadUrl()}
            />
            <button type="button" style={btnStyle} onClick={loadUrl}>
              YÜKLE
            </button>
          </div>

          <button type="button" style={{ ...btnStyle, width: "100%" }} onClick={stop}>
            DURDUR
          </button>
        </div>
      )}
    </>
  );
}
