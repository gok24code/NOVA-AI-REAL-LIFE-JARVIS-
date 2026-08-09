import { NextRequest } from "next/server";
import { getJobEntry, type ProjectJob } from "@/lib/projectAgent";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const entry = getJobEntry(jobId);
  if (!entry) return new Response("not_found", { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      for (const line of entry.job.lines) send("line", line);

      if (entry.job.status !== "running" && entry.job.status !== "planning") {
        send("done", entry.job);
        closed = true;
        controller.close();
        return;
      }

      const onLine = (line: string) => send("line", line);
      const onDone = (job: ProjectJob) => {
        send("done", job);
        cleanup();
        closed = true;
        controller.close();
      };

      entry.emitter.on("line", onLine);
      entry.emitter.on("done", onDone);

      const heartbeat = setInterval(() => send("ping", { t: Date.now() }), 15000);

      function cleanup() {
        clearInterval(heartbeat);
        entry!.emitter.off("line", onLine);
        entry!.emitter.off("done", onDone);
      }

      req.signal.addEventListener("abort", () => {
        cleanup();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
