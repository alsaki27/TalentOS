// src/app/api/integrations/crawler/stream/route.ts
// GET -> Server-Sent Events stream of live crawler activity.
// Uses polling instead of Supabase Realtime (WebSockets don't work on Cloudflare Workers).

import { NextRequest } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  const createStream = () => new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      let lastStatus: any = null;
      let lastJobCount = 0;

      async function poll() {
        try {
          if (isNeon()) {
            // Poll crawler status
            const statusRows = await query(`SELECT * FROM job_crawler_status ORDER BY updated_at DESC LIMIT 1`, []);
            const currentStatus = statusRows[0] ?? null;
            if (currentStatus && JSON.stringify(currentStatus) !== JSON.stringify(lastStatus)) {
              lastStatus = currentStatus;
              send("crawler_status", currentStatus);
            }

            // Poll for new crawler jobs
            const newJobs = await query(`SELECT * FROM jobs WHERE source = 'crawler' ORDER BY created_at DESC LIMIT 10`, []);
            if (newJobs.length > lastJobCount) {
              for (const job of newJobs.slice(0, newJobs.length - lastJobCount)) {
                send("job_inserted", job);
              }
              lastJobCount = newJobs.length;
            }
          }
        } catch (e) {
          // Silently skip poll errors to keep stream alive
        }
      }

      // Initial poll
      poll();

      // Poll every 3 seconds
      pollTimer = setInterval(poll, 3000);

      send("ready", { connectedAt: new Date().toISOString() });

      // SSE keepalive
      heartbeatTimer = setInterval(() => {
        controller.enqueue(encoder.encode(`: keep-alive\n\n`));
      }, 25_000);
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (pollTimer) clearInterval(pollTimer);
    },
  });

  const stream = createStream();
  req.signal.addEventListener("abort", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (pollTimer) clearInterval(pollTimer);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}