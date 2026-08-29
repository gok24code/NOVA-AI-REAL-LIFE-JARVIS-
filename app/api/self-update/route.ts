import { NextRequest } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const LESSONS_PATH = join(process.env.NOVA_DATA_DIR || process.cwd(), "nova_lessons.md");
const MAX_LESSONS = 60;

async function readLessons(): Promise<string[]> {
  try {
    const raw = await readFile(LESSONS_PATH, "utf-8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "));
  } catch {
    return [];
  }
}

export async function GET() {
  const lessons = await readLessons();
  return Response.json({ lessons: lessons.map((l) => l.slice(2)) });
}

export async function POST(req: NextRequest) {
  const { lesson } = (await req.json()) as { lesson?: string };
  const clean = lesson?.trim();
  if (!clean) return Response.json({ error: "lesson required" }, { status: 400 });

  const existing = await readLessons();
  const updated = [...existing, `- ${clean}`].slice(-MAX_LESSONS);
  await writeFile(
    LESSONS_PATH,
    `# NOVA — Öğrenilen Notlar (self-update)\n\n${updated.join("\n")}\n`,
    "utf-8",
  );
  return Response.json({ ok: true, count: updated.length });
}
