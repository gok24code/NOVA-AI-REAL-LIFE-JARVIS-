"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadMemory, saveMemory, type Message } from "./memory";
import { canListen, startListen, type ListenHandle } from "./speechEngine";
import { playListenChime } from "./chime";
import { NOVA_ACTION_DESCRIPTIONS, CLASSIFIABLE_ACTION_KEYS, type NovaActionKey, type ClassifiableActionKey } from "./novaActions";

import {
  type BargeInContext,
  type BargeInResult,
  createBargeInContext,
  intelligentBargeInHandler,
  isSemanticCheckEnabled,
} from "./intelligentBargeIn";

export type ModelStatus =
  | "ready"
  | "listening"
  | "speaking"
  | "thinking"
  | "error"
  | "unsupported";

export type OrbIntent = "zoom_in" | "zoom_out" | "reset" | "sleep"
  | "pick_folder" | "next_model" | "prev_model" | "clear_model"
  | "open_scanner" | "close_scanner" | "describe_scene"
  | "open_project_form" | "close_project_form"
  | "select_model_1" | "select_model_2" | "select_model_3" | "select_model_4" | "select_model_5"
  | "cancel" | "close_map" | "pause_music" | "resume_music" | "close_music" | "stop_all";

export interface VoiceResult {
  modelStatus: ModelStatus;
  isListening: boolean;
  lastTranscript: string;
  lastResponse: string;
  ollamaOnline: boolean;
  ollamaChecked: boolean;
  startListening: () => void;
  stopListening: () => void;
  sendText: (text: string) => void;
  speakText: (text: string) => void;
  narrateAndSpeak: (actionKey: NovaActionKey, detail: string) => void;
}

// ─── SAYI → TÜRKÇE ───────────────────────────────────────────────────────────

const TR_ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TR_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

function numToTR(n: number): string {
  if (isNaN(n)) return String(n);
  if (n < 0) return `eksi ${numToTR(-n)}`;
  if (n === 0) return "sıfır";
  if (n < 10) return TR_ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return o === 0 ? TR_TENS[t] : `${TR_TENS[t]} ${TR_ONES[o]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), rest = n % 100;
    const prefix = h === 1 ? "yüz" : `${TR_ONES[h]} yüz`;
    return rest === 0 ? prefix : `${prefix} ${numToTR(rest)}`;
  }
  if (n < 1_000_000) {
    const k = Math.floor(n / 1000), rest = n % 1000;
    const prefix = k === 1 ? "bin" : `${numToTR(k)} bin`;
    return rest === 0 ? prefix : `${prefix} ${numToTR(rest)}`;
  }
  return String(n);
}

// Saat için (sadece 0-59 arası)
function toTR(n: number): string { return numToTR(n); }

function normalizeForTTS(text: string): string {
  return text
    // Derece: -5°C, 23.5°C, 18 °C
    .replace(/(-?\d+(?:[.,]\d+)?)\s*°C/g, (_, n) => {
      const val = parseFloat(n.replace(",", "."));
      const int = Math.trunc(val);
      const dec = Math.round(Math.abs(val % 1) * 10);
      const base = numToTR(int);
      return dec > 0 ? `${base} nokta ${numToTR(dec)} derece` : `${base} derece`;
    })
    // Yüzde: %45 veya 45%
    .replace(/%\s*(\d+(?:[.,]\d+)?)/g, (_, n) => `yüzde ${numToTR(Math.round(parseFloat(n.replace(",", "."))))}`)
    .replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_, n) => `yüzde ${numToTR(Math.round(parseFloat(n.replace(",", "."))))}`)
    // Ondalıklı sayılar: 23.5 → yirmi üç nokta beş
    .replace(/\b(\d+)[.,](\d+)\b/g, (_, int, dec) => `${numToTR(parseInt(int))} nokta ${numToTR(parseInt(dec))}`)
    // Kalan tam sayılar (4+ hane hariç — URL, yıl vb. bozulmasın)
    .replace(/\b([1-9]\d{0,2})\b/g, (_, n) => numToTR(parseInt(n)));
}

// ─── WEB SEARCH ──────────────────────────────────────────────────────────────

const SEARCH_TRIGGERS = [
  "haber", "güncel", "son dakika", "bugün", "dün", "bu hafta",
  "fiyat", "kaç para", "ne kadar", "döviz", "dolar", "euro", "kur", "borsa",
  "hava durumu", "hava nasıl",
  "kim", "kimdir", "nedir", "nerede", "ne zaman", "nezaman",
  "nasıl yapılır", "tarifi", "tarif",
  "maç", "skor", "sonuç",
  "seçim", "deprem", "kaza",
];

function needsSearch(text: string): boolean {
  const t = text.toLowerCase();
  return SEARCH_TRIGGERS.some((kw) => t.includes(kw));
}

async function webSearch(query: string): Promise<string | null> {
  try {
    const res = await fetch("/api/services/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      answer?: string | null;
      results?: { title: string; content: string }[];
    };

    const lines: string[] = [];
    if (data.answer) lines.push(`Özet: ${data.answer}`);
    (data.results ?? []).forEach((r) => {
      lines.push(`${r.title}: ${r.content}`);
    });
    return lines.length ? lines.join("\n\n") : null;
  } catch {
    return null;
  }
}

// ─── SELF-UPDATE (öğrenilen notlar) ───────────────────────────────────────────

const LEARN_PATTERN = /^(?:şunu|bunu)\s+(?:öğren|not al|hat[ıi]rla)\s*:?\s*(.+)$/i;

function extractLesson(text: string): string | null {
  const m = text.trim().match(LEARN_PATTERN);
  return m?.[1]?.trim() || null;
}

async function saveLesson(lesson: string): Promise<void> {
  try {
    await fetch("/api/self-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson }),
    });
  } catch {
    // sessizce yoksay
  }
}

// Şu ana kadar öğrenilen dersleri getirir (dedupe kontrolü için)
async function fetchExistingLessons(): Promise<string[]> {
  try {
    const res = await fetch("/api/self-update");
    if (!res.ok) return [];
    const data = (await res.json()) as { lessons?: string[] };
    return data.lessons ?? [];
  } catch {
    return [];
  }
}

// /api/llm'den dönen ndjson stream'ini tek bir metne biriktirir (tek seferlik,
// arka plan çağrıları için — konuşurken cümle cümle konuşulmasına gerek yok)
async function collectOllamaText(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as { message?: { content?: string } };
        fullText += json.message?.content ?? "";
      } catch { /* malformed line */ }
    }
  }
  return fullText.trim();
}

// Sohbet geçmişinden tek cümlelik bir ders çıkarmayı dener (arka planda, sessizce).
// Sadece açıkça söylenen bilgiyi değil, örtük tercihleri, düzeltmeleri ve tekrar eden
// davranış kalıplarını da yakalamaya çalışır. Zaten bilinen bir şeyi tekrar kaydetmemesi
// için mevcut notları prompt'a dahil eder.
async function distillLesson(history: Message[]): Promise<void> {
  if (history.length < 4) return;
  try {
    const transcript = history
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Kullanıcı" : "NOVA"}: ${m.content}`)
      .join("\n");
    const existing = await fetchExistingLessons();
    const knownBlock = existing.length
      ? `\n\nZaten bilinenler (bunları veya anlamca aynı olan bir şeyi tekrar çıkarma):\n${existing.map((l) => `- ${l}`).join("\n")}`
      : "";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content:
              `Aşağıdaki konuşmayı incele. Kullanıcı hakkında yeniden kullanılabilir, somut bir çıkarım var mı? ` +
              `Sadece açıkça söylenmiş bilgi değil; örtük bir tercih (ör. bir şeyi hep aynı şekilde istemesi), ` +
              `bir düzeltme (ör. NOVA'yı bir konuda uyarması), bir alışkanlık veya tekrar eden bir niyet de sayılır. ` +
              `Varsa TEK CÜMLELİK, somut bir ders yaz. Yoksa ya da zaten bilinenlerle aynıysa sadece "YOK" yaz, başka hiçbir şey yazma.` +
              knownBlock +
              `\n\n---\n\n${transcript}`,
          },
        ],
        context: "Kısa ve öz cevap ver, sadece istenen tek cümleyi veya YOK yaz.",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return;

    const lesson = await collectOllamaText(res);
    if (lesson && !/^yok\.?$/i.test(lesson)) {
      void saveLesson(lesson);
    }
  } catch {
    // arka plan işlemi — sessizce yoksay
  }
}

