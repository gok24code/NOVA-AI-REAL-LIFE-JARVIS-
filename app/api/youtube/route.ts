import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return Response.json({ error: "q required" }, { status: 400 });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "no_key" }, { status: 503 });
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=1&q=${encodeURIComponent(q)}&type=video&key=${apiKey}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      items?: { id: { videoId: string }; snippet: { title: string; thumbnails?: { default?: { url: string } } } }[];
    };
    const item = data.items?.[0];
    if (!item) return Response.json({ error: "no_results" });
    return Response.json({
      videoId: item.id.videoId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails?.default?.url ?? null,
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "api_error" }, { status: 500 });
  }
}
