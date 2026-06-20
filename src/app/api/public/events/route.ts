import { NextRequest, NextResponse } from "next/server";
import { sendTeamsNotification, type TalentOsNotification } from "@/lib/integrations/teams";
import { pageParams, requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

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

  let data: any[];
  let count: number;
  let error: any;

  if (isNeon()) {
    let sql = 'SELECT * FROM integration_events WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as count FROM integration_events WHERE 1=1';
    const params: any[] = [];
    const countParams: any[] = [];
    let idx = 1;

    if (source) {
      sql += ` AND source = $${idx}`;
      countSql += ` AND source = $${idx}`;
      params.push(source);
      countParams.push(source);
      idx++;
    }
    if (eventType) {
      sql += ` AND event_type = $${idx}`;
      countSql += ` AND event_type = $${idx}`;
      params.push(eventType);
      countParams.push(eventType);
      idx++;
    }
    sql += ` ORDER BY created_at DESC OFFSET $${idx} LIMIT $${idx + 1}`;
    params.push(from, to - from + 1);

    data = await query(sql, params);
    const countRow = await queryOne<{ count: string }>(countSql, countParams);
    count = parseInt(countRow?.count ?? '0', 10);
    error = null;
  } else {
    let dbQuery = supabase.from("integration_events").select("*", { count: "planned" }).order("created_at", { ascending: false });
    if (source) dbQuery = dbQuery.eq("source", source);
    if (eventType) dbQuery = dbQuery.eq("event_type", eventType);

    const res = await dbQuery.range(from, to);
    data = res.data ?? [];
    count = res.count ?? 0;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "events:write");
  if (response) return response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "JSON body is required" }, { status: 400 });

  const payload = normalizePayload(body);
  const source = String(body.source || "public_api");

  let event: any;
  let insertError: any;

  if (isNeon()) {
    event = await queryOne(
      `INSERT INTO integration_events (source, event_type, external_id, title, message, severity, payload, delivery_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        source,
        payload.event_type || "notification",
        payload.external_id || null,
        payload.title || null,
        payload.message || null,
        payload.severity || "info",
        payload,
        "received",
      ]
    );
    insertError = event ? null : { message: 'Insert failed' };
  } else {
    const res = await supabase
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
    event = res.data;
    insertError = res.error;
  }

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  if (body.notify_teams !== false) {
    try {
      const teams = await sendTeamsNotification(payload);
      if (isNeon()) {
        await execute(
          'UPDATE integration_events SET delivery_status = $1, delivery_error = $2 WHERE id = $3',
          [teams.sent ? "sent" : "received", teams.skipped ? teams.reason : null, event.id]
        );
      } else {
        await supabase
          .from("integration_events")
          .update({ delivery_status: teams.sent ? "sent" : "received", delivery_error: teams.skipped ? teams.reason : null })
          .eq("id", event.id);
      }
      return NextResponse.json({ ok: true, event_id: event.id, teams }, { status: 201 });
    } catch (err: any) {
      if (isNeon()) {
        await execute(
          'UPDATE integration_events SET delivery_status = $1, delivery_error = $2 WHERE id = $3',
          ["failed", err.message || "Teams delivery failed", event.id]
        );
      } else {
        await supabase
          .from("integration_events")
          .update({ delivery_status: "failed", delivery_error: err.message || "Teams delivery failed" })
          .eq("id", event.id);
      }
      return NextResponse.json({ ok: true, event_id: event.id, teams: { sent: false, error: err.message } }, { status: 202 });
    }
  }

  return NextResponse.json({ ok: true, event_id: event.id }, { status: 201 });
}
