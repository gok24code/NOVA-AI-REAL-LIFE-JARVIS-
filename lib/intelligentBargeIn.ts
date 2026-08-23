// lib/intelligentBargeIn.ts
// NOVA Intelligent Barge-In System v3 (+ Semantic Kontrol / Sprint 3)
// ─────────────────────────────────────────────────────────────────
// Amaç: Kesme sırasında bağlamı koruyarak doğal konuşma
// Yöntem: Anahtar kelime benzerliği + (şüpheli bölgede) semantic embedding
//         + sistem prompt enrichment

export type BargeInContext = {
  lastAssistantMessage: string;    // NOVA'nın son sözü
  conversationTopic: string;        // Konuşmanın ana başlığı
  userInterruptedAt: number;        // Kesme zamanı
  previousKeywords: string[];       // Eski konunun anahtar kelimeleri
};

export type BargeInResult = {
  action: "continue" | "new_topic" | "command";
  prompt: string;                   // Sistem prompt'a eklenecek
  reasoning: string;                // Debug için
};

// ─────────────────────────────────────────────────────────────────
// ADIM 1: Kullanıcı girişini analiz et (MOD KOMUTU MU?)
// ─────────────────────────────────────────────────────────────────

export function analyzeUserIntent(
  input: string
): {
  type: "command" | "conversation";
  intent?: string;
  reasoning: string;
} {
  const lower = input.toLowerCase().trim();

  // Yerel komutlar (matchLocalCommand zaten var useVoice.ts'de)
  const LOCAL_COMMANDS = [
    "yaklaştır", "uzaklaştır", "sıfırla", "sus", "uyu",
    "harita", "müzik", "video", "kamera", "tarama",
    "sonraki", "önceki", "model", "proje", "dur", "bekle"
  ];

  for (const cmd of LOCAL_COMMANDS) {
    if (lower.includes(cmd)) {
      return {
        type: "command",
        intent: cmd,
        reasoning: `MOD KOMUTU tespit: "${cmd}"`
      };
    }
  }

  // Video tetikleyicileri
  const VIDEO_TRIGGERS = [
    "youtube", "izle", "videosu", "klip", "oynat"
  ];
  for (const trigger of VIDEO_TRIGGERS) {
    if (lower.includes(trigger)) {
      return {
        type: "command",
        intent: `video:${input}`,
        reasoning: `Video isteği: "${input}"`
      };
    }
  }

  // Müzik tetikleyicileri
  const MUSIC_TRIGGERS = [
    "şarkı", "müzik", "çal", "dinlet", "aç", "çalsana"
  ];
  for (const trigger of MUSIC_TRIGGERS) {
    if (lower.includes(trigger)) {
      return {
        type: "command",
        intent: `music:${input}`,
        reasoning: `Müzik isteği: "${input}"`
      };
    }
  }

  // Harita tetikleyicileri
  const MAP_TRIGGERS = ["harita", "haritada", "göster", "nerede"];
  for (const trigger of MAP_TRIGGERS) {
    if (lower.includes(trigger)) {
      return {
        type: "command",
        intent: `map:${input}`,
        reasoning: `Harita isteği: "${input}"`
      };
    }
  }

  // Değilse normal konuşma
  return {
    type: "conversation",
    reasoning: "Normal konuşma, mod komutu yok"
  };
}

// ─────────────────────────────────────────────────────────────────
// ADIM 2: Anahtar Kelimeleri Çıkar
// ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "ben", "sen", "o", "bu", "su", "şu", "bir", "ve", "veya",
  "ama", "daha", "çok", "az", "hiç", "var", "yok", "mi", "mı", "mu", "mü",
  "için", "gibi", "kadar", "iyi", "kötü", "güzel", "de", "da", "da", "dı",
  "ise", "dir", "dır", "olan", "olur", "etmek", "yapmak", "söylemek",
  "şey", "birşey", "ne", "kim", "neden", "nasıl", "nerede", "ne zaman",
  "al", "ver", "git", "gel", "dur", "kalk", "otur", "yat", "yatır"
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;:.!?]+/)
    .filter(word => {
      // 3+ karakter, stopword değil, alfanümerik
      return word.length >= 3 &&
             !STOPWORDS.has(word) &&
             /^[\p{L}\p{N}]+$/u.test(word);
    })
    .slice(0, 12);  // En başta gelen 12 kelime
}

