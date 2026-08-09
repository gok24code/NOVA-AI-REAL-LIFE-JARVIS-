import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "TAVILY_API_KEY not set" }, { status: 500 });

  const { query } = (await req.json()) as { query: string };
  if (!query?.trim()) return NextResponse.json({ error: "empty query" }, { status: 400 });

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 4,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const msg = await res.text();
    return NextResponse.json({ error: msg }, { status: res.status });
  }

  const data = (await res.json()) as {
    answer?: string;
    results?: { title: string; content: string; url: string }[];
  };

  return NextResponse.json({
    answer: data.answer ?? null,
    results: (data.results ?? []).map((r) => ({
      title: r.title,
      content: r.content.slice(0, 400),
    })),
  });
}
