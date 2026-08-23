// app/api/embedding/route.ts
// ─────────────────────────────────────────────────────────────────
// NOVA Semantic Embedding Endpoint
// Model: nomic-embed-text (Ollama, ~100MB, ücretsiz, offline)
// Kullanım: intelligentBargeIn.ts → checkSemanticSimilarity()

import { NextRequest, NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const MAX_TEXT_LEN = 512;

export async function POST(req: NextRequest) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json(
      { error: "text required and non-empty" },
      { status: 400 }
    );
  }

  const truncated = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        input: truncated,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`[embedding] Ollama error: ${response.status}`);
      return NextResponse.json({ error: "embedding_failed" }, { status: 502 });
    }

    const data = (await response.json()) as { embeddings?: number[][] };

    if (!data.embeddings?.length) {
      return NextResponse.json({ error: "no_embedding_returned" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      embedding: data.embeddings[0],
      dimension: data.embeddings[0].length,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = (err as Error).name === "AbortError";
    console.error(`[embedding] ${isAbort ? "Timeout" : "Error"}:`, err);
    return NextResponse.json(
      { error: isAbort ? "embedding_timeout" : "embedding_error" },
      { status: isAbort ? 504 : 500 }
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) return NextResponse.json({ ok: false, reason: "ollama_unreachable" });

    const data = (await res.json()) as { models?: { name: string }[] };
    const hasModel = data.models?.some((m) => m.name.startsWith(EMBED_MODEL)) ?? false;

    return NextResponse.json({
      ok: hasModel,
      model: EMBED_MODEL,
      hint: hasModel ? "Model hazır" : `Model eksik — çalıştır: ollama pull ${EMBED_MODEL}`,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "ollama_unreachable" });
  }
}
