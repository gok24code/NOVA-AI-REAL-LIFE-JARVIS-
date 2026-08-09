import { NextRequest } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const HUMAN_LABELS = new Set(["person"]);

const COCO_TR: Record<string, string> = {
  bicycle: "bisiklet",
  car: "araba",
  motorcycle: "motosiklet",
  airplane: "uçak",
  bus: "otobüs",
  train: "tren",
  truck: "kamyon",
  boat: "tekne",
  "traffic light": "trafik ışığı",
  "fire hydrant": "yangın musluğu",
  "stop sign": "dur işareti",
  "parking meter": "park sayacı",
  bench: "bank",
  bird: "kuş",
  cat: "kedi",
  dog: "köpek",
  horse: "at",
  sheep: "koyun",
  cow: "inek",
  elephant: "fil",
  bear: "ayı",
  zebra: "zebra",
  giraffe: "zürafa",
  backpack: "sırt çantası",
  umbrella: "şemsiye",
  handbag: "el çantası",
  tie: "kravat",
  suitcase: "bavul",
  frisbee: "frizbi",
  skis: "kayak",
  snowboard: "snowboard",
  "sports ball": "spor topu",
  kite: "uçurtma",
  "baseball bat": "beyzbol sopası",
  "baseball glove": "beyzbol eldiveni",
  skateboard: "kaykay",
  surfboard: "sörf tahtası",
  "tennis racket": "tenis raketi",
  bottle: "şişe",
  "wine glass": "şarap kadehi",
  cup: "fincan",
  fork: "çatal",
  knife: "bıçak",
  spoon: "kaşık",
  bowl: "kase",
  banana: "muz",
  apple: "elma",
  sandwich: "sandviç",
  orange: "portakal",
  broccoli: "brokoli",
  carrot: "havuç",
  "hot dog": "sosisli sandviç",
  pizza: "pizza",
  donut: "donut",
  cake: "pasta",
  chair: "sandalye",
  couch: "kanepe",
  "potted plant": "saksı bitkisi",
  bed: "yatak",
  "dining table": "yemek masası",
  toilet: "tuvalet",
  tv: "televizyon",
  laptop: "dizüstü bilgisayar",
  mouse: "fare",
  remote: "uzaktan kumanda",
  keyboard: "klavye",
  "cell phone": "cep telefonu",
  microwave: "mikrodalga",
  oven: "fırın",
  toaster: "tost makinesi",
  sink: "lavabo",
  refrigerator: "buzdolabı",
  book: "kitap",
  clock: "saat",
  vase: "vazo",
  scissors: "makas",
  "teddy bear": "oyuncak ayı",
  "hair drier": "saç kurutma makinesi",
  toothbrush: "diş fırçası",
};

function tr(label: string): string {
  return COCO_TR[label.toLowerCase()] ?? label;
}

// Module-level cache — persists across requests in the same Node.js process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _detector: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _loadingPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDetector(): Promise<any> {
  if (_detector) return _detector;
  if (_loadingPromise) return _loadingPromise;

  _loadingPromise = (async () => {
    const { pipeline } = await import("@xenova/transformers");
    _detector = await pipeline("object-detection", "Xenova/detr-resnet-50", {
      quantized: true,
    });
    return _detector;
  })();

  return _loadingPromise;
}

export async function POST(req: NextRequest) {
  const { imageBase64, mimeType, mode = "detect" } = (await req.json()) as {
    imageBase64: string;
    mimeType: string;
    mode?: "detect" | "describe";
  };

  if (!imageBase64 || !mimeType) {
    return Response.json({ error: "imageBase64 and mimeType required" }, { status: 400 });
  }

  const tmpFile = join(tmpdir(), `nova-detect-${Date.now()}.jpg`);
  try {
    const detector = await getDetector();
    await writeFile(tmpFile, Buffer.from(imageBase64, "base64"));
    const threshold = mode === "describe" ? 0.35 : 0.45;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = await detector(tmpFile, { threshold });

    if (mode === "describe") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted = [...results].sort((a: any, b: any) => b.score - a.score);
      const labels = [...new Set(sorted.slice(0, 6).map((r: { label: string }) => tr(r.label)))];

      if (labels.length === 0) {
        return Response.json({ description: "Sahnede belirgin bir nesne tespit edemedim." });
      }
      const last = labels.length > 1 ? labels.pop() : null;
      const description = last
        ? `Sahnede ${labels.join(", ")} ve ${last} görüyorum.`
        : `Sahnede ${labels[0]} görüyorum.`;
      return Response.json({ description });
    }

    // detect mode — exclude humans
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtered = results.filter((r: any) => !HUMAN_LABELS.has((r.label as string).toLowerCase()));

    if (filtered.length === 0) {
      return Response.json({ found: false, object: "", description: "" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filtered.sort((a: any, b: any) => b.score - a.score);
    const best = filtered[0] as { label: string; score: number };
    const objectName = tr(best.label);
    const extras = filtered.slice(1, 3).map((r: { label: string }) => tr(r.label));

    const description =
      extras.length > 0
        ? `${objectName} tespit edildi. Ayrıca ${extras.join(", ")} görünüyor. 3D baskıya uygun belirgin form.`
        : `${objectName} tespit edildi. Belirgin formu var, 3D baskıya uygun.`;

    return Response.json({ found: true, object: objectName, description });
  } catch (err) {
    console.error("[detect] error:", err);
    return Response.json({ error: "detection_failed", found: false }, { status: 500 });
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
