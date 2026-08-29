import { NextRequest } from "next/server";

interface ThingHit {
  id: number;
  name: string;
  thumbnail?: string;
  public_url?: string;
  creator?: { name?: string };
  like_count?: number;
  download_count?: number;
}

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

// Thingiverse içeriği neredeyse tamamen İngilizce — Türkçe terimle arayınca
// çoğu zaman ya hiç sonuç ya da alakasız sonuç dönüyordu. Ollama ile kısa bir
// çeviri denemesi yapıyoruz; Ollama kapalıysa/yanıt vermezse orijinal terimle
// aramaya devam ediyoruz (sessiz fallback — arama hiçbir zaman kırılmıyor).
async function translateToEnglish(q: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        think: false,
        stream: false,
        messages: [
          {
            role: "user",
            content:
              `Translate this Turkish word to the single most common English word or short phrase (max 2 words) ` +
              `used to describe this everyday object in English. Respond with ONLY the English translation, ` +
              `nothing else, no quotes, no explanation.\n\nTurkish word: ${q}`,
          },
        ],
        options: { num_predict: 20, num_ctx: 2048 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return q;
    const data = (await res.json()) as { message?: { content?: string } };
    const translated = data.message?.content?.trim().replace(/^["']|["']$/g, "");
    return translated || q;
  } catch {
    return q;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return Response.json({ error: "q required" }, { status: 400 });

  const token = process.env.THINGIVERSE_API_KEY;
  if (!token) return Response.json({ error: "no_key" }, { status: 503 });

  try {
    const translated = await translateToEnglish(q);
    const url = `https://api.thingiverse.com/search/${encodeURIComponent(translated)}?per_page=5&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return Response.json({ error: "thingiverse_error", status: res.status }, { status: 502 });
    }
    const data = (await res.json()) as { total?: number; hits?: ThingHit[] };

    const results = (data.hits ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      thumbnail: h.thumbnail,
      publicUrl: h.public_url,
      creator: h.creator?.name,
      likeCount: h.like_count,
      downloadCount: h.download_count,
    }));

    return Response.json({ results });
  } catch (err) {
    console.error("[thingiverse] search error:", err);
    return Response.json({ error: "search_failed" }, { status: 500 });
  }
}