// ─── TERCİH HAFIZASI (nova_preferences.json — alan bazlı, sadece SON değer) ───

async function getPreference(area: string, key: string): Promise<string | null> {
  try {
    const res = await fetch("/api/preferences");
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, Record<string, string>>;
    return data[area]?.[key] ?? null;
  } catch {
    return null;
  }
}

async function setPreference(area: string, key: string, value: string): Promise<void> {
  try {
    await fetch("/api/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area, key, value }),
    });
  } catch {
    // sessizce yoksay
  }
}

// ─── EYLEM ANLATIMI (şablon yerine özgün, tek cümlelik sesli geri bildirim) ───
// Bir eylem gerçekleştikten sonra sonucu Ollama'ya anlattırır — aynı fonksiyon
// her seferinde aynı kalıp cümleyi değil, kendi tarzında, o ana özgü bir cümle
// üretir. Ollama kapalıysa veya zaman aşımına uğrarsa null döner, çağıran taraf
// sabit yedek cümleye düşer.
async function narrateAction(actionKey: keyof typeof NOVA_ACTION_DESCRIPTIONS, detail: string): Promise<string | null> {
  const description = NOVA_ACTION_DESCRIPTIONS[actionKey];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content:
              `Az önce şunu yaptın: ${description}\nSonuç: ${detail}\n` +
              `Bunu kullanıcıya TEK KISA CÜMLEDE, kendi doğal tarzında haber ver. ` +
              `Kalıp gibi durmasın, önceki söylediklerinle birebir aynı olmasın. Sadece o cümleyi yaz, başka hiçbir şey ekleme.`,
          },
        ],
        context: "Kısa ve öz cevap ver, sadece istenen tek cümleyi yaz.",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const text = await collectOllamaText(res);
    return text || null;
  } catch {
    return null;
  }
}

// ─── NİYET ÇIKARIMI (tetikleyici kelime eşleşmese bile eylem tetikleme) ───────
// Kullanıcı "müzik çal" gibi net bir tetikleyici söylemeden, dolaylı bir
// cümleyle bir eylemi kastettiğinde (ör. "canım sıkıldı biraz müzik olsa iyi
// olurdu") bunu Ollama'ya sordurur. Sadece regex/tetikleyici eşleşmesi
// BAŞARISIZ olup genel sohbete düştüğümüzde çağrılır — asla ana yanıtı
// bekletmez (arka planda, sessizce). Ollama kapalıysa veya zaman aşımına
// uğrarsa null döner, hiçbir şey tetiklenmez.
const ACTION_LINE_RE = /^([a-z_]+)\((.*)\)$/i;

