import { NextResponse } from "next/server";

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

export async function GET() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return NextResponse.json({ ok: false });
    const data = (await res.json()) as { models?: { name: string }[] };
    return NextResponse.json({ ok: true, models: data.models?.map((m) => m.name) ?? [] });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
