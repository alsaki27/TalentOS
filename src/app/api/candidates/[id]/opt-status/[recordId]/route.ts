import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import {
  CANDIDATE_OPT_STATUS_FIELDS,
  candidateOptStatusDataFromRow,
  candidateOptStatusDbEntries,
  parseCandidateOptStatusData,
  type CandidateOptStatusRecord,
} from "@/lib/candidateOptStatus";
import { logActivity } from "@/lib/activity";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { queryOne } from "@/server/db/neon";

type DbOptStatus = Record<string, any>;

function selectColumns(): string {
  const fieldColumns = CANDIDATE_OPT_STATUS_FIELDS.flatMap((field) => field.kind === "date"
    ? [field.column, field.monthYearColumn, field.notProvidedColumn]
    : [field.column]);
  return ["id", "candidate_id", "version", "created_at", "updated_at", ...fieldColumns].join(", ");
}

function toRecord(row: DbOptStatus): CandidateOptStatusRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    data: candidateOptStatusDataFromRow(row),
  };
}

function recordActivity(userId: string, candidateId: string, action: "updated" | "deleted"): void {
  backgroundDispatch(logActivity({
    userId,
    type: action === "deleted" ? "delete" : "update",
    description: `${action === "updated" ? "Updated" : "Deleted"} candidate OPT/work authorization status`,
    entityType: "candidate_opt_status",
    entityId: candidateId,
    metadata: { candidate_id: candidateId },
  }));
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; recordId: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const version = Number(body?.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    return NextResponse.json({ error: "A valid record version is required." }, { status: 400 });
  }
  const parsed = parseCandidateOptStatusData(body?.data);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const entries = candidateOptStatusDbEntries(parsed.data);
    const assignments = entries.map(({ column }, index) => `${column} = $${index + 4}`);
    const values = entries.map(({ value }) => value);
    const row = await queryOne<DbOptStatus>(
      `UPDATE candidate_opt_status
          SET ${assignments.join(", ")}, version = version + 1, updated_at = now()
        WHERE id = $1 AND candidate_id = $2 AND version = $3
        RETURNING ${selectColumns()}`,
      [params.recordId, params.id, version, ...values],
    );
    if (!row) {
      const exists = await queryOne(
        "SELECT id FROM candidate_opt_status WHERE id = $1 AND candidate_id = $2",
        [params.recordId, params.id],
      );
      return exists
        ? NextResponse.json({ error: "This record changed elsewhere. Reload it before saving to avoid overwriting another edit." }, { status: 409 })
        : NextResponse.json({ error: "OPT status record not found." }, { status: 404 });
    }
    recordActivity(context!.profile.user_id, params.id, "updated");
    return NextResponse.json(toRecord(row));
  } catch (error: any) {
    console.error("[Candidate OPT Status API] Update failed:", error?.message ?? error);
    return NextResponse.json({ error: "Could not save OPT status." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; recordId: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const deleted = await queryOne(
      "DELETE FROM candidate_opt_status WHERE id = $1 AND candidate_id = $2 RETURNING id",
      [params.recordId, params.id],
    );
    if (!deleted) return NextResponse.json({ error: "OPT status record not found." }, { status: 404 });
    recordActivity(context!.profile.user_id, params.id, "deleted");
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Candidate OPT Status API] Delete failed:", error?.message ?? error);
    return NextResponse.json({ error: "Could not delete OPT status." }, { status: 500 });
  }
}
