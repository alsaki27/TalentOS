import { NextRequest, NextResponse } from "next/server";
import { sendTeamsNotification, type TalentOsNotification } from "@/lib/integrations/teams";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

function authorized(req: NextRequest) {
  const secret = process.env.TALENT_OS_WEBHOOK_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`
    || req.headers.get("x-talent-os-secret") === secret;
}

function normalizePayload(body: any): TalentOsNotification {
  return {
    ...body,
    event_type: body.event_type || body.type || "notification",
    external_id: body.external_id || body.id || null,
    title: body.title || body.subject || "Talent OS notification",
    message: body.message || body.text || body.description || "A Talent OS notification was received.",
    severity: ["info", "success", "warning", "error"].includes(body.severity) ? body.severity : "info",
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized webhook." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body is required." }, { status: 400 });
  }

  const payload = normalizePayload(body);

  let event: any;
  let insertError: any;

  if (isNeon()) {
    try {
      event = await queryOne(
        `INSERT INTO integration_events (source, event_type, external_id, title, message, severity, payload, delivery_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          "talent_os",
          payload.event_type || "notification",
          payload.external_id || null,
          payload.title || null,
          payload.message || null,
          payload.severity || "info",
          payload,
          "received",
        ]
      );
      insertError = event ? null : { message: "Insert failed" };
    } catch (err: any) {
      insertError = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("integration_events")
      .insert({
        source: "talent_os",
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

  try {
    const teams = await sendTeamsNotification(payload);

    if (isNeon()) {
      await execute(
        `UPDATE integration_events SET delivery_status = $1, delivery_error = $2 WHERE id = $3`,
        [teams.sent ? "sent" : "received", teams.skipped ? teams.reason : null, event.id]
      );
    } else {
      const { supabase } = await import("@/lib/supabase");
      await supabase
        .from("integration_events")
        .update({ delivery_status: teams.sent ? "sent" : "received", delivery_error: teams.skipped ? teams.reason : null })
        .eq("id", event.id);
    }

    return NextResponse.json({ ok: true, event_id: event.id, teams });
  } catch (err: any) {
    if (isNeon()) {
      await execute(
        `UPDATE integration_events SET delivery_status = $1, delivery_error = $2 WHERE id = $3`,
        ["failed", err.message || "Teams delivery failed", event.id]
      );
    } else {
      const { supabase } = await import("@/lib/supabase");
      await supabase
        .from("integration_events")
        .update({ delivery_status: "failed", delivery_error: err.message || "Teams delivery failed" })
        .eq("id", event.id);
    }

    return NextResponse.json({ ok: true, event_id: event.id, teams: { sent: false, error: err.message } }, { status: 202 });
  }
}
