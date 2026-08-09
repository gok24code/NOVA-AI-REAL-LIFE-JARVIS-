import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "MESHY_API_KEY not set" }, { status: 500 });
  }

  const { prompt, negative_prompt } = (await req.json()) as {
    prompt: string;
    negative_prompt?: string;
  };

  if (!prompt) {
    return Response.json({ error: "prompt required" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.meshy.ai/openapi/v2/text-to-3d", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        mode: "preview",
        prompt,
        negative_prompt: negative_prompt ?? "low quality, deformed",
        art_style: "realistic",
        topology: "quad",
        target_polycount: 30000,
        should_remesh: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return Response.json({ error: body }, { status: res.status });
    }

    const data = (await res.json()) as { result: string };
    return Response.json({ taskId: data.result });
  } catch (err) {
    console.error(err);
    return Response.json({ error: "meshy_error" }, { status: 500 });
  }
}
