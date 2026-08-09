import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { NextRequest } from "next/server";

const execAsync = promisify(exec);

const SLICER_PATHS = [
  "C:\\Program Files\\Creality\\CrealityPrint\\CrealityPrint.exe",
  "C:\\Program Files\\CrealityPrint\\CrealityPrint.exe",
  "C:\\Program Files (x86)\\Creality\\CrealityPrint\\CrealityPrint.exe",
  "C:\\Program Files\\Creality Slicer\\CrealitySlicer.exe",
];

async function findSlicer(): Promise<string | null> {
  for (const p of SLICER_PATHS) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // not found
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { url } = (await req.json()) as { url: string };

  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  const ext = url.split(".").pop()?.split("?")[0] ?? "glb";
  const fileName = `nova_model_${Date.now()}.${ext}`;
  const filePath = path.join(os.tmpdir(), fileName);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return Response.json({ error: "download_failed" }, { status: 502 });
    }
    const buffer = await res.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(buffer));
  } catch (err) {
    console.error(err);
    return Response.json({ error: "download_error" }, { status: 500 });
  }

  const slicerPath = await findSlicer();

  if (!slicerPath) {
    return Response.json({ error: "slicer_not_found", filePath });
  }

  try {
    execAsync(`"${slicerPath}" "${filePath}"`);
    return Response.json({ success: true, filePath });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "slicer_launch_error", filePath }, { status: 500 });
  }
}
