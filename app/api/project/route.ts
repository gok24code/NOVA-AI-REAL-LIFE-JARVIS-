import { NextRequest } from "next/server";
import { startProjectPlan, listJobs, type ProjectType } from "@/lib/projectAgent";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    name?: string;
    type?: ProjectType;
    description?: string;
    techPreference?: string;
    targetHardware?: string;
  };

  const name = body.name?.trim();
  const description = body.description?.trim();
  const type = body.type;

  if (!name || !description || (type !== "software" && type !== "embedded")) {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const { jobId, dir } = startProjectPlan({
      name,
      type,
      description,
      techPreference: body.techPreference?.trim() || undefined,
      targetHardware: body.targetHardware?.trim() || undefined,
    });
    return Response.json({ jobId, dir });
  } catch (err) {
    console.error("[project] start error:", err);
    return Response.json({ error: "start_failed" }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({ jobs: listJobs() });
}
