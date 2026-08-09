import { NextRequest } from "next/server";
import { saveModelBuffer } from "@/lib/modelsStore";

export async function POST(req: NextRequest) {
  const { url, name } = (await req.json()) as { url?: string; name?: string };
  if (!url) {
    return Response.json({ error: "url required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "invalid_url" }, { status: 400 });
  }
  if (!parsed.hostname.endsWith("meshy.ai")) {
    return Response.json({ error: "untrusted_host" }, { status: 400 });
  }

  const ext = parsed.pathname.split(".").pop()?.split("?")[0]?.toLowerCase() || "stl";

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return Response.json({ error: "download_failed" }, { status: 502 });
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const { filePath } = await saveModelBuffer(buffer, name || "model", ext);

    return Response.json({ path: filePath });
  } catch (err) {
    console.error("[generate3d/save] error:", err);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }
}
