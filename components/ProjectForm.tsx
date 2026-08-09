"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { OrbSceneApi } from "@/lib/orbScene";

type ProjectType = "software" | "embedded";
type Stage = "form" | "planning" | "awaiting_approval" | "running" | "done" | "error";

interface JobSummary {
  id: string;
  name: string;
  type: ProjectType;
  dir: string;
  status: "planning" | "awaiting_approval" | "running" | "done" | "error" | "stopped" | "rejected";
  startedAt: number;
  costUsd?: number;
  planText?: string;
}

function stageFromStatus(status: JobSummary["status"]): Stage {
  if (status === "planning") return "planning";
  if (status === "awaiting_approval") return "awaiting_approval";
  if (status === "running") return "running";
  if (status === "done") return "done";
  return "error"; // error / stopped / rejected
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 700,
  maxWidth: "92vw",
  background: "rgba(0, 8, 16, 0.92)",
  border: "1px solid rgba(6, 182, 212, 0.4)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 16,
  letterSpacing: "0.05em",
  padding: 28,
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
  padding: "7px 14px",
  cursor: "pointer",
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle,
  border: "1px solid rgba(6, 182, 212, 0.9)",
  background: "rgba(6, 182, 212, 0.12)",
  fontWeight: "bold",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(6, 182, 212, 0.35)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 15,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 14,
  opacity: 0.65,
  marginBottom: 5,
  letterSpacing: "0.1em",
};

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input?: Record<string, unknown>;
}
interface TextBlock {
  type: "text";
  text: string;
}

function toolSummary(block: ToolUseBlock): string {
  const input = block.input ?? {};
  const path = (input.file_path ?? input.path ?? input.command ?? input.pattern) as string | undefined;
  return path ? `${block.name} · ${String(path).slice(0, 60)}` : block.name;
}

function parseLine(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const obj = parsed as { type?: string; text?: string; message?: { content?: (TextBlock | ToolUseBlock)[] }; is_error?: boolean; total_cost_usd?: number; result?: string };

  if (obj.type === "stderr") return `⚠ ${obj.text}`;
  if (obj.type === "system") return "🔧 Oturum başlatıldı, çalışıyor…";
  if (obj.type === "assistant" && obj.message?.content) {
    const parts: string[] = [];
    for (const block of obj.message.content) {
      if (block.type === "text" && block.text.trim()) parts.push(`💬 ${block.text.trim()}`);
      if (block.type === "tool_use") parts.push(`🔨 ${toolSummary(block)}`);
    }
    return parts.length ? parts.join("\n") : null;
  }
  if (obj.type === "result") {
    if (obj.is_error) return `❌ Hata ile bitti.`;
    const cost = obj.total_cost_usd ? ` ($${obj.total_cost_usd.toFixed(2)})` : "";
    return `✅ Tamamlandı${cost}`;
  }
  return null;
}

interface ProjectFormProps {
  scene: OrbSceneApi | null;
  open: boolean;
  onClose: () => void;
  onSpeak?: (text: string) => void;
  onLog?: (message: string) => void;
}

export interface ProjectFormHandle {
  cancel: () => void;
}

