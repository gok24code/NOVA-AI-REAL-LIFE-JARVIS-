import { NextRequest } from "next/server";
import { saveModelBuffer } from "@/lib/modelsStore";

interface ThingFile {
  name: string;
  direct_url?: string;
  download_url?: string;
  url?: string;
}

export async function POST(req: NextRequest) {
  const { thingId, name } = (await req.json()) as { thingId?: number | string; name?: string };
  if (!thingId) return Response.json({ error: "thingId required" }, { status: 400 });

  const token = process.env.THINGIVERSE_API_KEY;
  if (!token) return Response.json({ error: "no_key" }, { status: 503 });

  try {
    const filesRes = await fetch(
      `https://api.thingiverse.com/things/${encodeURIComponent(String(thingId))}/files?access_token=${encodeURIComponent(token)}`,
    );
    if (!filesRes.ok) {
      return Response.json({ error: "thingiverse_files_error", status: filesRes.status }, { status: 502 });
    }
    const files = (await filesRes.json()) as ThingFile[];
    if (!Array.isArray(files) || files.length === 0) {
      return Response.json({ error: "no_files_found" }, { status: 404 });
    }

    const stlFile = files.find((f) => f.name?.toLowerCase().endsWith(".stl")) ?? files[0];
    const downloadUrl = stlFile.direct_url ?? stlFile.download_url ?? stlFile.url;
    if (!downloadUrl) {
      return Response.json({ error: "no_download_url" }, { status: 502 });
    }

    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      return Response.json({ error: "download_failed", status: fileRes.status }, { status: 502 });
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const ext = stlFile.name?.split(".").pop()?.toLowerCase() || "stl";

    const { fileName, filePath } = await saveModelBuffer(buffer, name || stlFile.name || "thingiverse-model", ext);

    const contentType =
      ext === "stl" ? "model/stl" : ext === "glb" ? "model/gltf-binary" : "application/octet-stream";

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "X-File-Name": encodeURIComponent(fileName),
        "X-File-Path": encodeURIComponent(filePath),
        "X-Source-File": encodeURIComponent(stlFile.name ?? ""),
        "X-Ext": ext,
      },
    });
  } catch (err) {
    console.error("[thingiverse] download error:", err);
    return Response.json({ error: "download_failed" }, { status: 500 });
  }
}
