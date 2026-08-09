"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface MusicPlayerHandle {
  play: (videoId: string, title?: string, thumbnail?: string | null) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  togglePause: () => void;
}

interface HistoryEntry {
  id: string;
  title?: string;
  thumbnail?: string | null;
}

const widgetStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 136,
  right: 24,
  width: 280,
  background: "linear-gradient(180deg, rgba(0, 14, 22, 0.82), rgba(0, 8, 16, 0.9))",
  border: "1px solid rgba(6, 182, 212, 0.35)",
  borderRadius: 16,
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  padding: "10px 12px",
  zIndex: 90,
};

const thumbStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 10,
  objectFit: "cover",
  border: "1px solid rgba(6, 182, 212, 0.3)",
  flexShrink: 0,
  background: "rgba(6, 182, 212, 0.08)",
};

const iconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: "50%",
  background: "rgba(6, 182, 212, 0.08)",
  border: "1px solid rgba(6, 182, 212, 0.4)",
  color: "#06b6d4",
  fontSize: 11,
  lineHeight: 1,
  cursor: "pointer",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

interface MusicPlayerProps {
  _unused?: never;
}

function postToPlayer(iframe: HTMLIFrameElement | null, func: "pauseVideo" | "playVideo") {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
}

const MusicPlayer = forwardRef<MusicPlayerHandle, MusicPlayerProps>(function MusicPlayer(_props, ref) {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [thumbnail, setThumbnail] = useState<string | null | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sağ/sol yumruk jestiyle önceki/sonraki şarkıya geçebilmek için — sesli
  // arama ile çalınan her parça bu geçmişe eklenir, next()/prev() içinde gezinir.
  const historyRef = useRef<HistoryEntry[]>([]);
  const indexRef = useRef(-1);

  function playAt(idx: number) {
    const entry = historyRef.current[idx];
    if (!entry) return;
    indexRef.current = idx;
    setVideoId(entry.id);
    setTitle(entry.title);
    setThumbnail(entry.thumbnail);
    setPaused(false);
  }

  function togglePause() {
    if (paused) {
      postToPlayer(iframeRef.current, "playVideo");
      setPaused(false);
    } else {
      postToPlayer(iframeRef.current, "pauseVideo");
      setPaused(true);
    }
  }

  useImperativeHandle(ref, () => ({
    play(id: string, t?: string, thumb?: string | null) {
      historyRef.current = [...historyRef.current.slice(0, indexRef.current + 1), { id, title: t, thumbnail: thumb }];
      indexRef.current = historyRef.current.length - 1;
      setVideoId(id);
      setTitle(t);
      setThumbnail(thumb);
      setPaused(false);
    },
    pause() {
      postToPlayer(iframeRef.current, "pauseVideo");
      setPaused(true);
    },
    resume() {
      postToPlayer(iframeRef.current, "playVideo");
      setPaused(false);
    },
    stop() {
      historyRef.current = [];
      indexRef.current = -1;
      setVideoId(null);
      setTitle(undefined);
      setThumbnail(undefined);
      setPaused(false);
    },
    next() {
      if (indexRef.current < historyRef.current.length - 1) playAt(indexRef.current + 1);
    },
    prev() {
      if (indexRef.current > 0) playAt(indexRef.current - 1);
    },
    togglePause,
  }));

  if (!videoId) return null;

  return (
    <div className="music-widget" style={widgetStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={title ?? "müzik"} style={thumbStyle} />
        ) : (
          <div style={thumbStyle} />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 9,
              opacity: 0.55,
              letterSpacing: "0.12em",
              marginBottom: 3,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 13 }}>
              <div
                className="music-eq-bar"
                style={{ animationDelay: "0s", animationPlayState: paused ? "paused" : "running" }}
              />
              <div
                className="music-eq-bar"
                style={{ animationDelay: "0.2s", animationPlayState: paused ? "paused" : "running" }}
              />
              <div
                className="music-eq-bar"
                style={{ animationDelay: "0.4s", animationPlayState: paused ? "paused" : "running" }}
              />
              <div
                className="music-eq-bar"
                style={{ animationDelay: "0.1s", animationPlayState: paused ? "paused" : "running" }}
              />
            </div>
            <span>{paused ? "DURAKLATILDI" : "ŞİMDİ ÇALIYOR"}</span>
          </div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              color: "#e6fbff",
            }}
          >
            {title ?? "Bilinmeyen parça"}
          </div>
        </div>

        <button
          type="button"
          aria-label={paused ? "Devam et" : "Duraklat"}
          style={iconBtnStyle}
          onClick={togglePause}
        >
          {paused ? "▶" : "⏸"}
        </button>

        <button
          type="button"
          aria-label="Müziği kapat"
          style={iconBtnStyle}
          onClick={() => {
            setVideoId(null);
            setTitle(undefined);
            setThumbnail(undefined);
            setPaused(false);
          }}
        >
          ✕
        </button>
      </div>

      {/* Görsel olarak gizli — sadece ses için, YouTube IFrame kaldırılınca sesi de duruyor */}
      <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>
        <iframe
          key={videoId}
          ref={iframeRef}
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`}
          allow="autoplay; encrypted-media"
          style={{ width: 1, height: 1, border: "none" }}
        />
      </div>
    </div>
  );
});

export default MusicPlayer;