// ─────────────────────────────────────────────────────────────────
// ADIM 3: Benzerlik Skorlama
// ─────────────────────────────────────────────────────────────────

/**
 * Levenshtein Distance — iki string'in kaç adımda benzerleştiğini hesapla
 * Örnek: "kedi" → "kedi" = 0 (aynı)
 *        "kedi" → "köpek" = 4 (tamamen farklı)
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * İki string arasında benzerlik puanı (0-1)
 * 1.0 = aynı, 0.0 = tamamen farklı
 */
function wordSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

// ─────────────────────────────────────────────────────────────────
// ADIM 3.5: Semantic Benzerlik (Ollama Embedding) — Sprint 3
// ─────────────────────────────────────────────────────────────────

/**
 * Cosine Similarity — iki vektör arasındaki açısal benzerlik
 * 1.0 = aynı yön (aynı anlam), 0.0 = ortogonal (alakasız)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Basit in-memory cache — aynı cümle tekrar embed edilmesin (TTS cümleleri sık tekrar eder)
const embeddingCache = new Map<string, number[]>();
const EMBEDDING_CACHE_MAX = 100;

async function fetchEmbedding(text: string, signal?: AbortSignal): Promise<number[] | null> {
  const key = text.trim().toLowerCase();
  if (embeddingCache.has(key)) return embeddingCache.get(key)!;

  try {
    const res = await fetch("/api/embedding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: key }),
      signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { embedding?: number[] };
    if (!data.embedding) return null;

    embeddingCache.set(key, data.embedding);
    if (embeddingCache.size > EMBEDDING_CACHE_MAX) {
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
    return data.embedding;
  } catch {
    return null; // timeout / network hatası → sessizce fallback'e düş
  }
}

/**
 * İki metin arasında semantic benzerlik hesapla.
 * ENABLE_SEMANTIC_CHECK env false ise veya embedding hatası olursa
 * score: -1 döner (çağıran taraf bunu "kullanılamaz" olarak yorumlamalı).
 */
export async function checkSemanticSimilarity(
  text1: string,
  text2: string
): Promise<{ score: number; explanation: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const [emb1, emb2] = await Promise.all([
      fetchEmbedding(text1, controller.signal),
      fetchEmbedding(text2, controller.signal),
    ]);
    clearTimeout(timeout);

    if (!emb1 || !emb2) {
      return { score: -1, explanation: "semantic_unavailable" };
    }

    const score = cosineSimilarity(emb1, emb2);
    const explanation =
      score > 0.65
        ? `Semantic: çok benzer anlam (${(score * 100).toFixed(0)}%)`
        : score > 0.45
          ? `Semantic: zayıf bağlantı (${(score * 100).toFixed(0)}%)`
          : `Semantic: ilişki yok (${(score * 100).toFixed(0)}%)`;

    return { score, explanation };
  } catch {
    clearTimeout(timeout);
    return { score: -1, explanation: "semantic_error" };
  }
}

// ─────────────────────────────────────────────────────────────────
// ADIM 4: Konu Sürekliliğini Kontrol Et (Hibrit: Keyword + Semantic)
// ─────────────────────────────────────────────────────────────────

/**
 * Semantic kontrolü ne zaman devreye girer?
 * Sadece anahtar kelime skoru "şüpheli bölgede" (0.15-0.6) ise —
 * çok net devam/çok net alakasız durumlarda embedding'e gitmeye gerek yok,
 * hem latency kazanılır hem gereksiz API çağrısı önlenir.
 */
const SEMANTIC_ZONE_MIN = 0.15;
const SEMANTIC_ZONE_MAX = 0.6;

