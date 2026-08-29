import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT, ProsodyOptions } from "msedge-tts";

const VOICE = "tr-TR-AhmetNeural";

const PROSODY = new ProsodyOptions();
PROSODY.pitch = "-6%";
PROSODY.rate = 1.38; // önceki 0.92'nin 1.5 katı
PROSODY.volume = "+15%";

// NOT: Yabancı kelimeleri <lang xml:lang="en-US"> ile İngilizce fonetikle
// okutmayı denedim (msedge-tts input'u escape etmeden SSML'e gömüyor, teorik
// olarak mümkün) ama test edince kullandığımız ücretsiz Edge TTS websocket'i
// (Azure'ın ücretli Speech SDK'sından farklı, resmi olmayan "read aloud"
// endpoint'i) bu elementi desteklemiyor — bağlantıyı senkronizasyon
// tamamlanmadan kapatıp "Stream closed before the synthesis completed"
// hatası veriyor, TTS tamamen kırılıyor. Bu yüzden geri alındı. Gerçek
// çözüm için ya ücretli Azure Speech SDK'ya geçmek (API key + maliyet)
// ya da yabancı kelimeyi ayrı bir İngilizce ses (ör. en-US-*) ile ayrı
// bir TTS isteğiyle üretip ses dosyalarını birleştirmek gerekiyor — bu
// da kelime ortasında ses karakterinin aniden değişmesi riski taşıyor.
// İkisi de bu oturumun kapsamı dışında bırakıldı, istenirse ayrı ele alınabilir.

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
