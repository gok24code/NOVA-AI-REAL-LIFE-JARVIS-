import { spawn, exec, type ChildProcess } from "child_process";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join, resolve, sep } from "path";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";

export type ProjectType = "software" | "embedded";

export interface ProjectSpec {
  name: string;
  type: ProjectType;
  description: string;
  techPreference?: string;
  targetHardware?: string;
}

export type JobStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "done"
  | "error"
  | "stopped"
  | "rejected";

export type JobPhase = "plan" | "execute";

export interface ProjectJob {
  id: string;
  name: string;
  type: ProjectType;
  dir: string;
  status: JobStatus;
  phase: JobPhase;
  startedAt: number;
  endedAt?: number;
  costUsd?: number;
  resultText?: string;
  planText?: string;
  errorMessage?: string;
  lines: string[];
}

interface JobEntry {
  job: ProjectJob;
  child: ChildProcess;
  emitter: EventEmitter;
  spec: ProjectSpec;
}

const MAX_BUFFERED_LINES = 500;

// Survives Next.js dev-server hot reloads (module re-evaluation would otherwise drop running jobs)
const globalForNova = globalThis as unknown as { __novaProjectJobs?: Map<string, JobEntry> };
const jobs = globalForNova.__novaProjectJobs ?? new Map<string, JobEntry>();
globalForNova.__novaProjectJobs = jobs;

const TR_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
};

function slugify(name: string): string {
  const ascii = name.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => TR_MAP[c] ?? c);
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "proje";
}

function projectsBaseDir(): string {
  return resolve(process.env.NOVA_PROJECTS_DIR || join(homedir(), "Desktop", "git"));
}

function buildPrompt(spec: ProjectSpec): string {
  const lines: string[] = [];
  lines.push(
    "Sen NOVA'nın proje inşa etme motorusun. Kullanıcı adına bağımsız, denetimsiz şekilde çalışan bir kod ajanısın. " +
    "Bu oturumda kimseye soru soramazsın (non-interactive) — belirsiz noktalarda en makul varsayımı yap ve devam et.",
  );
  lines.push("");
  lines.push(`Proje adı: ${spec.name}`);
  lines.push(`Proje türü: ${spec.type === "embedded" ? "Gömülü sistem / fiziksel ürün" : "Yazılım projesi"}`);
  lines.push("");
  lines.push("Görev tanımı:");
  lines.push(spec.description);

  if (spec.type === "software") {
    lines.push("");
    lines.push(
      spec.techPreference
        ? `Tercih edilen teknoloji: ${spec.techPreference} (mümkünse bunu kullan, uygun değilse gerekçeni açıkla ve alternatif seç).`
        : "Teknoloji tercihi belirtilmedi: görev için en optimal dil/framework/stack'i sen seç.",
    );
    lines.push(
      "Çalışan bir iskelet/MVP oluştur, bağımlılıkları kur, README.md dosyasına hangi stack'i neden seçtiğini " +
      "ve projenin nasıl çalıştırılacağını Türkçe olarak yaz.",
    );
  } else {
    lines.push("");
    lines.push(
      spec.targetHardware
        ? `Hedef donanım: ${spec.targetHardware}.`
        : "Hedef donanım belirtilmedi: yaygın ve uygun bir platform seç (örn. ESP32, Arduino, Raspberry Pi Pico) ve seçimini README.md'de gerekçelendir.",
    );
    lines.push(
      "Gömülü/firmware kaynak kodunu yaz. Eğer proje fiziksel/3D basılabilir bir parça gerektiriyorsa, STL/3D model " +
      "üretimini SEN YAPMA — bunun yerine gereksinimleri docs/3d-model-gereksinimi.md dosyasına Türkçe olarak yaz " +
      "(3D üretim hattı ayrı bir NOVA modülünde bağlanacak).",
    );
  }

  lines.push("");
  lines.push(
    "Kurallar: yalnızca bu proje klasörünün içinde çalış, git init/commit yapma (kullanıcı isterse kendisi yapar), " +
    "gereksiz açıklama yazma, işini bitirince kısa bir özet ver.",
  );

  return lines.join("\n");
}

function buildPlanPrompt(spec: ProjectSpec): string {
  const lines: string[] = [];
  lines.push(
    "Sen NOVA'nın proje inşa etme motorusun. Bu aşamada SADECE bir plan sunacaksın — " +
    "hiçbir dosya oluşturma, düzenleme veya komut çalıştırma yapmayacaksın (salt-okunur/keşif dışında).",
  );
  lines.push("");
  lines.push(`Proje adı: ${spec.name}`);
  lines.push(`Proje türü: ${spec.type === "embedded" ? "Gömülü sistem / fiziksel ürün" : "Yazılım projesi"}`);
  lines.push("");
  lines.push("Görev tanımı:");
  lines.push(spec.description);
  if (spec.techPreference) lines.push(`Tercih edilen teknoloji: ${spec.techPreference}`);
  if (spec.targetHardware) lines.push(`Hedef donanım: ${spec.targetHardware}`);
  lines.push("");
  lines.push(
    "Planını Türkçe olarak şu başlıklarla, kısa ve öz şekilde sun:\n" +
    "1) Seçilecek teknoloji/stack ve neden\n" +
    "2) Oluşturulacak dosya/klasör yapısı\n" +
    "3) Uygulama adımlarının sırası\n" +
    "Bu bir onay öncesi özet — kod yazma, sadece planı anlat.",
  );

  return lines.join("\n");
}