async function classifyAction(text: string, systemStatus: string): Promise<{ action: ClassifiableActionKey; arg: string } | null> {
  const actionList = CLASSIFIABLE_ACTION_KEYS
    .map((k) => `- ${k}(${k === "stop_all" ? "" : "argüman"}): ${NOVA_ACTION_DESCRIPTIONS[k]}`)
    .join("\n");
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch("/api/llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content:
              `Kullanıcı sesli asistana şunu söyledi: "${text}"\n` +
              `Şu an sistemde: ${systemStatus}\n\n` +
              `Kullanıcı şu eylemlerden birini kastetmiş olabilir (kelimeleri birebir kullanmasa bile):\n${actionList}\n\n` +
              `Özellikle: kullanıcı bir sanatçı/grup/şarkı adı söyleyip bunu "aç", "çal", "dinlet", "başlat" gibi bir ` +
              `fiille kullanıyorsa (ör. "ACDC aç", "Tarkan çal") bu KESİNLİKLE play_music'tir — sanatçı adını tanımana ` +
              `gerek yok, doğrudan play_music(söylenen isim) yaz.\n\n` +
              `Eminsen SADECE şu formatta tek satır yaz: eylem_adı(argüman) — argüman gerekmiyorsa eylem_adı()\n` +
              `Emin değilsen, bu sadece normal bir sohbet cümlesiyse, ya da zaten sistemde o durum aktifse (ör. müzik zaten çalıyorsa play_music tekrar yazma) SADECE "YOK" yaz. Başka hiçbir şey yazma, açıklama yapma.`,
          },
        ],
        context: "Kısa ve öz cevap ver, sadece istenen formatta tek satır yaz.",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const raw = await collectOllamaText(res);
    if (!raw || /^yok\.?$/i.test(raw)) return null;
    const m = raw.match(ACTION_LINE_RE);
    if (!m) return null;
    const [, action, argRaw] = m;
    if (!(CLASSIFIABLE_ACTION_KEYS as readonly string[]).includes(action)) return null;
    return { action: action as ClassifiableActionKey, arg: argRaw.trim().replace(/^["']|["']$/g, "") };
  } catch {
    return null;
  }
}

// ─── KULLANICI PROFİLİ (isim, tercihler — yapılandırılmış, lessons'tan ayrı) ──

const NAME_PATTERNS: RegExp[] = [
  /^(?:benim\s+)?ad[ıi]m\s+(.+)$/i,
  /^ismim\s+(.+)$/i,
  /^beni\s+(.+?)\s+olarak\s+(?:çağır|adlandır|hat[ıi]rla)$/i,
];

function extractName(text: string): string | null {
  const t = text.trim();
  for (const pat of NAME_PATTERNS) {
    const m = t.match(pat);
    if (m?.[1]?.trim()) return m[1].trim().replace(/[.!?]+$/, "");
  }
  return null;
}

const PREFERENCE_PATTERN = /^(?:tercihimi|bunu tercih olarak)\s+kaydet\s*:?\s*(.+)$/i;

function extractPreference(text: string): string | null {
  const m = text.trim().match(PREFERENCE_PATTERN);
  return m?.[1]?.trim() || null;
}

async function saveProfile(fields: { name?: string; preference?: string }): Promise<void> {
  try {
    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  } catch {
    // sessizce yoksay
  }
}

// ─── VIDEO & MODEL DETECTION ──────────────────────────────────────────────────

const VIDEO_PATTERNS: RegExp[] = [
  // "youtube'dan X aç/oynat" veya sadece "youtube'dan X"
  /^youtube['u’]?(?:dan|de|da)?\s+(.+?)\s*(?:aç|oynat|göster|izlet|bul|ara)?$/i,
  // "X'i youtube'da aç"
  /^(.+?)\s+youtube['u’]?(?:da|de)\s+(?:aç|oynat|göster|bul|ara)/i,
  /^(.+?)\s+(?:videosu(?:nu)?|videoyu|klibini)\s+(?:oynat|aç|göster|izlet|bul)/i,
  /^(.+?)\s+(?:video|klip)\s+(?:oynat|aç|göster|bul|ara)/i,
  /^(.+?)\s+izle$/i,
  /^(?:oynat|izlet|göster|bul)\s+(.+?)(?:\s+video(?:su(?:nu)?|yu)?)?$/i,
];

function extractVideoQuery(text: string): string | null {
  const t = text.trim();
  for (const pat of VIDEO_PATTERNS) {
    const m = t.match(pat);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

const MODEL_LOAD_PATTERN = /^(.+?)\s+model(?:ini|i|ni|nu)?\s+(?:yükle|göster|aç|bul)/i;

function extractModelName(text: string): string | null {
  const m = text.trim().match(MODEL_LOAD_PATTERN);
  return m?.[1]?.trim() ?? null;
}

// ─── MÜZİK İSTEĞİ ─────────────────────────────────────────────────────────────

// Doğal konuşmaya dayanıklı olması için regex yerine (Thingiverse aramasındaki
// gibi) tetikleyici-kelime yaklaşımı kullanılıyor — "çalar mısın", "açsana" gibi
// ekler .includes() ile prefix eşleşmesi sayesinde otomatik yakalanıyor.
const MUSIC_TRIGGERS = [
  "şarkısını çal", "şarkısını aç", "şarkısını oynat", "şarkısını dinlet",
  "müziğini çal", "müziğini aç",
  "müzik çal", "müzik aç", "müzik dinlet",
  "şarkı çal", "şarkı aç", "şarkı dinlet",
  "dinletir misin", "dinlet",
  "çalar mısın", "çalsana", "açsana",
];

// "çal" alone as an imperative verb ("play!") — matched as a standalone word
// so it doesn't also fire on "çalış", "çalıyor", "çalıntı" etc.
const STANDALONE_CAL_RE = /\bçal\b/i;

const FILLER_WORDS = ["bana", "biraz", "lütfen", "şimdi", "hemen", "bi"];

// Baştaki VEYA sondaki dolgu kelimeleri temizler (örn. "internette ejderha"
// -> "ejderha", "ejderha 3 boyutlu" -> "ejderha")
function stripWords(s: string, words: string[]): string {
  let t = s.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of words) {
      const leadRe = new RegExp(`^${w}\\s+`, "i");
      const trailRe = new RegExp(`\\s+${w}$`, "i");
      if (leadRe.test(t)) {
        t = t.replace(leadRe, "").trim();
        changed = true;
      } else if (trailRe.test(t)) {
        t = t.replace(trailRe, "").trim();
        changed = true;
      }
    }
  }
  return t;
}

function stripFillers(s: string): string {
  return stripWords(s, FILLER_WORDS);
}

// null = tetikleyici hiç eşleşmedi. "" = tetikleyici eşleşti ama şarkı/sanatçı
// belirtilmedi ("müzik aç" gibi) — çağıran taraf bu durumda en son çalınanı
// hatırlayıp onu kullanır.
function extractMusicQuery(text: string): string | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const trigger = MUSIC_TRIGGERS.find((kw) => lower.includes(kw));
  if (!trigger) return null;

  const idx = lower.indexOf(trigger);
  const before = stripFillers(stripPossessiveSuffix(trimmed.slice(0, idx).trim()));
  const after = stripFillers(trimmed.slice(idx + trigger.length).trim());
  return before || after;
}

// ─── HARİTA İSTEĞİ ────────────────────────────────────────────────────────────

const MAP_PATTERNS: RegExp[] = [
  /^(?:bana\s+)?(.+?)\s+haritas[ıi]n[ıi]?\s*(?:göster|aç|bul)?$/i,
  /^(?:bana\s+)?haritada\s+(.+?)\s*(?:göster|bul|aç)?$/i,
  /^(?:bana\s+)?(.+?)\s+haritada\s+göster$/i,
  /^harita\s+(.+)$/i,
];

// Şehir belirtilmeden bare "haritayı aç/göster" — bu durumda en son gösterilen
// şehir hatırlanır
const MAP_BARE_OPEN_RE = /^haritay?ı\s+(?:aç|göster)$/i;

function stripPossessiveSuffix(s: string): string {
  return s.replace(/['’]\p{L}+$/u, "").trim();
}

// null = tetikleyici hiç eşleşmedi. "" = tetikleyici eşleşti ama şehir
// belirtilmedi — çağıran taraf en son gösterilen şehri hatırlayıp onu kullanır.
function extractMapQuery(text: string): string | null {
  const t = text.trim();
  if (MAP_BARE_OPEN_RE.test(t)) return "";
  for (const pat of MAP_PATTERNS) {
    const m = t.match(pat);
    if (m?.[1]?.trim()) return stripPossessiveSuffix(m[1].trim());
  }
  return null;
}

// ─── HAZIR 3D MODEL ARAMA (Thingiverse) ──────────────────────────────────────

const MODEL_SEARCH_TRIGGERS = [
  "kılıf bul", "kılıf indir", "kılıf ara",
  "parça bul", "parça indir", "parça ara",
  "model bul", "model indir", "model ara",
  "stl bul", "stl indir", "stl ara",
  "tasarım bul", "tasarım indir",
];

// Sorguya karışan ama aslında aranan nesnenin bir parçası olmayan kelimeler
// ("internette model ara" dediğinde "internette" sorguya girmesin, zaten
// arama internet üzerinden yapılıyor; "3 boyutlu" da öyle, zaten 3D model
// aranıyor — Thingiverse'e giden terimi gereksiz yere kirletiyor ve İngilizce
// çeviriyi de bozuyordu)
const MODEL_SEARCH_FILLER_WORDS = ["internette", "internetten", "online", "çevrimiçi", "3 boyutlu", "üç boyutlu", "3d", "için", "amacıyla"];

function extractModelSearchQuery(text: string): string | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const trigger = MODEL_SEARCH_TRIGGERS.find((kw) => lower.includes(kw));
  if (!trigger) return null;

  const idx = lower.indexOf(trigger);
  const before = trimmed.slice(0, idx).trim();
  const raw = before || trimmed.replace(new RegExp(trigger, "i"), "").trim();
  const query = stripWords(raw, MODEL_SEARCH_FILLER_WORDS);
  return query || null;
}

const NEWS_TRIGGERS_V = ["son dakika", "güncel haber", "son haberler"];

function needsNewsChoice(text: string): boolean {
  const t = text.toLowerCase();
  return NEWS_TRIGGERS_V.some((kw) => t.includes(kw));
}

// ─── YEREL KOMUT MOTORU ──────────────────────────────────────────────────────

type CommandDef = {
  patterns: string[];
  exact?: string[];
  response: () => string;
  intent?: OrbIntent;
};

const COMMANDS: CommandDef[] = [
  {
    patterns: ["yaklaştır", "büyüt", "zoom in", "zoom yap", "yakın"],
    response: () => "Yaklaştırılıyor.",
    intent: "zoom_in",
  },
  {
    patterns: ["uzaklaştır", "küçült", "zoom out", "uzak"],
    response: () => "Uzaklaştırılıyor.",
    intent: "zoom_out",
  },
  {
    patterns: ["sıfırla", "resetle", "başa al", "başa dön"],
    response: () => "Görünüm sıfırlandı.",
    intent: "reset",
  },
  {
    // Bare "kapat" kasıtlı olarak patterns'ten exact'e taşındı — substring
    // olarak dururken "haritayı kapat", "müziği kapat", "modeli kapat",
    // "kamerayı kapat" gibi TAMAMEN FARKLI komutları da yakalayıp (bu giriş
    // dizide onlardan önce geldiği için) yanlışlıkla uykuya geçiriyordu.
    patterns: ["sus", "uyu", "bekleme moduna geç", "sessiz ol", "görüşürüz nova", "bay bay nova"],
    exact: ["kapat"],
    response: () => "Anlaşıldı. Bekleme moduna geçiyorum.",
    intent: "sleep",
  },
  {
    patterns: ["vazgeç"],
    response: () => "Vazgeçildi.",
    intent: "cancel" as OrbIntent,
  },
  {
    // Kısa panik kelimeleri ("dur"/"yeter"/"kes") kasıtlı olarak substring
    // değil TAM eşleşme (exact) — "duruyor", "durum ne" gibi alakasız
    // cümlelere yanlışlıkla tetiklenmesin. Doğal/dolaylı ifadeler ("kaosu
    // durdur", "artık yeter bu kadar" vb.) buradaki listeye girmez —
    // onları Ollama'nın niyet çıkarımı (bkz. classifyAction) yakalar; bu
    // giriş sadece Ollama kapalıyken veya çok acil anlarda anında çalışan
    // bir güvenlik ağı.
    // Not: "sistemi sıfırla" kasıtlı olarak burada yok — "sıfırla" zaten
    // "reset" komutunda (bu diziden önce) substring pattern olarak var,
    // dizide daha önce geldiği için hep onu tetikleyip buraya hiç ulaşmazdı.
    // classifyAction bu ifadeyi anlamdan zaten yakalıyor.
    patterns: ["her şeyi durdur", "her şeyi kapat", "hepsini kapat", "hepsini durdur"],
    exact: ["dur", "yeter", "kes"],
    response: () => "Durduruldu.",
    intent: "stop_all" as OrbIntent,
  },
  {
    patterns: ["haritayı kapat", "haritayı gizle"],
    response: () => "Harita kapatılıyor.",
    intent: "close_map" as OrbIntent,
  },
  {
    patterns: ["müziği durdur", "şarkıyı durdur", "müzik durdur", "müziği duraklat"],
    response: () => "Müzik duraklatıldı.",
    intent: "pause_music" as OrbIntent,
  },
  {
    patterns: ["müziğe devam et", "müziği devam ettir", "şarkıya devam et", "müziği başlat", "devam et"],
    response: () => "Müzik devam ediyor.",
    intent: "resume_music" as OrbIntent,
  },
  {
    patterns: ["müziği kapat", "şarkıyı kapat"],
    response: () => "Müzik kapatılıyor.",
    intent: "close_music" as OrbIntent,
  },
  {
    patterns: ["modelleri getir", "model getir", "modelleri aç", "klasör seç", "model klasörü", "klasör aç", "dosyaları getir"],
    response: () => "Modeller yükleniyor.",
    intent: "pick_folder" as OrbIntent,
  },
  {
    patterns: ["sonraki", "ileri", "sonraki model"],
    response: () => "Sonraki model.",
    intent: "next_model" as OrbIntent,
  },
  {
    patterns: ["önceki", "geri", "önceki model"],
    response: () => "Önceki model.",
    intent: "prev_model" as OrbIntent,
  },
  {
    patterns: ["modeli kaldır", "modeli kapat", "modeli temizle"],
    response: () => "Model kaldırıldı.",
    intent: "clear_model" as OrbIntent,
  },
  {
    // Bare "tara" da aynı sebepten exact'e taşındı ("tarafından", "taraftar"
    // gibi kelimeler substring olarak yanlışlıkla eşleşmesin diye)
    patterns: ["kamerayı aç", "taramayı aç", "nesne tara"],
    exact: ["tara"],
    response: () => "Kamera açılıyor.",
    intent: "open_scanner" as OrbIntent,
  },
  {
    patterns: ["kamerayı kapat", "taramayı kapat"],
    response: () => "Kamera kapatıldı.",
    intent: "close_scanner" as OrbIntent,
  },
  {
    patterns: ["ne görüyorsun", "ne var orada", "etrafı anlat", "ortamı anlat"],
    response: () => "Sahneyi analiz ediyorum.",
    intent: "describe_scene" as OrbIntent,
  },
  {
    patterns: ["yeni proje", "proje oluştur", "proje başlat", "proje formu", "proje yarat"],
    response: () => "Proje formu açılıyor.",
    intent: "open_project_form" as OrbIntent,
  },
  {
    patterns: ["proje formunu kapat", "formu kapat"],
    response: () => "Proje formu kapatılıyor.",
    intent: "close_project_form" as OrbIntent,
  },
  {
    patterns: ["birincisini indir", "birinci modeli indir", "birinci seçenek", "bir numarayı indir"],
    exact: ["birinci", "bir", "ilk", "ilkini"],
    response: () => "",
    intent: "select_model_1" as OrbIntent,
  },
  {
    patterns: ["ikincisini indir", "ikinci modeli indir", "ikinci seçenek", "iki numarayı indir"],
    exact: ["ikinci", "iki", "ikincisini"],
    response: () => "",
    intent: "select_model_2" as OrbIntent,
  },
  {
    patterns: ["üçüncüsünü indir", "üçüncü modeli indir", "üçüncü seçenek", "üç numarayı indir"],
    exact: ["üçüncü", "üç", "üçüncüsünü"],
    response: () => "",
    intent: "select_model_3" as OrbIntent,
  },
  {
    patterns: ["dördüncüsünü indir", "dördüncü modeli indir", "dördüncü seçenek", "dört numarayı indir"],
    exact: ["dördüncü", "dört", "dördüncüsünü"],
    response: () => "",
    intent: "select_model_4" as OrbIntent,
  },
  {
    patterns: ["beşincisini indir", "beşinci modeli indir", "beşinci seçenek", "beş numarayı indir"],
    exact: ["beşinci", "beş", "beşincisini"],
    response: () => "",
    intent: "select_model_5" as OrbIntent,
  },
  {
    // Bare "saat" patterns'te (substring) dururken "saat kaç" DIŞINDA "saat
    // yönünde çevir", "bu saat kaça alındı" gibi hiç alakasız cümlelerde de
    // tetikleniyordu, cümlenin geri kalanına hiç bakmadan direkt saati
    // söylüyordu. Artık sadece TEK BAŞINA "saat" dendiğinde çalışıyor.
    patterns: ["saat kaç", "saat kaçta", "saatin kaç"],
    exact: ["saat"],
    response: () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      if (m === 0) return `Saat tam ${toTR(h)}.`;
      return `Saat ${toTR(h)} ${toTR(m)}.`;
    },
  },
  {
    // Bare "tarih"/"bugün" aynı sebepten exact'e taşındı — "bugün canım
    // sıkıldı" gibi cümlelerde "bugün" geçtiği için yanlışlıkla tarih
    // söylenmesini önlüyor.
    patterns: ["hangi gün", "günlerden ne"],
    exact: ["tarih", "bugün"],
    response: () =>
      `Bugün ${new Date().toLocaleDateString("tr-TR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
  },
];

function matchLocalCommand(input: string): CommandDef | null {
  const normalized = input.toLowerCase().trim();
  for (const cmd of COMMANDS) {
    if (cmd.exact?.includes(normalized)) return cmd;
  }
  for (const cmd of COMMANDS) {
    if (cmd.patterns.some((p) => normalized.includes(p))) return cmd;
  }
  return null;
}

// ─── ELEVENLABS SPEAK ────────────────────────────────────────────────────────

let activeAudio: HTMLAudioElement | null = null;
// TTS istekleri ağ üzerinden asenkron dönüyor — art arda gelen iki speak() çağrısında
// ikincisi başladığında birincisinin fetch'i hâlâ bekliyor olabilir, bu yüzden
// cancelSpeech() henüz iptal edecek bir şey bulamıyor ve ikisi de sonradan çalmaya
// başlayıp üst üste biniyordu. Token, "en son başlatılan speak() hangisi" bilgisini
// tutarak eski (geçersiz kılınmış) bir isteğin sesi hiç çalmamasını garanti eder.
let speakToken = 0;

function cancelSpeech() {
  speakToken++;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = "";
    activeAudio = null;
  }
}

function speak(text: string, onEnd?: () => void): void {
  cancelSpeech();
  const myToken = speakToken;
  const clean = normalizeForTTS(text.trim());
  if (!clean) { onEnd?.(); return; }

  fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: clean }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      if (myToken !== speakToken) { onEnd?.(); return; } // daha yeni bir speak() bunu geçersiz kıldı
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); activeAudio = null; onEnd?.(); };
      audio.onerror = () => { URL.revokeObjectURL(url); activeAudio = null; onEnd?.(); };
      return audio.play();
    })
    .catch(() => { onEnd?.(); });
}

// ─── OLLAMA STREAMING ─────────────────────────────────────────────────────────

const SENTENCE_END = /[.!?…]\s*$/;

async function streamOllama(
  messages: { role: "user" | "assistant"; content: string }[],
  onSentence: (sentence: string) => void,
  signal: AbortSignal,
  context?: string,
): Promise<string> {
  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
    signal,
  });

  if (!res.ok || !res.body) throw new Error(`LLM ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sentenceBuffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
        };
        const token = json.message?.content ?? "";
        if (token) {
          fullText += token;
          sentenceBuffer += token;

          if (SENTENCE_END.test(sentenceBuffer.trim())) {
            const sentence = sentenceBuffer.trim();
            sentenceBuffer = "";
            if (sentence) onSentence(sentence);
          }
        }
      } catch { /* malformed line */ }
    }
  }

  // flush remaining
  if (sentenceBuffer.trim()) onSentence(sentenceBuffer.trim());
  return fullText;
}

