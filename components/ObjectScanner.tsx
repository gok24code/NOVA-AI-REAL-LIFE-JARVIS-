"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { OrbSceneApi } from "@/lib/orbScene";
import { useObjectDetector, type DetectionResult as DetectResult } from "@/lib/useObjectDetector";

type Stage =
  | "idle"
  | "scanning"
  | "detecting"
  | "generating"
  | "polling"
  | "done"
  | "error";

interface MeshyTask {
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  model_urls?: { glb: string; obj: string; fbx: string; stl?: string };
  thumbnail_url?: string;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 640,
  maxWidth: "90vw",
  background: "rgba(0, 8, 16, 0.92)",
  border: "1px solid rgba(6, 182, 212, 0.4)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 16,
  letterSpacing: "0.1em",
  padding: 26,
  zIndex: 100,
  maxHeight: "85vh",
  overflowY: "auto",
};

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(6, 182, 212, 0.5)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 14,
  letterSpacing: "0.1em",
  padding: "5px 12px",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  ...btnStyle,
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 9px",
  background: "rgba(0,0,0,0.3)",
};

type CaptureFrameFn = () => { imageBase64: string; mimeType: string } | null;

interface ScannerProps {
  scene: OrbSceneApi | null;
  open: boolean;
  onClose: () => void;
  onCameraReady?: (fn: CaptureFrameFn) => void;
  onCameraStop?: () => void;
}

export interface ObjectScannerHandle {
  cancel: () => void;
}