function projectFolderPath(name: string): { baseDir: string; dir: string } {
  const baseDir = projectsBaseDir();
  mkdirSync(baseDir, { recursive: true });

  const folderName = `${slugify(name)}-${Date.now().toString(36)}`;
  const dir = resolve(join(baseDir, folderName));
  if (dir !== baseDir && !dir.startsWith(baseDir + sep)) {
    throw new Error("invalid_project_path");
  }
  mkdirSync(dir, { recursive: true });
  return { baseDir, dir };
}

function spawnClaude(
  job: ProjectJob,
  emitter: EventEmitter,
  dir: string,
  prompt: string,
  permissionMode: "plan" | "bypassPermissions",
  onClose: (code: number | null) => void,
): ChildProcess {
  const child = spawn(
    "claude",
    ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", permissionMode],
    { cwd: dir, shell: true, windowsHide: true },
  );

  child.stdin.write(prompt);
  child.stdin.end();

  function pushLine(line: string) {
    job.lines.push(line);
    if (job.lines.length > MAX_BUFFERED_LINES) job.lines.shift();
    emitter.emit("line", line);
  }

  let stdoutBuf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf-8");
    const parts = stdoutBuf.split("\n");
    stdoutBuf = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) pushLine(part);
      try {
        const parsed = JSON.parse(part) as { type?: string; total_cost_usd?: number; result?: string; is_error?: boolean };
        if (parsed.type === "result") {
          job.costUsd = parsed.total_cost_usd;
          job.resultText = parsed.result;
          if (parsed.is_error) job.status = "error";
        }
      } catch {
        // not every line is JSON we care about
      }
    }
  });

  let stderrBuf = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf-8");
    const parts = stderrBuf.split("\n");
    stderrBuf = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim()) pushLine(JSON.stringify({ type: "stderr", text: part }));
    }
  });

  child.on("close", (code) => onClose(code));
  child.on("error", (err) => {
    job.status = "error";
    job.errorMessage = err.message;
    job.endedAt = Date.now();
    emitter.emit("done", job);
  });

  return child;
}

// ── Faz 1: plan çıkar, onay bekle (dosya sistemine hiçbir şey yazılmaz) ────────
export function startProjectPlan(spec: ProjectSpec): { jobId: string; dir: string } {
  const { dir } = projectFolderPath(spec.name);
  const jobId = randomUUID();
  const emitter = new EventEmitter();

  const job: ProjectJob = {
    id: jobId,
    name: spec.name,
    type: spec.type,
    dir,
    status: "planning",
    phase: "plan",
    startedAt: Date.now(),
    lines: [],
  };

  const child = spawnClaude(job, emitter, dir, buildPlanPrompt(spec), "plan", (code) => {
    if (job.status === "planning") {
      if (code === 0) {
        job.status = "awaiting_approval";
        job.planText = job.resultText;
      } else {
        job.status = "error";
      }
    }
    job.endedAt = Date.now();
    emitter.emit("done", job);
  });

  jobs.set(jobId, { job, child, emitter, spec });
  return { jobId, dir };
}

// ── Faz 2: kullanıcı planı onayladı, gerçek çalıştırma başlasın ────────────────
export function approveProjectPlan(jobId: string): boolean {
  const entry = jobs.get(jobId);
  if (!entry || entry.job.status !== "awaiting_approval") return false;

  const { job, emitter, spec } = entry;
  const prompt =
    buildPrompt(spec) +
    (job.planText ? `\n\nOnaylanmış plan (buna sadık kal):\n${job.planText}` : "");

  job.status = "running";
  job.phase = "execute";
  job.lines = [];
  job.startedAt = Date.now();
  job.endedAt = undefined;
  job.costUsd = undefined;
  job.resultText = undefined;

  const child = spawnClaude(job, emitter, job.dir, prompt, "bypassPermissions", (code) => {
    if (job.status === "running") job.status = code === 0 ? "done" : "error";
    job.endedAt = Date.now();
    emitter.emit("done", job);
  });

  entry.child = child;
  return true;
}

// ── Kullanıcı planı reddetti ────────────────────────────────────────────────
export function rejectProjectPlan(jobId: string): boolean {
  const entry = jobs.get(jobId);
  if (!entry || entry.job.status !== "awaiting_approval") return false;

  entry.job.status = "rejected";
  entry.job.endedAt = Date.now();
  entry.emitter.emit("done", entry.job);
  return true;
}

export function getJobEntry(jobId: string): JobEntry | undefined {
  return jobs.get(jobId);
}

export function getJobSummary(jobId: string): ProjectJob | undefined {
  return jobs.get(jobId)?.job;
}

export function listJobs(): ProjectJob[] {
  return [...jobs.values()]
    .map((e) => e.job)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export async function stopJob(jobId: string): Promise<boolean> {
  const entry = jobs.get(jobId);
  if (!entry) return false;

  if (entry.job.status === "awaiting_approval") {
    return rejectProjectPlan(jobId);
  }

  if (entry.job.status !== "running" && entry.job.status !== "planning") return true;

  const { child } = entry;
  await new Promise<void>((resolveKill) => {
    if (process.platform === "win32" && child.pid) {
      exec(`taskkill /pid ${child.pid} /T /F`, () => resolveKill());
    } else {
      child.kill("SIGTERM");
      resolveKill();
    }
  });

  entry.job.status = "stopped";
  entry.job.endedAt = Date.now();
  entry.emitter.emit("done", entry.job);
  return true;
}
