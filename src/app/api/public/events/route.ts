import { NextRequest, NextResponse } from "next/server";
import { sendTeamsNotification, type TalentOsNotification } from "@/lib/integrations/teams";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

function normalizePayload(body: any): TalentOsNotification {
  return {
    ...body,
    event_type: body.event_type || body.type || "notification",
    external_id: body.external_id || body.id || null,
    title: body.title || body.subject || "Public API event",
    message: body.message || body.text || body.description || "A public API event was received.",
    severity: ["info", "success", "warning", "error"].includes(body.severity) ? body.severity : "info",
  };
}

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "events:read");
  if (response) return response;

  const { url, page, pageSize, from, to } = pageParams(req, { page: 1, pageSize: 50, maxPageSize: 100 });
  const source = url.searchParams.get("source") || "";
  const eventType = url.searchParams.get("event_type") || "";

  let query = supabase.from("integration_events").select("*", { count: "planned" }).order("created_at", { ascending: false });
  if (source) query = query.eq("source", source);
  if (eventType) query = query.eq("event_type", eventType);

  const { data, error, count } = await query.range(from, to);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "events:write");
  if (response) return response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "JSON body is required" }, { status: 400 });

  const payload = normalizePayload(body);
  const source = String(body.source || "public_api");
  const { data: event, error: insertError } = await supabase
    .from("integration_events")
    .insert({
      source,
      event_type: payload.event_type || "notification",
      external_id: payload.external_id || null,
      title: payload.title || null,
      message: payload.message || null,
      severity: payload.severity || "info",
      payload,
      delivery_status: "received",
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  if (body.notify_teams !== false) {
    try {
      const teams = await sendTeamsNotification(payload);
      await supabase
        .from("integration_events")
        .update({ delivery_status: teams.sent ? "sent" : "received", delivery_error: teams.skipped ? teams.reason : null })
        .eq("id", event.id);
      return NextResponse.json({ ok: true, event_id: event.id, teams }, { status: 201 });
    } catch (err: any) {
      await supabase
        .from("integration_events")
        .update({ delivery_status: "failed", delivery_error: err.message || "Teams delivery failed" })
        .eq("id", event.id);
      return NextResponse.json({ ok: true, event_id: event.id, teams: { sent: false, error: err.message } }, { status: 202 });
    }
  }

  return NextResponse.json({ ok: true, event_id: event.id }, { status: 201 });
}