const ObjectScanner = forwardRef<ObjectScannerHandle, ScannerProps>(function ObjectScanner(
  { scene, open, onClose, onCameraReady, onCameraStop },
  ref,
) {
  const [stage, setStage] = useState<Stage>("idle");
  const [camActive, setCamActive] = useState(false);
  const [detection, setDetection] = useState<DetectResult | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [meshyTask, setMeshyTask] = useState<MeshyTask | null>(null);
  const [prompt, setPrompt] = useState(
    "3D baskı için optimize edilmiş, işlevsel tasarım",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [slicerMsg, setSlicerMsg] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { modelStatus, loadProgress, detect } = useObjectDetector();

  useEffect(() => {
    return () => {
      stopCam();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Auto-start camera when panel opens
  useEffect(() => {
    if (open && !camActive) {
      void startCam();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function stopCam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamActive(false);
    onCameraStop?.();
  }

  async function startCam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamActive(true);
      setStage("scanning");
      onCameraReady?.(captureFrame);
    } catch (err) {
      console.error("[scanner] camera start failed:", err);
      setStage("error");
      setErrorMsg("Kamera erişimi reddedildi.");
    }
  }

  function captureFrame(): { imageBase64: string; mimeType: string } | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const imageBase64 = dataUrl.split(",")[1];
    return { imageBase64, mimeType: "image/jpeg" };
  }

  async function detectObject() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

    setStage("detecting");
    const result = await detect(dataUrl);
    setDetection(result);
    setStage("scanning");
  }

  async function generate3D() {
    if (!detection?.found) return;
    setStage("generating");
    setMeshyTask(null);
    setTaskId(null);

    const fullPrompt = `${detection.object}: ${detection.description}. ${prompt}`;
    try {
      const res = await fetch("/api/generate3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt }),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!data.taskId) {
        setStage("error");
        setErrorMsg(data.error ?? "Bilinmeyen hata");
        return;
      }
      setTaskId(data.taskId);
      setStage("polling");
      startPolling(data.taskId);
    } catch {
      setStage("error");
      setErrorMsg("3D oluşturma isteği başarısız.");
    }
  }

  function startPolling(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/generate3d/status/${id}`);
        const task = (await res.json()) as MeshyTask;
        setMeshyTask(task);
        if (task.status === "SUCCEEDED") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStage("done");
          if (task.model_urls?.glb && scene) {
            await scene.loadModel(task.model_urls.glb, detection?.object);
          }
          void saveModelLocally(task);
        } else if (task.status === "FAILED") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setStage("error");
          setErrorMsg("Meshy görevi başarısız oldu.");
        }
      } catch {
        // polling devam eder
      }
    }, 3000);
  }

  async function saveModelLocally(task: MeshyTask) {
    const url = task.model_urls?.stl ?? task.model_urls?.glb;
    if (!url) return;
    setSaveMsg("STL kaydediliyor…");
    try {
      const res = await fetch("/api/generate3d/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name: detection?.object }),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      if (data.path) {
        setSavedPath(data.path);
        setSaveMsg("");
      } else {
        setSaveMsg(`Yerel kayıt başarısız: ${data.error ?? "bilinmeyen hata"}`);
      }
    } catch {
      setSaveMsg("Yerel kayıt isteği başarısız.");
    }
  }

  async function sendToSlicer() {
    const url = meshyTask?.model_urls?.stl ?? meshyTask?.model_urls?.glb;
    if (!url) return;
    setSlicerMsg("Gönderiliyor…");
    try {
      const res = await fetch("/api/slicer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        filePath?: string;
      };
      if (data.error === "slicer_not_found") {
        setSlicerMsg(`Slicer bulunamadı. Dosya: ${data.filePath}`);
      } else if (data.success) {
        setSlicerMsg("Creality Print başlatıldı!");
      } else {
        setSlicerMsg(`Hata: ${data.error}`);
      }
    } catch {
      setSlicerMsg("Slicer isteği başarısız.");
    }
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setStage(camActive ? "scanning" : "idle");
    setDetection(null);
    setTaskId(null);
    setMeshyTask(null);
    setErrorMsg("");
    setSlicerMsg("");
    setSavedPath("");
    setSaveMsg("");
  }

  useImperativeHandle(ref, () => ({
    cancel() {
      reset();
      stopCam();
      onClose();
    },
  }));

  if (!open) return null;

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>// NESNE TARAYICI</div>
        <button
          type="button"
          style={{ ...btnStyle, fontSize: 13, padding: "2px 9px" }}
          onClick={() => { stopCam(); onClose(); }}
        >
          ✕
        </button>
      </div>

      <video
        ref={videoRef}
        muted
        playsInline
        style={{
          width: "100%",
          height: 280,
          objectFit: "cover",
          border: "1px solid rgba(6,182,212,0.2)",
          display: camActive ? "block" : "none",
          marginBottom: 8,
        }}
      />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {modelStatus === "loading" && (
        <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 6 }}>
          ⟳ MODEL YÜKLENİYOR… {loadProgress > 0 ? `${loadProgress}%` : ""}
        </div>
      )}
      {modelStatus === "error" && (
        <div style={{ fontSize: 14, color: "#ef4444", marginBottom: 6 }}>
          Model yüklenemedi. İnternet bağlantısını kontrol edin.
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {!camActive ? (
          <button type="button" style={btnStyle} onClick={startCam}>
            TARAMA BAŞLAT
          </button>
        ) : (
          <>
            <button type="button" style={btnStyle} onClick={() => { stopCam(); }}>
              DURDUR
            </button>
            <button
              type="button"
              style={btnStyle}
              onClick={detectObject}
              disabled={stage === "detecting" || modelStatus === "loading"}
            >
              {stage === "detecting" ? "⟳ TESPİT…" : "NESNEYİ TARA"}
            </button>
          </>
        )}
      </div>

      {detection && (
        <div
          style={{
            marginBottom: 8,
            padding: 6,
            background: "rgba(6,182,212,0.05)",
            border: "1px solid rgba(6,182,212,0.15)",
            fontSize: 14,
          }}
        >
          {detection.found ? (
            <>
              <div style={{ marginBottom: 2 }}>
                Tespit: <strong>{detection.object}</strong>
              </div>
              <div style={{ opacity: 0.7 }}>{detection.description}</div>
            </>
          ) : (
            <div style={{ opacity: 0.6 }}>Nesne tespit edilemedi.</div>
          )}
        </div>
      )}

      {detection?.found && stage !== "generating" && stage !== "polling" && stage !== "done" && (
        <>
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 14, opacity: 0.6, marginBottom: 3 }}>
              Tasarım promptu:
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "Courier New, monospace",
                fontSize: 14,
              }}
            />
          </div>
          <button
            type="button"
            style={{ ...btnStyle, width: "100%", marginBottom: 6 }}
            onClick={generate3D}
          >
            3D MODEL OLUŞTUR
          </button>
        </>
      )}

      {(stage === "generating" || stage === "polling") && (
        <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 6 }}>
          {stage === "generating" ? "⟳ İSTEK GÖNDERİLİYOR…" : "⟳ MODEL OLUŞTURULUYOR…"}
          {taskId && (
            <div style={{ opacity: 0.5, marginTop: 2 }}>
              ID: {taskId.slice(0, 16)}…
            </div>
          )}
          {meshyTask && (
            <div style={{ marginTop: 2 }}>Durum: {meshyTask.status}</div>
          )}
        </div>
      )}

      {stage === "done" && meshyTask && (
        <div style={{ marginBottom: 8 }}>
          {meshyTask.thumbnail_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={meshyTask.thumbnail_url}
              alt="model thumbnail"
              style={{
                width: "100%",
                height: 130,
                objectFit: "contain",
                marginBottom: 6,
                border: "1px solid rgba(6,182,212,0.2)",
              }}
            />
          )}
          <button
            type="button"
            style={{ ...btnStyle, width: "100%", marginBottom: 4 }}
            onClick={sendToSlicer}
          >
            CREALİTY&apos;E GÖNDER
          </button>
          {slicerMsg && (
            <div style={{ fontSize: 14, opacity: 0.7, wordBreak: "break-all" }}>
              {slicerMsg}
            </div>
          )}
          {saveMsg && (
            <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>{saveMsg}</div>
          )}
          {savedPath && (
            <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4, wordBreak: "break-all" }}>
              ✓ STL kaydedildi: {savedPath}
            </div>
          )}
        </div>
      )}

      {stage === "error" && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ color: "#ef4444", fontSize: 14, marginBottom: 4 }}>
            Hata: {errorMsg}
          </div>
          <button type="button" style={btnStyle} onClick={reset}>
            YENİDEN DENE
          </button>
        </div>
      )}

      {(stage === "done" || stage === "scanning") && detection && (
        <button
          type="button"
          style={{ ...btnStyle, fontSize: 14, opacity: 0.6 }}
          onClick={reset}
        >
          SIFIRLA
        </button>
      )}
    </div>
  );
});

export default ObjectScanner;
