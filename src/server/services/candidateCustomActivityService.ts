import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { canEditCustomActivity, canManageCustomActivity, parseCustomActivity } from "@/lib/candidateCustomActivity";
import { queryOne } from "@/server/db/neon";

type Params = { id: string; activityId?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function mutateCandidateCustomActivity(request: Request, params: Params, method: "POST" | "PATCH" | "DELETE") {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  const permitted = method === "PATCH" ? canEditCustomActivity(context?.profile) : canManageCustomActivity(context?.profile);
  if (!permitted) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  if (!uuid.test(params.id) || (method !== "POST" && !uuid.test(params.activityId || ""))) return NextResponse.json({ error: "Activity not found." }, { status: 404 });
  let body, activity;
  try {
    body = await request.json();
    if (method !== "POST" && (!Number.isSafeInteger(body?.version) || body.version < 1)) throw new Error("Reload this activity before saving.");
    if (method !== "DELETE") {
      if (body?.schedule_mode && body.schedule_mode !== "none") {
        let candidate;
        try { candidate = await queryOne<{ timezone: string | null }>("SELECT timezone FROM candidates WHERE id=$1", [params.id]); }
        catch { return NextResponse.json({ error: "Could not load the candidate timezone. Try again." }, { status: 500 }); }
        if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
        if (!candidate.timezone) throw new Error("Set the candidate’s timezone in Profile overview before adding dated activities.");
        body.time_zone = candidate.timezone;
      }
      activity = parseCustomActivity(body);
    }
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Enter valid activity details." }, { status: 400 }); }
  const actor = context!.profile;
  try {
    let row;
    if (method === "POST") {
      const values = Object.values(activity!);
      row = await queryOne(`WITH changed AS (
        INSERT INTO candidate_custom_activities(candidate_id,title,body,link,schedule_mode,start_date,end_date,starts_at,ends_at,time_zone,created_by,updated_by)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11 FROM candidates WHERE id=$1 RETURNING *
      ), audit AS (
        INSERT INTO audit_logs(actor_user_id,actor_email,action,entity_type,entity_id,metadata)
        SELECT $11,$12,'candidate_activity.created','candidate',$1,jsonb_build_object('activity_id',id,'after',to_jsonb(changed)) FROM changed
      ) SELECT * FROM changed`, [params.id, ...values, actor.user_id, actor.email]);
    } else {
      const values = method === "PATCH" ? Object.values(activity!) : [];
      const base = values.length;
      row = await queryOne(`WITH previous AS (
        SELECT * FROM candidate_custom_activities WHERE id=$${base+1} AND candidate_id=$${base+2} AND deleted_at IS NULL AND version=$${base+3} FOR UPDATE
      ), changed AS (
        UPDATE candidate_custom_activities c SET ${method === "PATCH" ? "title=$1,body=$2,link=$3,schedule_mode=$4,start_date=$5,end_date=$6,starts_at=$7,ends_at=$8,time_zone=$9," : "deleted_at=now(),"}
          updated_by=$${base+4},version=c.version+1,updated_at=now()
        FROM previous p WHERE c.id=p.id RETURNING c.*
      ), audit AS (
        INSERT INTO audit_logs(actor_user_id,actor_email,action,entity_type,entity_id,metadata)
        SELECT $${base+4},$${base+5},$${base+6},'candidate',$${base+2},
          jsonb_build_object('activity_id',c.id,'before',to_jsonb(p),'after',to_jsonb(c)) FROM changed c JOIN previous p ON p.id=c.id
      ) SELECT * FROM changed`, [...values, params.activityId, params.id, body.version, actor.user_id, actor.email,
        method === "PATCH" ? "candidate_activity.updated" : "candidate_activity.deleted"]);
    }
    if (!row) {
      const existing = method !== "POST" ? await queryOne("SELECT id FROM candidate_custom_activities WHERE id=$1 AND candidate_id=$2 AND deleted_at IS NULL", [params.activityId, params.id]) : null;
      return NextResponse.json({ error: existing ? "This activity changed elsewhere. Reload before saving." : "Candidate or activity not found." }, { status: existing ? 409 : 404 });
    }
    return NextResponse.json({ activity: row }, { status: method === "POST" ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[candidate-custom-activity] Save failed", (error as { code?: string })?.code || "unknown");
    return NextResponse.json({ error: "Could not save the activity. Try again." }, { status: 500 });
  }
}
