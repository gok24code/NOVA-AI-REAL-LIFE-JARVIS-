import { NextRequest } from "next/server";

interface ThingHit {
  id: number;
  name: string;
  thumbnail?: string;
  public_url?: string;
  creator?: { name?: string };
  like_count?: number;
  download_count?: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return Response.json({ error: "q required" }, { status: 400 });

  const token = process.env.THINGIVERSE_API_KEY;
  if (!token) return Response.json({ error: "no_key" }, { status: 503 });

  try {
    const url = `https://api.thingiverse.com/search/${encodeURIComponent(q)}?per_page=6&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return Response.json({ error: "thingiverse_error", status: res.status }, { status: 502 });
    }
    const data = (await res.json()) as { total?: number; hits?: ThingHit[] };

    const results = (data.hits ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      thumbnail: h.thumbnail,
      publicUrl: h.public_url,
      creator: h.creator?.name,
      likeCount: h.like_count,
      downloadCount: h.download_count,
    }));

    return Response.json({ results });
  } catch (err) {
    console.error("[thingiverse] search error:", err);
    return Response.json({ error: "search_failed" }, { status: 500 });
  }
}
