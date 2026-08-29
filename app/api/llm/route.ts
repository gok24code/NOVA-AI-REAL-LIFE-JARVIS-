import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.1";

function loadIdentity(): string {
  try {
    return readFileSync(join(process.cwd(), "nova_identity.md"), "utf-8");
  } catch {
    return "Sen NOVA'sın — Neural Operational Virtual Assistant.";
  }
}

function loadLessons(): string {
  try {
    return readFileSync(join(process.cwd(), "nova_lessons.md"), "utf-8").trim();
  } catch {
    return "";
  }
}

function loadProfile(): string {
  try {
    const raw = readFileSync(join(process.cwd(), "nova_profile.json"), "utf-8");
    const profile = JSON.parse(raw) as { name?: string; preferences?: string[] };
    const lines: string[] = [];
    if (profile.name) lines.push(`Kullanıcının adı: ${profile.name}.`);
    if (profile.preferences?.length) {
      lines.push(`Bilinen tercihleri:\n${profile.preferences.map((p) => `- ${p}`).join("\n")}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const { messages, context, bargeInPrompt } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    context?: string; // web arama sonuçları vs. ek bağlam
    bargeInPrompt?: string;
  };

  if (!messages?.length) {
    return new Response(JSON.stringify({ error: "messages required" }), { status: 400 });
  }

  const identity = loadIdentity();
  const profile = loadProfile();
  const lessons = loadLessons();

  const blocks = [identity, profile, lessons].filter(Boolean);
  let systemContent = blocks.join("\n\n---\n\n");

  if (bargeInPrompt) {
    systemContent += `\n\n---\n\n${bargeInPrompt}`;
  }

  if (context) {
    systemContent += `\n\n---\n\n${context}`;
  }

  const ollamaMessages = [
    { role: "system", content: systemContent },
    ...messages,
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: ollamaMessages,
        stream: true,
        // qwen3 gibi "hybrid reasoning" modeller varsayılan olarak yanıttan önce
        // gizli bir <think> bloğu üretir — bu blok num_predict bütçesini tek
        // başına tüketip hiç görünür cevap üretilmeden kesilmesine yol açabiliyor
        // (test: 150 token tamamen thinking'e gitti, content boş kaldı) ve GPU'yu
        // gereksiz yere çok daha uzun süre meşgul ediyor. Sesli asistanda anlık
        // yanıt gerektiği için kapatıyoruz. Bu alanı tanımayan modeller (llama3.1,
        // qwen2.5 vb.) için sessizce yok sayılıyor.
        think: false,
        options: {
          num_predict: 150,
          // Ollama bazı modellerde (qwen3 gibi) context'i modelin desteklediği
          // maksimuma (40960) kadar açıp KV cache'i şişiriyor, bu da 8GB VRAM'i
          // aşıp modelin kısmen CPU'ya taşmasına (yavaşlama + yüksek fan sesi)
          // yol açıyordu. Konuşma geçmişi zaten son 20 mesajla sınırlı
          // (useVoice.ts), 8192 fazlasıyla yeterli ve modeli tamamen GPU'da tutuyor.
          num_ctx: 8192,
        },
      }),
    });
  } catch {
    return new Response(JSON.stringify({ error: "ollama_unreachable" }), { status: 503 });
  }

  if (!upstream.ok) {
    return new Response(JSON.stringify({ error: "ollama_error", status: upstream.status }), {
      status: 502,
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
