import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import { join, basename, extname } from "path";
import { modelsDir } from "@/lib/modelsStore";

const CONTENT_TYPES: Record<string, string> = {
  ".stl": "model/stl",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "text/plain",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileName: string }> },
) {
  const { fileName } = await params;
  const safeName = basename(fileName);
  const filePath = join(modelsDir(), safeName);

  try {
    const data = await readFile(filePath);
    const ext = extname(safeName).toLowerCase();
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not_found", { status: 404 });
  }
}
