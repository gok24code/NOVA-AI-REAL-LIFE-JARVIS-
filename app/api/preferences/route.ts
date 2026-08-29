import { NextRequest } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

// Alan bazlı, "en son ne seçildi" hafızası (nova_lessons.md'deki serbest metin
// derslerden ayrı — burada saklanan şey davranışsal bir ders değil, düz veri:
// en son çalınan şarkı, en son gösterilen şehir vb. Sadece SON değer tutulur,
// geçmiş/sıklık takibi yapılmaz.
const PREFS_PATH = join(process.env.NOVA_DATA_DIR || process.cwd(), "nova_preferences.json");

type Prefs = Record<string, Record<string, string>>;

async function readPrefs(): Promise<Prefs> {
  try {
    const raw = await readFile(PREFS_PATH, "utf-8");
    return JSON.parse(raw) as Prefs;
  } catch {
    return {};
  }
}

export async function GET() {
  const prefs = await readPrefs();
  return Response.json(prefs);
}

export async function POST(req: NextRequest) {
  const { area, key, value } = (await req.json()) as {
    area?: string;
    key?: string;
    value?: string;
  };
  if (!area?.trim() || !key?.trim() || !value?.trim()) {
    return Response.json({ error: "area, key, value required" }, { status: 400 });
  }

  const prefs = await readPrefs();
  prefs[area] = { ...prefs[area], [key]: value.trim() };
  await writeFile(PREFS_PATH, JSON.stringify(prefs, null, 2), "utf-8");
  return Response.json(prefs);
}
