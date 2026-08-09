import { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const apiKey = process.env.MESHY_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "MESHY_API_KEY not set" }, { status: 500 });
  }

  const { taskId } = await params;

  try {
    const res = await fetch(`https://api.meshy.ai/openapi/v2/text-to-3d/${taskId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return Response.json({ error: body }, { status: res.status });
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    console.error(err);
    return Response.json({ error: "meshy_status_error" }, { status: 500 });
  }
}
