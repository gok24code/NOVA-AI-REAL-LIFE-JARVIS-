"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";
import { useVoice } from "@/lib/useVoice";
import { useAlwaysOn } from "@/lib/useAlwaysOn";
import { useModelLibrary } from "@/lib/useModelLibrary";
import { useObjectDetector } from "@/lib/useObjectDetector";
import VideoOverlay from "./VideoOverlay";
import ObjectScanner, { type ObjectScannerHandle } from "./ObjectScanner";
import ProjectForm, { type ProjectFormHandle } from "./ProjectForm";
import ModelBrowser, { type ModelBrowserHandle, type ThingSearchTrigger } from "./ModelBrowser";
import MapView, { type MapViewHandle } from "./MapView";
import MusicPlayer, { type MusicPlayerHandle } from "./MusicPlayer";

type CameraState = "off" | "starting" | "on" | "error";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};


export default function NovaOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const sceneRef     = useRef<OrbSceneApi | null>(null);
  const trackerRef   = useRef<HandTracker | null>(null);

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [camError, setCamError] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [sceneReady, setSceneReady] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string | undefined>(undefined);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [thingSearchTrigger, setThingSearchTrigger] = useState<ThingSearchTrigger | null>(null);
  const [modelBrowserOpen, setModelBrowserOpen] = useState(false);
  const modelBrowserRef = useRef<ModelBrowserHandle | null>(null);
  const scannerRef = useRef<ObjectScannerHandle | null>(null);
  const projectFormRef = useRef<ProjectFormHandle | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const mapViewRef = useRef<MapViewHandle | null>(null);
  const musicPlayerRef = useRef<MusicPlayerHandle | null>(null);

  const modelLib = useModelLibrary(sceneReady ? sceneRef.current : null);
  const detector = useObjectDetector();

  const alwaysOnRef = useRef<(() => void) | null>(null);
  const captureFrameRef = useRef<(() => { imageBase64: string; mimeType: string } | null) | null>(null);
  const speakTextRef = useRef<((text: string) => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const searchYouTube = useCallback(async (query: string) => {
    const apiKey = /* can't access env client-side, always go through API route */ undefined;
    void apiKey;
    try {
      const res = await fetch(`/api/youtube?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        // no YouTube API key — open YouTube search in new tab as fallback
        window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank");
        return;
      }
      const data = (await res.json()) as { videoId?: string; title?: string; error?: string };
      if (data.videoId) {
        setVideoId(data.videoId);
        setVideoTitle(data.title);
      } else {
        // Fallback: open YouTube search
        window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank");
      }
    } catch {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank");
    }
  }, []);

  const playMusic = useCallback(async (query: string) => {
    try {
      const res = await fetch(`/api/youtube?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        setCommandLog((prev) => [...prev.slice(-9), `◈ ${query} için müzik bulunamadı.`]);
        return;
      }
      const data = (await res.json()) as { videoId?: string; title?: string; thumbnail?: string | null; error?: string };
      if (data.videoId) {
        musicPlayerRef.current?.play(data.videoId, data.title, data.thumbnail);
      } else {
        setCommandLog((prev) => [...prev.slice(-9), `◈ ${query} için müzik bulunamadı.`]);
      }
    } catch {
      setCommandLog((prev) => [...prev.slice(-9), `◈ ${query} için müzik bulunamadı.`]);
    }
  }, []);

  const describeScene = useCallback(async () => {
    if (!captureFrameRef.current) {
      speakTextRef.current?.("Kamera aktif değil. Önce kamerayı aç.");
      return;
    }
    speakTextRef.current?.("Bakıyorum…");
    // 1 saniye bekle — kamera pozlanmasını tamamlasın, daha temiz frame gelsin
    await new Promise<void>((res) => setTimeout(res, 1000));
    const capture = captureFrameRef.current?.();
    if (!capture) return;
    const dataUrl = `data:${capture.mimeType};base64,${capture.imageBase64}`;
    const description = await detector.describeScene(dataUrl);
    speakTextRef.current?.(description);
  }, [detector]);

  const voice = useVoice(
    (transcript) => {
      if (transcript) {
        setCommandLog((prev) => [...prev.slice(-9), `🎤 ${transcript}`]);
        sceneRef.current?.setCoreLabel(transcript.toUpperCase().slice(0, 24));
      }
    },
    (intent) => {
      switch (intent) {
        case "zoom_in":
          sceneRef.current?.startZoomIn();
          setTimeout(() => sceneRef.current?.stopZoom(), 700);
          break;
        case "zoom_out":
          sceneRef.current?.startZoomOut();
          setTimeout(() => sceneRef.current?.stopZoom(), 700);
          break;
        case "reset":
          sceneRef.current?.resetView();
          break;
        case "sleep":
          alwaysOnRef.current?.();
          break;
        case "pick_folder":
          if (modelLib.files.length > 0) {
            // Bu oturumda klasör zaten seçilmiş — tekrar sormadan direkt göster
            void modelLib.showLoaded().then((msg) => {
              if (msg) setCommandLog((prev) => [...prev.slice(-9), `◈ ${msg}`]);
            });
          } else if (window.electronAPI?.loadFixedModelFolder) {
            // Electron: sesli komutla tetiklenen bir dosya diyaloğu "user
            // activation" hatası veriyor (bkz. electron/preload.js) — bunun
            // yerine sabit Masaüstü\models klasöründen dialogsuz yükle.
            void window.electronAPI.loadFixedModelFolder().then((picked) => {
              if (!picked) {
                setCommandLog((prev) => [...prev.slice(-9), "◈ Masaüstündeki models klasörü bulunamadı."]);
                return;
              }
              void modelLib.loadPickedFolder(picked).then((loadedMsg) => {
                setCommandLog((prev) => [...prev.slice(-9), `◈ ${loadedMsg}`]);
              });
            });
          } else {
            fileInputRef.current?.click();
          }
          break;
        case "next_model":
          void modelLib.loadNext().then((msg) => {
            setCommandLog((prev) => [...prev.slice(-9), `◈ ${msg}`]);
          });
          break;
        case "prev_model":
          void modelLib.loadPrev().then((msg) => {
            setCommandLog((prev) => [...prev.slice(-9), `◈ ${msg}`]);
          });
          break;
        case "clear_model":
          modelLib.clearModel();
          break;
        case "open_scanner":
          setScannerOpen(true);
          break;
        case "close_scanner":
          setScannerOpen(false);
          break;
        case "describe_scene":
          void describeScene();
          break;
        case "open_project_form":
          setProjectFormOpen(true);
          break;
        case "close_project_form":
          setProjectFormOpen(false);
          break;
        case "select_model_1":
          modelBrowserRef.current?.selectResult(0);
          break;
        case "select_model_2":
          modelBrowserRef.current?.selectResult(1);
          break;
        case "select_model_3":
          modelBrowserRef.current?.selectResult(2);
          break;
        case "cancel":
          if (scannerOpen) scannerRef.current?.cancel();
          if (projectFormOpen) projectFormRef.current?.cancel();
          if (modelBrowserOpen) modelBrowserRef.current?.cancel();
          if (mapOpen) mapViewRef.current?.cancel();
          musicPlayerRef.current?.stop();
          break;
        case "close_map":
          mapViewRef.current?.cancel();
          break;
        case "pause_music":
          musicPlayerRef.current?.pause();
          break;
        case "resume_music":
          musicPlayerRef.current?.resume();
          break;
        case "close_music":
          musicPlayerRef.current?.stop();
          break;
      }
    },
    (query) => {
      // onVideoRequest
      void searchYouTube(query);
    },
    (name) => {
      // onModelLoad
      void modelLib.loadByName(name).then((msg) => {
        setCommandLog((prev) => [...prev.slice(-9), `◈ ${msg}`]);
      });
    },
    (query) => {
      // onModelSearch — Thingiverse'de otomatik ara + ilk sonucu indirip yükle
      setThingSearchTrigger({ query, id: Date.now() });
    },
    (city) => {
      // onMapRequest
      mapViewRef.current?.showCity(city);
    },
    (query) => {
      // onMusicRequest
      void playMusic(query);
    },
  );

  const alwaysOn    = useAlwaysOn(voice);
  alwaysOnRef.current = alwaysOn.goToSleep;
  speakTextRef.current = voice.speakText;

  // Voice hazır olduğunda wake word dinlemeyi otomatik başlat (tek sefer)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartedRef.current && voice.modelStatus === "ready" && voice.ollamaChecked) {
      autoStartedRef.current = true;
      alwaysOn.toggle();
    }
  }, [voice.modelStatus, voice.ollamaChecked, alwaysOn.toggle]);

  // Yanıtı da log'a yaz
  const prevResponseRef = useRef("");
  useEffect(() => {
    if (voice.lastResponse && voice.lastResponse !== prevResponseRef.current) {
      prevResponseRef.current = voice.lastResponse;
      setCommandLog((prev) => [...prev.slice(-9), `◈ ${voice.lastResponse}`]);
    }
  }, [voice.lastResponse]);

  // Scanner, proje formu, 3D model tarayıcı veya harita açık/kapalıyken orb focus modunu güncelle
  useEffect(() => {
    if (sceneReady) sceneRef.current?.setFocus(scannerOpen || projectFormOpen || modelBrowserOpen || mapOpen);
  }, [scannerOpen, projectFormOpen, modelBrowserOpen, mapOpen, sceneReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = createOrbScene(container);
    sceneRef.current = scene;
    setSceneReady(true);
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
  }, []);

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;
    setCamera("starting");
    setCamError(null);
    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
      // Üç parmak: müziği duraklat/devam ettir. Sağ el yumruk: önceki şarkı,
      // sol el yumruk: sonraki şarkı.
      onThreeFingers: () => musicPlayerRef.current?.togglePause(),
      onFist: (hand) => {
        if (hand === "Right") musicPlayerRef.current?.prev();
        else musicPlayerRef.current?.next();
      },
    });
    trackerRef.current = tracker;
    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setCamError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "KAMERA ERİŞİMİ REDDEDİLDİ"
          : "TAKİP BAŞLATMA HATASI",
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.repeat) return;
      switch (e.key) {
        case "+": case "=": sceneRef.current?.startZoomIn(); break;
        case "-": case "_": sceneRef.current?.startZoomOut(); break;
        case "r": case "R": sceneRef.current?.resetView(); break;
        case "g": case "G": toggleGestures(); break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (["+", "=", "-", "_"].includes(e.key)) {
        sceneRef.current?.stopZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toggleGestures, voice]);

  const sendCommand = useCallback(() => {
    const cmd = commandInput.trim();
    if (!cmd) return;
    setCommandLog((prev) => [...prev.slice(-9), `> ${cmd}`]);
    sceneRef.current?.setCoreLabel(cmd.toUpperCase().slice(0, 24));
    setCommandInput("");
    voice.sendText(cmd);
  }, [commandInput, voice]);

  const handleCommandKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") sendCommand();
    },
    [sendCommand],
  );


  const cameraOn = camera === "on";

  return (
    <>
      <div ref={containerRef} className="orb-root" />
      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">N.O.V.A.</div>

      <div className="hud hud-hint">
        <div>
          <span className="key">SÜRÜKLE</span> döndür&nbsp;&nbsp;
          <span className="key">KAYDIR</span> zoom
        </div>
        {cameraOn ? (
          <div>
            <span className="key">PINCH + HAREKET</span> döndür&nbsp;&nbsp;
            <span className="key">İKİ EL ± AÇ</span> zoom
          </div>
        ) : (
          <div>
            <span className="key">G</span> jestler&nbsp;&nbsp;
            <span className="key">R</span> sıfırla
          </div>
        )}
      </div>

      {/* COMMAND + SES paneli */}
      <div className="hud hud-command">
        <div className="hud-command-label">// NOVA COMMAND</div>

        <div className="hud-command-row">
          <input
            className="hud-command-input"
            type="text"
            placeholder="komut girin..."
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleCommandKey}
            maxLength={48}
          />
          <button type="button" className="hud-command-send" onClick={sendCommand}>
            GÖNDER
          </button>
        </div>

        <div className="hud-mic-status" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
          {alwaysOn.status === "background" && voice.modelStatus !== "speaking" && voice.modelStatus !== "thinking" && (
            <span style={{ color: "#22c55e" }}>● HEY NOVA</span>
          )}
          {alwaysOn.status === "activated" && voice.modelStatus === "listening" && (
            <span style={{ color: "#06b6d4" }}>◉ DİNLİYOR…</span>
          )}
          {voice.modelStatus === "thinking" && <span style={{ color: "#f59e0b" }}>⟳ DÜŞÜNÜYOR…</span>}
          {voice.modelStatus === "speaking" && <span style={{ color: "#3b82f6" }}>▶ KONUŞUYOR…</span>}
          <span style={{ marginLeft: 8, color: voice.ollamaOnline ? "#22c55e" : "#6b7280" }}>
            {voice.ollamaOnline ? "◆ LLM" : "◇ LLM"}
          </span>
        </div>

        {commandLog.length > 0 && (
          <div className="hud-command-log">
            {commandLog.map((entry, i) => (
              <div key={i} className="hud-command-log-entry">{entry}</div>
            ))}
          </div>
        )}
      </div>

      <VideoOverlay
        videoId={videoId}
        title={videoTitle}
        onClose={() => { setVideoId(null); setVideoTitle(undefined); }}
      />
      <ObjectScanner
        ref={scannerRef}
        scene={sceneReady ? sceneRef.current : null}
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCameraReady={(fn) => { captureFrameRef.current = fn; }}
        onCameraStop={() => { captureFrameRef.current = null; }}
      />
      <ProjectForm
        ref={projectFormRef}
        scene={sceneReady ? sceneRef.current : null}
        open={projectFormOpen}
        onClose={() => setProjectFormOpen(false)}
        onSpeak={(text) => speakTextRef.current?.(text)}
        onLog={(msg) => setCommandLog((prev) => [...prev.slice(-9), msg])}
      />
      <ModelBrowser
        ref={modelBrowserRef}
        scene={sceneReady ? sceneRef.current : null}
        autoQuery={thingSearchTrigger}
        onSpeak={(text) => speakTextRef.current?.(text)}
        onLog={(msg) => setCommandLog((prev) => [...prev.slice(-9), msg])}
        onOpenChange={setModelBrowserOpen}
      />
      <MapView
        ref={mapViewRef}
        onSpeak={(text) => speakTextRef.current?.(text)}
        onLog={(msg) => setCommandLog((prev) => [...prev.slice(-9), msg])}
        onOpenChange={setMapOpen}
      />
      <MusicPlayer ref={musicPlayerRef} />

      <div className="hud hud-controls">
        {/* video/canvas DOM'da kalmalı — HandTracker ref'lere ihtiyaç duyuyor */}
        <video ref={videoRef} muted playsInline style={{ display: "none" }} />
        <canvas ref={overlayRef} width={208} height={156} style={{ display: "none" }} />
        <input
          ref={fileInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard
          webkitdirectory=""
          multiple
          accept=".glb,.gltf,.stl"
          style={{ display: "none" }}
          onChange={(e) => {
            if (!e.target.files?.length) return;
            void modelLib.loadFiles(e.target.files).then((msg) => {
              if (msg) setCommandLog((prev) => [...prev.slice(-9), `◈ ${msg}`]);
            });
            e.target.value = "";
          }}
        />

        {camError && <div className="hud-error">{camError}</div>}

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={toggleGestures}
            disabled={camera === "starting"}
          >
            {camera === "starting"
            ? "BAŞLATILIYOR…"
            : cameraOn
              ? status.hands > 0
                ? `${status.hands} EL · ${MODE_LABEL[status.mode]}`
                : "JESTLER AÇIK"
              : "JESTLER KAPALI"}
          </button>
        </div>
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-label="Zoom in"
            onPointerDown={() => sceneRef.current?.startZoomIn()}
            onPointerUp={() => sceneRef.current?.stopZoom()}
            onPointerLeave={() => sceneRef.current?.stopZoom()}
          >+</button>
          <button
            type="button"
            className="hud-btn"
            aria-label="Zoom out"
            onPointerDown={() => sceneRef.current?.startZoomOut()}
            onPointerUp={() => sceneRef.current?.stopZoom()}
            onPointerLeave={() => sceneRef.current?.stopZoom()}
          >−</button>
          <button type="button" className="hud-btn" onClick={() => sceneRef.current?.resetView()}>SIFIRLA</button>
        </div>
      </div>
    </>
  );
}
