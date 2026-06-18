// src/app/api/integrations/crawler/stream/route.ts
// GET -> Server-Sent Events stream of live crawler activity (heartbeat changes + newly
// ingested jobs), for the /ops "live" panel. This is this app's equivalent of the team's
// Socket.IO push, built on Supabase Realtime (already included in @supabase/supabase-js,
// no new dependency) instead — the browser only ever talks to this app's own API, never
// Supabase directly, consistent with every other route in this app. The subscription
// itself runs server-side with the service-role client and is forwarded to the browser.

import { NextRequest } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let channel: ReturnType<typeof supabase.channel> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      channel = supabase
        .channel(`crawler-live-${Date.now()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "job_crawler_status" },
          (payload) => send("crawler_status", payload.new ?? payload.old),
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "jobs", filter: "source=eq.crawler" },
          (payload) => send("job_inserted", payload.new),
        )
        .subscribe();

      send("ready", { connectedAt: new Date().toISOString() });

      // SSE connections idle out behind some proxies without periodic traffic.
      heartbeatTimer = setInterval(() => {
        controller.enqueue(encoder.encode(`: keep-alive\n\n`));
      }, 25_000);
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (channel) supabase.removeChannel(channel);
    },
  });

  req.signal.addEventListener("abort", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (channel) supabase.removeChannel(channel);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
