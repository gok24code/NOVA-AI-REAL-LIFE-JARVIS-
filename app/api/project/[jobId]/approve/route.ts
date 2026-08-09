import { NextRequest } from "next/server";
import { approveProjectPlan } from "@/lib/projectAgent";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const ok = approveProjectPlan(jobId);
  if (!ok) return Response.json({ error: "not_awaiting_approval" }, { status: 409 });
  return Response.json({ success: true });
}