export async function checkTopicContinuity(
  userInput: string,
  lastAssistantMessage: string,
  previousKeywords: string[],
  options: { useSemantic?: boolean } = {}
): Promise<{
  isContinuation: boolean;
  isRelated: boolean;
  relatednessScore: number;
  sharedKeywords: string[];
  reasoning: string;
  semanticScore?: number;
}> {
  const userKeywords = extractKeywords(userInput);

  // ── Anahtar kelime katmanı (her zaman çalışır, 0ms) ──────────────
  const sharedKeywords: string[] = [];
  const matches: number[] = [];

  for (const prevKeyword of previousKeywords) {
    for (const userKeyword of userKeywords) {
      const similarity = wordSimilarity(prevKeyword, userKeyword);
      if (similarity > 0.7) {
        sharedKeywords.push(prevKeyword);
        matches.push(similarity);
      }
    }
  }

  const keywordScore =
    sharedKeywords.length > 0
      ? matches.reduce((a, b) => a + b, 0) / matches.length
      : 0;

  // ── Semantic katman (opsiyonel, sadece şüpheli bölgede) ──────────
  let finalScore = keywordScore;
  let semanticScore: number | undefined;
  const useSemantic = options.useSemantic ?? false;

  if (
    useSemantic &&
    keywordScore >= SEMANTIC_ZONE_MIN &&
    keywordScore <= SEMANTIC_ZONE_MAX &&
    userInput.trim().split(/\s+/).length >= 2 // çok kısa girişlerde embedding gürültülü
  ) {
    const semanticResult = await checkSemanticSimilarity(
      lastAssistantMessage,
      userInput
    );

    if (semanticResult.score >= 0) {
      semanticScore = semanticResult.score;
      // Keyword + semantic ortalaması — ikisi de fikir belirtiyor
      finalScore = (keywordScore + semanticResult.score) / 2;
    }
    // semanticResult.score === -1 → embedding başarısız, keywordScore ile devam
  }

  // Kategorilendirme
  const isContinuation = finalScore > 0.6;
  const isRelated = finalScore > 0.35;

  const usedSemantic = semanticScore !== undefined;
  const scoreLabel = `${(finalScore * 100).toFixed(0)}%${usedSemantic ? " (keyword+semantic)" : " (keyword)"}`;

  let reasoning = "";
  if (isContinuation) {
    reasoning = `DEVAM: Ortak kelimeler (${sharedKeywords.join(", ") || "yok"}) — Skor: ${scoreLabel}`;
  } else if (isRelated) {
    reasoning = `ZAYIF BAĞLANTI: skor ${scoreLabel}. Bridge kur.`;
  } else {
    reasoning = `BAŞKA KONU: skor ${scoreLabel}. Temiz break yap.`;
  }

  return {
    isContinuation,
    isRelated,
    relatednessScore: finalScore,
    sharedKeywords,
    reasoning,
    semanticScore
  };
}

// ─────────────────────────────────────────────────────────────────
// ANA HANDLER: Intelligent Barge-In
// ─────────────────────────────────────────────────────────────────

