import { NextRequest } from "next/server";
import { getJobSummary, stopJob } from "@/lib/projectAgent";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = getJobSummary(jobId);
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ job });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const ok = await stopJob(jobId);
  if (!ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ success: true });
}