const ProjectForm = forwardRef<ProjectFormHandle, ProjectFormProps>(function ProjectForm(
  { open, onClose, onSpeak, onLog },
  ref,
) {
  const [stage, setStage] = useState<Stage>("form");
  const [name, setName] = useState("");
  const [type, setType] = useState<ProjectType>("software");
  const [description, setDescription] = useState("");
  const [techPreference, setTechPreference] = useState("");
  const [targetHardware, setTargetHardware] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobName, setActiveJobName] = useState<string>("");
  const [activeJobDir, setActiveJobDir] = useState<string>("");
  const [planText, setPlanText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);

  const esRef = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/project");
      const data = (await res.json()) as { jobs?: JobSummary[] };
      if (data.jobs) setJobs(data.jobs);
    } catch {
      // sessizce yoksay
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshJobs();
    const id = setInterval(refreshJobs, 5000);
    return () => clearInterval(id);
  }, [open, refreshJobs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const attachStream = useCallback(
    (jobId: string, projectName: string) => {
      esRef.current?.close();
      const es = new EventSource(`/api/project/stream/${jobId}`);
      let opened = false;
      es.addEventListener("open", () => {
        if (!opened) {
          opened = true;
          setLog([]);
        }
      });
      es.addEventListener("line", (e) => {
        const parsed = parseLine((e as MessageEvent).data);
        if (parsed) setLog((prev) => [...prev, parsed]);
      });
      es.addEventListener("done", (e) => {
        const job = JSON.parse((e as MessageEvent).data) as JobSummary;
        setStage(stageFromStatus(job.status));
        void refreshJobs();

        if (job.status === "awaiting_approval") {
          setPlanText(job.planText ?? "");
          const msg = `${projectName} için planı hazırladım, onayını bekliyorum.`;
          onSpeak?.(msg);
          onLog?.(`◈ ${msg}`);
          es.close();
          return;
        }

        const msg =
          job.status === "done"
            ? `${projectName} projesi tamamlandı.`
            : job.status === "stopped"
              ? `${projectName} projesi durduruldu.`
              : job.status === "rejected"
                ? `${projectName} planı reddedildi.`
                : `${projectName} projesinde hata oluştu.`;
        onSpeak?.(msg);
        onLog?.(`◈ ${msg}`);
        es.close();
      });
      es.onerror = () => {
        // EventSource kendi kendine yeniden dener; ekstra işlem gerekmiyor
      };
      esRef.current = es;
    },
    [onSpeak, onLog, refreshJobs],
  );

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  async function submit() {
    if (!name.trim() || !description.trim() || submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim(),
          techPreference: techPreference.trim() || undefined,
          targetHardware: type === "embedded" ? targetHardware.trim() || undefined : undefined,
        }),
      });
      const data = (await res.json()) as { jobId?: string; dir?: string; error?: string };
      if (!res.ok || !data.jobId) {
        setErrorMsg(data.error ?? "Başlatılamadı.");
        return;
      }
      setActiveJobId(data.jobId);
      setActiveJobName(name.trim());
      setActiveJobDir(data.dir ?? "");
      setStage("planning");
      onSpeak?.(`${name.trim()} için plan hazırlanıyor.`);
      onLog?.(`◈ ${name.trim()} için plan hazırlanıyor.`);
      attachStream(data.jobId, name.trim());
    } catch {
      setErrorMsg("İstek gönderilemedi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function stopActive() {
    if (!activeJobId) return;
    await fetch(`/api/project/${activeJobId}`, { method: "DELETE" }).catch(() => {});
  }

  async function approvePlan() {
    if (!activeJobId) return;
    try {
      const res = await fetch(`/api/project/${activeJobId}/approve`, { method: "POST" });
      if (!res.ok) {
        setErrorMsg("Plan onaylanamadı.");
        return;
      }
      setStage("running");
      setPlanText("");
      onSpeak?.(`${activeJobName || "Proje"} onaylandı, uygulanıyor.`);
      onLog?.(`◈ Plan onaylandı, uygulama başladı.`);
      attachStream(activeJobId, activeJobName || "Proje");
    } catch {
      setErrorMsg("Plan onaylanamadı.");
    }
  }

  async function rejectPlan() {
    if (!activeJobId) return;
    await stopActive();
    onSpeak?.(`${activeJobName || "Proje"} planı reddedildi.`);
    onLog?.("◈ Plan reddedildi.");
    void refreshJobs();
    startNew();
  }

  useImperativeHandle(ref, () => ({
    cancel() {
      if (activeJobId && (stage === "planning" || stage === "running" || stage === "awaiting_approval")) {
        void stopActive();
      }
      onClose();
    },
  }));

  function startNew() {
    setStage("form");
    setName("");
    setDescription("");
    setTechPreference("");
    setTargetHardware("");
    setActiveJobId(null);
    setActiveJobName("");
    setPlanText("");
    setLog([]);
  }

  function viewJob(job: JobSummary) {
    setActiveJobId(job.id);
    setActiveJobName(job.name);
    setActiveJobDir(job.dir);
    setPlanText(job.planText ?? "");
    setStage(stageFromStatus(job.status));
    if (job.status === "planning" || job.status === "running") {
      attachStream(job.id, job.name);
    }
  }

  if (!open) return null;

  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && !submitting;

  return (
    <div style={panelStyle} className="holo-enter">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>// YENİ PROJE</div>
        <button
          type="button"
          style={{ ...btnStyle, fontSize: 13, padding: "2px 9px" }}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {stage === "form" && (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>PROJE ADI</div>
            <input
              style={inputStyle}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn. Hava Durumu Widget'ı"
              maxLength={80}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>TÜR</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={type === "software" ? primaryBtnStyle : btnStyle}
                onClick={() => setType("software")}
              >
                YAZILIM
              </button>
              <button
                type="button"
                style={type === "embedded" ? primaryBtnStyle : btnStyle}
                onClick={() => setType("embedded")}
              >
                GÖMÜLÜ / FİZİKSEL
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>NE YAPMASINI İSTİYORSUN?</div>
            <textarea
              style={{ ...inputStyle, resize: "vertical", fontFamily: "Courier New, monospace" }}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Kısaca hedefi anlat — NOVA gerisini tamamlayacak."
              maxLength={2000}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={labelStyle}>
              {type === "software" ? "TEKNOLOJİ TERCİHİ (opsiyonel)" : "HEDEF DONANIM (opsiyonel)"}
            </div>
            <input
              style={inputStyle}
              value={type === "software" ? techPreference : targetHardware}
              onChange={(e) =>
                type === "software" ? setTechPreference(e.target.value) : setTargetHardware(e.target.value)
              }
              placeholder={
                type === "software"
                  ? "Boş bırakırsan NOVA en uygun stack'i seçer"
                  : "örn. ESP32 — boş bırakırsan NOVA seçer"
              }
              maxLength={80}
            />
          </div>

          {errorMsg && (
            <div style={{ color: "#ef4444", fontSize: 14, marginBottom: 8 }}>{errorMsg}</div>
          )}

          <button
            type="button"
            style={{ ...primaryBtnStyle, width: "100%", padding: "11px 0" }}
            onClick={submit}
            disabled={!canSubmit}
          >
            {submitting ? "⟳ BAŞLATILIYOR…" : "PROJEYİ BAŞLAT"}
          </button>
        </>
      )}

      {stage === "awaiting_approval" && (
        <>
          <div style={{ fontSize: 14, opacity: 0.6, marginBottom: 6, wordBreak: "break-all" }}>
            {activeJobDir}
          </div>

          <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 6 }}>// PLAN — ONAYINI BEKLİYOR</div>

          <div
            style={{
              maxHeight: 380,
              overflowY: "auto",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(6,182,212,0.25)",
              padding: 10,
              marginBottom: 10,
              fontSize: 15,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {planText || "Plan alınamadı."}
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button type="button" style={{ ...primaryBtnStyle, flex: 1 }} onClick={approvePlan}>
              ONAYLA
            </button>
            <button type="button" style={{ ...btnStyle, flex: 1 }} onClick={rejectPlan}>
              REDDET
            </button>
          </div>
        </>
      )}

      {(stage === "planning" || stage === "running" || stage === "done" || stage === "error") && (
        <>
          <div style={{ fontSize: 14, opacity: 0.6, marginBottom: 6, wordBreak: "break-all" }}>
            {activeJobDir}
          </div>

          {stage === "planning" && (
            <div style={{ fontSize: 14, opacity: 0.7, marginBottom: 6 }}>⟳ PLAN HAZIRLANIYOR…</div>
          )}

          <div
            style={{
              maxHeight: 380,
              overflowY: "auto",
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(6,182,212,0.15)",
              padding: 8,
              marginBottom: 10,
              fontSize: 14,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {log.length === 0 ? (
              <div style={{ opacity: 0.5 }}>⟳ Bağlanılıyor…</div>
            ) : (
              log.map((entry, i) => <div key={i}>{entry}</div>)
            )}
            <div ref={logEndRef} />
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {stage === "planning" || stage === "running" ? (
              <button type="button" style={btnStyle} onClick={stopActive}>
                DURDUR
              </button>
            ) : (
              <button type="button" style={btnStyle} onClick={startNew}>
                YENİ PROJE
              </button>
            )}
          </div>
        </>
      )}

      {jobs.length > 0 && (
        <div style={{ borderTop: "1px solid rgba(6,182,212,0.15)", paddingTop: 8 }}>
          <div style={{ fontSize: 14, opacity: 0.6, marginBottom: 6 }}>// AKTİF PROJELER</div>
          {jobs.map((job) => (
            <div
              key={job.id}
              onClick={() => viewJob(job)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "3px 4px",
                cursor: "pointer",
                background: job.id === activeJobId ? "rgba(6,182,212,0.12)" : "transparent",
                fontSize: 14,
              }}
            >
              <span>
                {job.status === "planning"
                  ? "⟳"
                  : job.status === "awaiting_approval"
                    ? "⏸"
                    : job.status === "running"
                      ? "⟳"
                      : job.status === "done"
                        ? "✅"
                        : job.status === "stopped"
                          ? "⏹"
                          : "❌"}{" "}
                {job.name}
              </span>
              <span style={{ opacity: 0.5 }}>{job.type === "embedded" ? "GÖMÜLÜ" : "YAZILIM"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default ProjectForm;