export async function intelligentBargeInHandler(
  userInput: string,
  context: BargeInContext,
  options: { useSemantic?: boolean } = {}
): Promise<BargeInResult> {
  // 1. MOD KOMUTU MU?
  const intentAnalysis = analyzeUserIntent(userInput);

  if (intentAnalysis.type === "command") {
    return {
      action: "command",
      prompt: "",
      reasoning: `MOD KOMUTU BULUŞTU: ${intentAnalysis.reasoning}`
    };
  }

  // 2. KONU SÜREKLİLİĞİNİ KONTROL ET (keyword + şüpheli bölgede semantic)
  const continuity = await checkTopicContinuity(
    userInput,
    context.lastAssistantMessage,
    context.previousKeywords,
    options
  );

  if (continuity.isContinuation) {
    // ✅ DEVAM: Bağlam koru, kaldığı yerden devam et
    return {
      action: "continue",
      prompt: `Kullanıcı seni kesintiye uğrattı ama aynı konuyu devam ettiriyor.
Önceki konudan kaldığın yere geri dön ve doğal bir şekilde devam et.
Kesintiye maruz kalmış gibi davranma, asla "devam edelim", "ne söylüyordun" diye sorma.
Kesinti yokmuş gibi konuş.

ÖNCEKİ KONU: "${context.lastAssistantMessage}"
ORTAK KELIMELER: ${continuity.sharedKeywords.join(", ")}
KULLANICı'NIN SÖYLEDİĞİ: "${userInput}"

Kaldığın cümleyi tamamla veya doğru yön vererek devam et.`,
      reasoning: continuity.reasoning
    };
  } else if (continuity.isRelated) {
    // 🟡 ZAYIF BAĞLANTI: Bridge kur, geçiş yap
    return {
      action: "new_topic",
      prompt: `Kullanıcı konuyu hafif değiştirdi. İlişkili ama biraz farklı.
Doğal bir bridge kur, eski konudan yeni konuya geçiş yap. Zorlama hissi verme.

ÖNCEKİ KONU: "${context.lastAssistantMessage}"
YENİ KONU: "${userInput}"
ZAYIF BAĞLANTI: "${continuity.sharedKeywords.join(", ")}"

Geçişi şu şekilde yap:
- Eski konuya kısaca referans ver (1-2 kelime)
- "ama/fakat/aynı şekilde" gibi geçiş kelimesi kullan
- Yeni konuya geç

Örnek: Önceki: "İstanbul'un tarihi..." → Yeni: "Ankara?"
       Cevap: "...İstanbul'da olduğu gibi, Ankara da eski bir şehir..."`,
      reasoning: continuity.reasoning
    };
  } else {
    // ❌ TAMAMEN BAŞKA: Temiz break, saçma yok
    return {
      action: "new_topic",
      prompt: `Kullanıcı konuyu tamamen değiştirdi. İlişki yok.
Yeni konuyu direkt, temiz bir şekilde aç. Eski konuya zorlama referans verme.
Saçma bağlantı kurma, "o konuda dediklerim bununla ilişkili" diye yalanma.

ÖNCEKİ KONU: "${context.lastAssistantMessage}"
YENİ KONU: "${userInput}"

Yeni konuya direkt cevap ver. Eski konu unuttuymuş gibi davran.
Doğallık önemli: "Tamamen başka bir konuya geçiyorsunuz" diye meta-yorum yapma.`,
      reasoning: continuity.reasoning
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// YARDIMCI: Topic Extraction (konuşmadan temel konu çıkar)
// ─────────────────────────────────────────────────────────────────

export function extractConversationTopic(
  conversationHistory: Array<{ role: string; content: string }>
): string {
  if (conversationHistory.length < 2) {
    return "Genel sohbet";
  }

  // Son 4 mesajdan (2 tur) konuşma özeti al
  const recentMessages = conversationHistory
    .slice(-4)
    .map(m => m.content)
    .join(" ");

  const keywords = extractKeywords(recentMessages);

  // Anahtar kelimelerin çoğunluğu konunun adı
  return keywords.length > 0
    ? keywords.slice(0, 3).join(" / ")
    : "Bilinmeyen konu";
}

// ─────────────────────────────────────────────────────────────────
// SEMANTIC TOGGLE — .env.local: NEXT_PUBLIC_ENABLE_SEMANTIC_CHECK=true
// (useVoice.ts client-side çalıştığı için NEXT_PUBLIC_ prefix gerekli)
// ─────────────────────────────────────────────────────────────────

export function isSemanticCheckEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_SEMANTIC_CHECK === "true";
}

// ─────────────────────────────────────────────────────────────────
// EXPORT: Barge-In Context Oluşturma
// ─────────────────────────────────────────────────────────────────

export function createBargeInContext(
  lastAssistantMessage: string,
  conversationHistory: Array<{ role: string; content: string }>
): BargeInContext {
  const previousKeywords = extractKeywords(lastAssistantMessage);

  return {
    lastAssistantMessage,
    conversationTopic: extractConversationTopic(conversationHistory),
    userInterruptedAt: Date.now(),
    previousKeywords
  };
}