const GREETING = "NOVA sistemi başlatılıyor... Tüm modüller aktif. Merhaba, sizi dinliyorum.";

// ─── HOOK ─────────────────────────────────────────────────────────────────────

export function useVoice(
  onTranscript?: (text: string) => void,
  onIntent?: (intent: OrbIntent) => void,
  onVideoRequest?: (query: string) => void,
  onModelLoad?: (name: string) => void,
  onModelSearch?: (query: string) => void,
  onMapRequest?: (city: string) => void,
  onMusicRequest?: (query: string) => void,
  getSystemStatus?: () => string,
): VoiceResult {
  const recognitionRef = useRef<ListenHandle | null>(null);
  const canListenRef = useRef(false);
  const conversationRef = useRef<Message[]>([]);
  const llmAbortRef = useRef<AbortController | null>(null);
  const lastTranscriptRef = useRef<string>("");
  const sessionRef = useRef(0);
  const processInputRef = useRef<((text: string) => Promise<void>) | null>(null);
  const bargeInRecognitionRef = useRef<ListenHandle | null>(null);
  const bargeInActiveRef = useRef(false);
  const lastAssistantMessageRef = useRef<string>("");
  const llmTurnCountRef = useRef(0);

  // Stable refs for callbacks — processInput never goes stale even across renders
  const onIntentRef      = useRef(onIntent);
  const onVideoReqRef    = useRef(onVideoRequest);
  const onModelLoadRef   = useRef(onModelLoad);
  const onModelSearchRef = useRef(onModelSearch);
  const onMapReqRef      = useRef(onMapRequest);
  const onMusicReqRef    = useRef(onMusicRequest);
  const getSystemStatusRef = useRef(getSystemStatus);
  useEffect(() => {
    onIntentRef.current    = onIntent;
    onVideoReqRef.current  = onVideoRequest;
    onModelLoadRef.current = onModelLoad;
    onModelSearchRef.current = onModelSearch;
    onMapReqRef.current = onMapRequest;
    onMusicReqRef.current = onMusicRequest;
    getSystemStatusRef.current = getSystemStatus;
  }, [onIntent, onVideoRequest, onModelLoad, onModelSearch, onMapRequest, onMusicRequest, getSystemStatus]);

  const [modelStatus, setModelStatus] = useState<ModelStatus>("unsupported");
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResponse, setLastResponse] = useState("");
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [ollamaChecked, setOllamaChecked] = useState(false);

  // Client-side init + hafıza yükle
  useEffect(() => {
    canListenRef.current = canListen();
    if (canListenRef.current) setModelStatus("ready");
    conversationRef.current = loadMemory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ollama status poll — every 10s
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/llm/status");
        const data = (await res.json()) as { ok: boolean };
        if (!cancelled) setOllamaOnline(data.ok);
      } catch {
        if (!cancelled) setOllamaOnline(false);
      } finally {
        if (!cancelled) setOllamaChecked(true);
      }
    }
    check();
    const id = setInterval(check, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Startup greeting
  useEffect(() => {
    if (!canListenRef.current) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) {
        setModelStatus("speaking");
        speak(GREETING, () => { if (!cancelled) setModelStatus("ready"); });
      }
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); cancelSpeech(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setModelStatus("ready");
  }, []);

  // ── Barge-in dinleyicisi: NOVA konuşurken kesme algılar ────────────────────
  function startBargeInListener(onUserSpoke: (userInput: string) => void): void {
    if (bargeInActiveRef.current || !canListenRef.current) return;
    bargeInActiveRef.current = true;

    bargeInRecognitionRef.current = startListen({
      lang: "tr-TR",
      onStart: () => {},
      onResult: (text: string, confidence: number) => {
        // Confidence eşiği: 0.4 (ılımlı — çok hassas değil, çok kör de değil)
        if (confidence > 0.4 && text.length > 2) {
          console.log(`[barge-in] Kesme algılandı: "${text}" (confidence ${confidence})`);
          stopBargeInListener();
          onUserSpoke(text);
        }
      },
      onError: () => { stopBargeInListener(); },
      onEnd: () => { stopBargeInListener(); },
    });
  }

  function stopBargeInListener(): void {
    if (bargeInRecognitionRef.current) {
      bargeInRecognitionRef.current.stop?.();
      bargeInRecognitionRef.current = null;
    }
    bargeInActiveRef.current = false;
  }

  // ── Cevap pipeline ────────────────────────────────────────────────────────
  const processInput = useCallback(async (text: string) => {
    const session = ++sessionRef.current;
    const isActive = () => session === sessionRef.current;

    // Önce yerel komutları kontrol et (zoom, ses komutları — hız kritik)
    const local = matchLocalCommand(text);
    if (local) {
      const reply = local.response();
      if (!isActive()) return;
      setLastResponse(reply);
      if (local.intent) onIntentRef.current?.(local.intent);

      // Navigasyon komutları: TTS bekleme olmadan anında tekrar dinlemeye dön
      const isNavIntent =
        local.intent === "next_model" ||
        local.intent === "prev_model" ||
        local.intent === "select_model_1" ||
        local.intent === "select_model_2" ||
        local.intent === "select_model_3" ||
        local.intent === "select_model_4" ||
        local.intent === "select_model_5";
      if (isNavIntent) {
        lastTranscriptRef.current = ""; // aynı komutu hemen tekrar kabul et
        setModelStatus("ready");
        return;
      }

      // Uykuya geçerken sohbetten sessizce tek cümlelik bir ders çıkarmayı dene (self-update)
      if (local.intent === "sleep" && ollamaOnline) {
        void distillLesson(conversationRef.current);
      }

      // "her şeyi durdur" — panel kapatmalar onIntentRef üzerinden JarvisOrb'a
      // gidiyor (yukarıda tetiklendi), burada da ses/LLM tarafını kesiyoruz:
      // o an süren bir cevap akışı varsa iptal et, barge-in dinleyicisini kapat.
      if (local.intent === "stop_all") {
        llmAbortRef.current?.abort();
        stopBargeInListener();
        cancelSpeech();
      }

      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Manuel ders (self-update): "şunu öğren: ..." ──────────────────────────
    const lesson = extractLesson(text);
    if (lesson) {
      if (!isActive()) return;
      const reply = "Not aldım, bunu hatırlayacağım.";
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      void saveLesson(lesson);
      speak(reply, () => { if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Kullanıcı adı: "adım X" / "ismim X" ────────────────────────────────────
    const userName = extractName(text);
    if (userName) {
      if (!isActive()) return;
      const reply = `Memnun oldum, ${userName}. Seni hatırlayacağım.`;
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      void saveProfile({ name: userName });
      speak(reply, () => { if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Tercih kaydı: "tercihimi kaydet: ..." ──────────────────────────────────
    const preference = extractPreference(text);
    if (preference) {
      if (!isActive()) return;
      const reply = "Tercihini kaydettim.";
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      void saveProfile({ preference });
      speak(reply, () => { if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Müzik isteği ─────────────────────────────────────────────────────────
    const musicQuery = extractMusicQuery(text);
    if (musicQuery !== null) {
      if (!isActive()) return;
      let query = musicQuery;
      if (!query) query = (await getPreference("music", "lastQuery")) ?? "";
      if (!isActive()) return;

      if (!query) {
        const reply = "Ne çalmamı istersin?";
        setLastResponse(reply);
        setModelStatus("speaking");
        conversationRef.current.push({ role: "user", content: text });
        conversationRef.current.push({ role: "assistant", content: reply });
        saveMemory(conversationRef.current);
        speak(reply, () => { if (isActive()) setModelStatus("ready"); });
        return;
      }
      void setPreference("music", "lastQuery", query);

      let reply = `${query} çalınıyor.`;
      if (ollamaOnline) {
        const narrated = await narrateAction("play_music", `${query} çalınmaya başlıyor.`);
        if (!isActive()) return;
        if (narrated) reply = narrated;
      }
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { onMusicReqRef.current?.(query); if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Video request ───────────────────────────────────────────────────────
    const videoQuery = extractVideoQuery(text);
    if (videoQuery) {
      if (!isActive()) return;
      const reply = `${videoQuery} için video aranıyor.`;
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { onVideoReqRef.current?.(videoQuery); if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Harita isteği ────────────────────────────────────────────────────────
    const mapQuery = extractMapQuery(text);
    if (mapQuery !== null) {
      if (!isActive()) return;
      let city = mapQuery;
      if (!city) city = (await getPreference("map", "lastCity")) ?? "";
      if (!isActive()) return;

      if (!city) {
        const reply = "Hangi şehri göstereyim?";
        setLastResponse(reply);
        setModelStatus("speaking");
        conversationRef.current.push({ role: "user", content: text });
        conversationRef.current.push({ role: "assistant", content: reply });
        saveMemory(conversationRef.current);
        speak(reply, () => { if (isActive()) setModelStatus("ready"); });
        return;
      }
      void setPreference("map", "lastCity", city);

      let reply = `${city} haritası gösteriliyor.`;
      if (ollamaOnline) {
        const narrated = await narrateAction("show_map", `${city} haritası açılıyor.`);
        if (!isActive()) return;
        if (narrated) reply = narrated;
      }
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { onMapReqRef.current?.(city); if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Hazır 3D model arama (Thingiverse) ──────────────────────────────────
    const searchQuery = extractModelSearchQuery(text);
    if (searchQuery) {
      if (!isActive()) return;
      const reply = `${searchQuery} için hazır model aranıyor.`;
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { onModelSearchRef.current?.(searchQuery); if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Named model load ────────────────────────────────────────────────────
    const modelName = extractModelName(text);
    if (modelName) {
      if (!isActive()) return;
      const reply = `${modelName} modeli aranıyor.`;
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { onModelLoadRef.current?.(modelName); if (isActive()) setModelStatus("ready"); });
      return;
    }

    // ── Son dakika haberleri — direkt video izlet, seçenek sorma ────────────
    if (needsNewsChoice(text)) {
      if (!isActive()) return;
      const reply = "Son dakika haber videosu aranıyor.";
      setLastResponse(reply);
      setModelStatus("speaking");
      conversationRef.current.push({ role: "user", content: text });
      conversationRef.current.push({ role: "assistant", content: reply });
      saveMemory(conversationRef.current);
      speak(reply, () => { onVideoReqRef.current?.(text); if (isActive()) setModelStatus("ready"); });
      return;
    }

    // Ollama varsa LLM'e yönlendir
    if (ollamaOnline) {
      llmAbortRef.current?.abort();
      const controller = new AbortController();
      llmAbortRef.current = controller;

      conversationRef.current.push({ role: "user", content: text });
      const history = conversationRef.current.slice(-20);

      setModelStatus("thinking");

      // Tetikleyici kelime eşleşmediği için buraya (genel sohbete) düştük —
      // yine de dolaylı bir şekilde bir eylem kastedilmiş olabilir. Ana
      // cevabı hiç bekletmeden, arka planda soruyoruz; sonuç gelince (ana
      // cevap zaten söylenmiş olsa bile) ilgili eylemi tetikliyoruz.
      void classifyAction(text, getSystemStatusRef.current?.() ?? "").then(async (result) => {
        if (!result || !isActive()) return;
        switch (result.action) {
          case "play_music": {
            // Argüman verilmediyse (ör. "canım sıkıldı biraz müzik olsa" gibi
            // hedefsiz bir istek) tetikleyici-kelime yolundaki gibi en son
            // çalınanı hatırlayıp onu kullan
            const query = result.arg || (await getPreference("music", "lastQuery")) || "";
            if (!isActive() || !query) return;
            void setPreference("music", "lastQuery", query);
            onMusicReqRef.current?.(query);
            break;
          }
          case "show_map": {
            const city = result.arg || (await getPreference("map", "lastCity")) || "";
            if (!isActive() || !city) return;
            void setPreference("map", "lastCity", city);
            onMapReqRef.current?.(city);
            break;
          }
          case "stop_all":
            llmAbortRef.current?.abort();
            stopBargeInListener();
            cancelSpeech();
            onIntentRef.current?.("stop_all");
            break;
          case "search_model":
            if (result.arg) onModelSearchRef.current?.(result.arg);
            break;
        }
      });

      // İnternet araması gerekiyorsa önce Tavily'e sor
      let searchContext: string | undefined;
      if (needsSearch(text)) {
        const results = await webSearch(text);
        if (!isActive()) return;
        if (results) {
          searchContext = `Aşağıdaki güncel web arama sonuçlarını kullanarak soruyu yanıtla:\n\n${results}`;
        }
      }

      // Sistem durumunu (hangi panel açık, müzik çalıyor mu vb.) her turda
      // ekliyoruz ki Nova "şu an ne oluyor"u bilerek cevap versin
      const statusLine = getSystemStatusRef.current?.();
      if (statusLine) {
        searchContext = searchContext ? `${searchContext}\n\n${statusLine}` : statusLine;
      }

      let fullReply = "";
      const sentenceQueue: string[] = [];
      let isSpeaking = false;
      let streamDone = false;

      function speakNext() {
        if (!isActive() || isSpeaking || sentenceQueue.length === 0) return;
        const sentence = sentenceQueue.shift()!;
        isSpeaking = true;
        setModelStatus("speaking");

        startBargeInListener((userInput: string) => {
          if (!isActive()) return;
          cancelSpeech();
          isSpeaking = false;

          const bargeInContext = createBargeInContext(
            lastAssistantMessageRef.current,
            conversationRef.current
          );

          void processBargeIn(userInput, bargeInContext);
        });

        speak(sentence, () => {
          stopBargeInListener();
          if (!isActive()) return;
          isSpeaking = false;
          lastAssistantMessageRef.current = sentence;
          if (sentenceQueue.length > 0) {
            speakNext();
          } else if (streamDone) {
            setModelStatus("ready");
          }
        });
      }

      try {
        fullReply = await streamOllama(
          history,
          (sentence) => {
            if (!isActive()) return;
            sentenceQueue.push(sentence);
            speakNext();
          },
          controller.signal,
          searchContext,
        );

        if (!isActive()) return;
        conversationRef.current.push({ role: "assistant", content: fullReply });
        saveMemory(conversationRef.current);
        setLastResponse(fullReply);
        lastAssistantMessageRef.current = fullReply;
        streamDone = true;

        // Konuşma sürerken de (sadece uykuya geçişte değil) arka planda sessizce
        // ders çıkarmayı dener — periyodik, engelleyici değil (fire-and-forget)
        llmTurnCountRef.current += 1;
        if (llmTurnCountRef.current % 3 === 0) {
          void distillLesson(conversationRef.current);
        }

        // stream bitti ama kuyruk hâlâ boşsa (kısa yanıtlar) direkt ready
        if (!isSpeaking && sentenceQueue.length === 0) {
          setModelStatus("ready");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError" && isActive()) {
          conversationRef.current.pop(); // başarısız user mesajını kaldır
          setModelStatus("ready");
        }
      }
      return;
    }

    // Ollama yoksa fallback
    if (!isActive()) return;
    const fallback = "Henüz yerel dil modeli bağlı değil. Ollama'yı başlatın ve yeniden deneyin.";
    setLastResponse(fallback);
    setModelStatus("speaking");
    speak(fallback, () => { if (isActive()) setModelStatus("ready"); });
  }, [ollamaOnline]);

  // ── Barge-in cevap pipeline: NOVA konuşurken kesildiğinde devreye girer ────
  const processBargeIn = useCallback(
    async (userInput: string, context: BargeInContext) => {
      const session = ++sessionRef.current;
      const isActive = () => session === sessionRef.current;

      let bargeInResult: BargeInResult;
      try {
        bargeInResult = await intelligentBargeInHandler(userInput, context, {
          useSemantic: isSemanticCheckEnabled(),
        });
      } catch (err) {
        console.error("[barge-in] Handler error:", err);
        await processInput(userInput);
        return;
      }

      if (!isActive()) return;
      console.log(`[barge-in] Action: ${bargeInResult.action} — ${bargeInResult.reasoning}`);

      if (bargeInResult.action === "command") {
        await processInput(userInput);
        return;
      }

      conversationRef.current.push({ role: "user", content: userInput });
      const history = conversationRef.current.slice(-20);
      setModelStatus("thinking");

      let searchContext: string | undefined;
      if (needsSearch(userInput)) {
        const results = await webSearch(userInput);
        if (!isActive()) return;
        if (results) {
          searchContext = `Aşağıdaki güncel web arama sonuçlarını kullanarak soruyu yanıtla:\n\n${results}`;
        }
      }

      const enrichedContext = bargeInResult.prompt
        ? searchContext
          ? `${bargeInResult.prompt}\n\n---\n\n${searchContext}`
          : bargeInResult.prompt
        : searchContext;

      let fullReply = "";
      const sentenceQueue: string[] = [];
      let isSpeaking = false;
      let streamDone = false;

      function speakNext() {
        if (!isActive() || isSpeaking || sentenceQueue.length === 0) return;
        const sentence = sentenceQueue.shift()!;
        isSpeaking = true;
        setModelStatus("speaking");
        speak(sentence, () => {
          if (!isActive()) return;
          isSpeaking = false;
          lastAssistantMessageRef.current = sentence;
          if (sentenceQueue.length > 0) {
            speakNext();
          } else if (streamDone) {
            setModelStatus("ready");
          }
        });
      }

      try {
        fullReply = await streamOllama(
          history,
          (sentence) => {
            if (!isActive()) return;
            sentenceQueue.push(sentence);
            speakNext();
          },
          llmAbortRef.current?.signal ?? new AbortController().signal,
          enrichedContext
        );

        if (!isActive()) return;
        conversationRef.current.push({ role: "assistant", content: fullReply });
        saveMemory(conversationRef.current);
        setLastResponse(fullReply);
        lastAssistantMessageRef.current = fullReply;
        streamDone = true;

        llmTurnCountRef.current += 1;
        if (llmTurnCountRef.current % 3 === 0) {
          void distillLesson(conversationRef.current);
        }

        if (!isSpeaking && sentenceQueue.length === 0) {
          setModelStatus("ready");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError" && isActive()) {
          conversationRef.current.pop();
          setModelStatus("ready");
        }
      }
    },
    [ollamaOnline]
  );

  useEffect(() => {
    processInputRef.current = processInput;
  }, [processInput]);

  const startListening = useCallback(() => {
    if (!canListenRef.current || isListening || recognitionRef.current) return;

    recognitionRef.current = startListen({
      lang: "tr-TR",
      onStart: () => {
        playListenChime();
        setIsListening(true);
        setModelStatus("listening");
      },
      onResult: (text, confidence) => {
        console.log(`[speech] result: "${text}" (confidence ${confidence})`);
        // Düşük güven veya çok kısa → gürültü, yoksay
        if (confidence < 0.5 || text.length < 3) return;

        // Bir öncekiyle aynıysa tekrar işleme
        if (text === lastTranscriptRef.current) return;
        lastTranscriptRef.current = text;

        setLastTranscript(text);
        onTranscript?.(text);
        void processInput(text);
      },
      onError: (error) => {
        if (error !== "no-speech" && error !== "aborted") {
          console.error("[speech] recognition error:", error);
        }
        setIsListening(false);
        setModelStatus("error");
      },
      onEnd: () => {
        recognitionRef.current = null;
        setIsListening(false);
        setModelStatus((prev) => (prev === "speaking" || prev === "thinking" ? prev : "ready"));
      },
    });
  }, [isListening, onTranscript, processInput]);

  const sendText = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setLastTranscript(clean);
    void processInput(clean);
  }, [processInput]);

  const speakText = useCallback((text: string) => {
    if (!text.trim()) return;
    setLastResponse(text);
    setModelStatus("speaking");
    speak(text, () => setModelStatus("ready"));
  }, []);

  // Bir eylem tamamlandıktan SONRA (ör. klasör okunup modeller yüklendikten sonra)
  // gerçek sonucu Ollama'ya özgün bir cümleyle anlattırıp söyler. Ollama kapalıysa
  // veya yanıt vermezse detay metnini olduğu gibi söyler (sessiz kalmaz).
  const narrateAndSpeak = useCallback((actionKey: NovaActionKey, detail: string) => {
    if (!detail.trim()) return;
    void (async () => {
      let reply = detail;
      if (ollamaOnline) {
        const narrated = await narrateAction(actionKey, detail);
        if (narrated) reply = narrated;
      }
      setLastResponse(reply);
      setModelStatus("speaking");
      speak(reply, () => setModelStatus("ready"));
    })();
  }, [ollamaOnline]);

  return {
    modelStatus,
    isListening,
    lastTranscript,
    lastResponse,
    ollamaOnline,
    ollamaChecked,
    startListening,
    stopListening,
    sendText,
    speakText,
    narrateAndSpeak,
  };
}
