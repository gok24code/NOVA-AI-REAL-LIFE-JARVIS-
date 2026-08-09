import { NextResponse } from "next/server";

const WHISPER_SERVER_BASE = process.env.WHISPER_SERVER_URL
  ? process.env.WHISPER_SERVER_URL.replace(/\/inference\/?$/, "")
  : "http://127.0.0.1:8081";

export async function GET() {
  try {
    const res = await fetch(WHISPER_SERVER_BASE, { signal: AbortSignal.timeout(1500) });
    return NextResponse.json({ ok: res.ok || res.status === 404 });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
