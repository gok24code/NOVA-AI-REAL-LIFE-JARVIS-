"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { OrbSceneApi } from "@/lib/orbScene";

interface FileEntry {
  handle: FileSystemFileHandle;
  name: string;
}

interface ThingResult {
  id: number;
  name: string;
  thumbnail?: string;
  publicUrl?: string;
  creator?: string;
  likeCount?: number;
  downloadCount?: number;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 480,
  maxWidth: "92vw",
  background: "rgba(0, 8, 16, 0.92)",
  border: "1px solid rgba(6, 182, 212, 0.4)",
  color: "#06b6d4",
  fontFamily: "Courier New, monospace",
  fontSize: 15,
  letterSpacing: "0.1em",
  padding: 22,
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

export interface ThingSearchTrigger {
  query: string;
  id: number;
}

interface ModelBrowserProps {
  scene: OrbSceneApi | null;
  autoQuery?: ThingSearchTrigger | null;
  onSpeak?: (text: string) => void;
  onLog?: (msg: string) => void;
  onOpenChange?: (open: boolean) => void;
}

export interface ModelBrowserHandle {
  selectResult: (index: number) => void;
  cancel: () => void;
}

const ORDINALS = ["Birinci", "İkinci", "Üçüncü"];

const ModelBrowser = forwardRef<ModelBrowserHandle, ModelBrowserProps>(function ModelBrowser(
  { scene, autoQuery, onSpeak, onLog, onOpenChange },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"local" | "thingiverse">("local");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [dirName, setDirName] = useState("");
  const prevUrlRef = useRef<string | null>(null);

  const [thingQuery, setThingQuery] = useState("");
  const [awaitingChoice, setAwaitingChoice] = useState(false);
  const [thingResults, setThingResults] = useState<ThingResult[]>([]);
  const [thingLoading, setThingLoading] = useState(false);
  const [thingError, setThingError] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [activeThingId, setActiveThingId] = useState<number | null>(null);

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  async function pickFolder() {
    try {
      const dir = await (window as any).showDirectoryPicker({ mode: "read" });
      setDirName(dir.name as string);
      const collected: FileEntry[] = [];
      for await (const entry of dir.values()) {
        if (
          entry.kind === "file" &&
          (entry.name.endsWith(".glb") || entry.name.endsWith(".gltf"))
        ) {
          collected.push({ handle: entry as FileSystemFileHandle, name: entry.name });
        }
      }
      collected.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(collected);
      setCurrentIndex(-1);
      setSearch("");
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (typeof window !== "undefined" && !(window as any).showDirectoryPicker) {
        alert("Tarayıcı desteklemiyor");
      }
    }
  }

  async function loadEntry(entry: FileEntry, idx: number) {
    if (!scene) return;
    setLoading(true);
    setCurrentIndex(idx);
    try {
      const file = await entry.handle.getFile();
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      const url = URL.createObjectURL(file);
      prevUrlRef.current = url;
      await scene.loadModel(url, entry.name.replace(/\.(glb|gltf)$/i, ""));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function navigate(dir: -1 | 1) {
    const next = currentIndex + dir;
    if (next < 0 || next >= filtered.length) return;
    void loadEntry(filtered[next], files.indexOf(filtered[next]));
  }

  async function searchThingiverse(qOverride?: string): Promise<ThingResult[]> {
    const q = (qOverride ?? thingQuery).trim();
    if (!q) return [];
    setThingLoading(true);
    setThingError("");
    setThingResults([]);
    setAwaitingChoice(false);
    try {
      const res = await fetch(`/api/services/thingiverse?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { results?: ThingResult[]; error?: string };
      if (data.error) {
        setThingError(data.error === "no_key" ? "API key tanımlı değil" : data.error);
        return [];
      }
      const top3 = (data.results ?? []).slice(0, 3);
      setThingResults(top3);
      setAwaitingChoice(top3.length > 0);
      if (!top3.length) setThingError("Sonuç bulunamadı");
      return top3;
    } catch {
      setThingError("Arama başarısız");
      return [];
    } finally {
      setThingLoading(false);
    }
  }

  async function downloadThing(thing: ThingResult): Promise<boolean> {
    if (!scene) return false;
    setDownloadingId(thing.id);
    setThingError("");
    try {
      const res = await fetch("/api/services/thingiverse/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thingId: thing.id, name: thing.name }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setThingError(err.error ?? "İndirme başarısız");
        return false;
      }
      const ext = res.headers.get("X-Ext") ?? "stl";
      const blob = await res.blob();
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current);
      const url = URL.createObjectURL(blob);
      prevUrlRef.current = url;
      if (ext === "stl" || ext === "glb") {
        await scene.loadModel(url, thing.name, ext);
        setActiveThingId(thing.id);
        return true;
      }
      setThingError(`Model kaydedildi ancak önizleme desteklenmiyor (.${ext})`);
      return false;
    } catch {
      setThingError("İndirme başarısız");
      return false;
    } finally {
      setDownloadingId(null);
    }
  }

  async function chooseResult(thing: ThingResult) {
    setAwaitingChoice(false);
    onLog?.(`◈ ${thing.name} indiriliyor…`);
    const ok = await downloadThing(thing);
    onSpeak?.(
      ok
        ? `${thing.name} modelini indirdim ve sahneye yükledim.`
        : `${thing.name} modelini indiremedim.`,
    );
  }

  useImperativeHandle(ref, () => ({
    selectResult(index: number) {
      if (!awaitingChoice) return;
      const thing = thingResults[index];
      if (!thing) {
        onSpeak?.("Böyle bir seçenek yok.");
        return;
      }
      void chooseResult(thing);
    },
    cancel() {
      setAwaitingChoice(false);
      setOpen(false);
    },
  }));

  // Sesli komutla otomatik arama: ilk 3 sonucu sun, seçim bekle
  const handledAutoIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!autoQuery || handledAutoIdRef.current === autoQuery.id) return;
    handledAutoIdRef.current = autoQuery.id;

    setOpen(true);
    setTab("thingiverse");
    setThingQuery(autoQuery.query);

    void (async () => {
      const results = await searchThingiverse(autoQuery.query);
      if (!results.length) {
        onSpeak?.(`${autoQuery.query} için model bulamadım.`);
        return;
      }
      const listing = results
        .map((r, i) => `${ORDINALS[i]}: ${r.name}`)
        .join(". ");
      onSpeak?.(
        `${results.length} sonuç buldum. ${listing}. Hangisini istersiniz? Birinci, ikinci ya da üçüncü deyin.`,
      );
    })();
  }, [autoQuery, onSpeak]);

  if (!open) return null;

  return (
    <div style={panelStyle} className="holo-enter">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 14, opacity: 0.7 }}>// 3D MODEL BROWSER</div>
        <button
          type="button"
          style={{ ...btnStyle, fontSize: 13, padding: "2px 9px" }}
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button
              type="button"
              style={{ ...btnStyle, opacity: tab === "local" ? 1 : 0.5 }}
              onClick={() => setTab("local")}
            >
              YEREL
            </button>
            <button
              type="button"
              style={{ ...btnStyle, opacity: tab === "thingiverse" ? 1 : 0.5 }}
              onClick={() => setTab("thingiverse")}
            >
              THINGIVERSE
            </button>
          </div>

          {tab === "thingiverse" && (
            <div>
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <input
                  type="text"
                  value={thingQuery}
                  onChange={(e) => setThingQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void searchThingiverse(); }}
                  placeholder="model ara..."
                  style={{
                    ...btnStyle,
                    flex: 1,
                    boxSizing: "border-box",
                    padding: "3px 6px",
                  }}
                />
                <button type="button" style={btnStyle} onClick={() => searchThingiverse()} disabled={thingLoading}>
                  {thingLoading ? "⟳" : "ARA"}
                </button>
              </div>

              {thingError && (
                <div style={{ fontSize: 14, color: "#ef4444", marginBottom: 6 }}>{thingError}</div>
              )}

              {awaitingChoice && (
                <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
                  Hangisini istersiniz? &quot;birinci&quot;, &quot;ikinci&quot; ya da &quot;üçüncü&quot; deyin.
                </div>
              )}

              {thingResults.length > 0 && (
                <div style={{ maxHeight: 340, overflowY: "auto" }}>
                  {thingResults.map((t, i) => (
                    <div
                      key={t.id}
                      style={{
                        display: "flex",
                        gap: 6,
                        padding: "4px 2px",
                        borderBottom: "1px solid rgba(6,182,212,0.1)",
                        background: activeThingId === t.id ? "rgba(6,182,212,0.12)" : "transparent",
                      }}
                    >
                      <div style={{ width: 20, flexShrink: 0, textAlign: "center", opacity: 0.6, alignSelf: "center" }}>
                        {i + 1}
                      </div>
                      {t.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.thumbnail}
                          alt={t.name}
                          style={{ width: 56, height: 56, objectFit: "cover", flexShrink: 0 }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {t.name}
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.6 }}>
                          {t.creator ?? ""} {t.likeCount != null ? `♥${t.likeCount}` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        style={{ ...btnStyle, alignSelf: "center", fontSize: 13 }}
                        onClick={() => chooseResult(t)}
                        disabled={downloadingId === t.id}
                      >
                        {downloadingId === t.id ? "⟳" : "İNDİR"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "local" && (
          <>
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            <button type="button" style={btnStyle} onClick={pickFolder}>
              KLASÖR SEÇ
            </button>
            {files.length > 0 && (
              <button
                type="button"
                style={btnStyle}
                onClick={() => {
                  scene?.clearModel();
                  if (prevUrlRef.current) {
                    URL.revokeObjectURL(prevUrlRef.current);
                    prevUrlRef.current = null;
                  }
                  setCurrentIndex(-1);
                }}
              >
                TEMİZLE
              </button>
            )}
          </div>

          {dirName && (
            <div style={{ fontSize: 14, opacity: 0.6, marginBottom: 4 }}>
              {dirName} — {files.length} dosya
            </div>
          )}

          {files.length > 0 && (
            <>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ara..."
                style={{
                  ...btnStyle,
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 6,
                  padding: "3px 6px",
                }}
              />

              <div
                style={{
                  maxHeight: 220,
                  overflowY: "auto",
                  marginBottom: 6,
                  borderTop: "1px solid rgba(6,182,212,0.15)",
                }}
              >
                {filtered.map((f, i) => {
                  const globalIdx = files.indexOf(f);
                  return (
                    <div
                      key={f.name}
                      onClick={() => void loadEntry(f, globalIdx)}
                      style={{
                        padding: "3px 4px",
                        cursor: "pointer",
                        background:
                          globalIdx === currentIndex
                            ? "rgba(6,182,212,0.12)"
                            : "transparent",
                        borderBottom: "1px solid rgba(6,182,212,0.05)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontSize: 14,
                      }}
                    >
                      {f.name}
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 4 }}>
                <button type="button" style={btnStyle} onClick={() => navigate(-1)}>
                  ◀ PREV
                </button>
                <button type="button" style={btnStyle} onClick={() => navigate(1)}>
                  NEXT ▶
                </button>
              </div>
            </>
          )}

          {loading && (
            <div style={{ marginTop: 6, fontSize: 14, opacity: 0.7 }}>⟳ YÜKLENİYOR…</div>
          )}
          </>
          )}
    </div>
  );
});

export default ModelBrowser;
