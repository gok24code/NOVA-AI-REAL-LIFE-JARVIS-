import { NextRequest } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const PROFILE_PATH = join(process.cwd(), "nova_profile.json");
const MAX_PREFERENCES = 40;

interface NovaProfile {
  name?: string;
  preferences: string[];
}

async function readProfile(): Promise<NovaProfile> {
  try {
    const raw = await readFile(PROFILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NovaProfile>;
    return { name: parsed.name, preferences: parsed.preferences ?? [] };
  } catch {
    return { preferences: [] };
  }
}

export async function GET() {
  const profile = await readProfile();
  return Response.json(profile);
}

export async function POST(req: NextRequest) {
  const { name, preference } = (await req.json()) as { name?: string; preference?: string };
  const cleanName = name?.trim();
  const cleanPreference = preference?.trim();
  if (!cleanName && !cleanPreference) {
    return Response.json({ error: "name or preference required" }, { status: 400 });
  }

  const profile = await readProfile();
  if (cleanName) profile.name = cleanName;
  if (cleanPreference && !profile.preferences.includes(cleanPreference)) {
    profile.preferences = [...profile.preferences, cleanPreference].slice(-MAX_PREFERENCES);
  }

  await writeFile(PROFILE_PATH, JSON.stringify(profile, null, 2), "utf-8");
  return Response.json(profile);
}
