import { writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { homedir } from "os";

const TR_MAP: Record<string, string> = {
  ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u",
  Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u",
};

export function modelsDir(): string {
  return resolve(process.env.NOVA_MODELS_DIR || join(homedir(), "Desktop", "models"));
}

export function slugifyModelName(name: string): string {
  const ascii = name.replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => TR_MAP[c] ?? c);
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "model";
}

export async function saveModelBuffer(
  buffer: Buffer,
  name: string,
  ext: string,
): Promise<{ fileName: string; filePath: string }> {
  const dir = modelsDir();
  await mkdir(dir, { recursive: true });
  const cleanExt = ext.replace(/^\./, "").toLowerCase() || "stl";
  const fileName = `${slugifyModelName(name)}-${Date.now().toString(36)}.${cleanExt}`;
  const filePath = join(dir, fileName);
  await writeFile(filePath, buffer);
  return { fileName, filePath };
}
