import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from "msedge-tts";

const VOICE = "tr-TR-AhmetNeural";

const PROSODY = new ProsodyOptions();
PROSODY.pitch = "-6%";
PROSODY.rate = 0.92;
PROSODY.volume = "+15%";

export async function POST(req: NextRequest) {
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) {
    return NextResponse.json({ error: "empty text" }, { status: 400 });
  }

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(text.trim(), PROSODY);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end", resolve);
      audioStream.on("error", reject);
    });

    const audio = Buffer.concat(chunks);
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Edge TTS error:", err);
    return NextResponse.json({ error: "tts_failed" }, { status: 500 });
  }
}
