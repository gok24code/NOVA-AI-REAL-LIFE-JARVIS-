import { NextRequest } from "next/server";

// Local Whisper STT — proxies to a locally-running whisper.cpp server
// (whisper-server.exe), the same pattern as /api/llm proxying to Ollama.
// See lib/speechEngine.ts for why this exists: Electron's Chromium can't
// reach Google's Web Speech backend, so voice input falls back to this
// fully-offline path. Running whisper.cpp as its own native server (instead
// of transformers.js in-process) is both much faster and far more reliable
// than doing CPU inference inside the Next.js process.
//
// Setup (one-time, on this machine): download whisper-server.exe from
// https://github.com/ggml-org/whisper.cpp/releases plus a ggml model
// (e.g. ggml-small.bin) from https://huggingface.co/ggerganov/whisper.cpp,
// then run:
//   whisper-server.exe -m ggml-small.bin --host 127.0.0.1 --port 8081 --convert

const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL ?? "http://127.0.0.1:8081/inference";

// Request body: raw bytes of a 16-bit PCM WAV file (audio/wav) built
// client-side by lib/speechEngine.ts's encodeWAV().
export async function POST(req: NextRequest) {
  try {
    const arrayBuffer = await req.arrayBuffer();
    if (arrayBuffer.byteLength < 200) {
      return Response.json({ text: "" });
    }

    const form = new FormData();
    form.append("file", new Blob([arrayBuffer], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    form.append("language", "tr");

    const res = await fetch(WHISPER_SERVER_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw new Error(`whisper_server_${res.status}`);
    }

    const data = (await res.json()) as { text?: string };
    return Response.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    console.error("[stt] whisper.cpp server unreachable or failed:", err);
    return Response.json({ error: "stt_failed", text: "" }, { status: 502 });
  }
}
