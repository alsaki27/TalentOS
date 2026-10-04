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
  return [
    "id",
    "candidate_id",
    "version",
    "created_at",
    "updated_at",
    ...CANDIDATE_OPT_STATUS_FIELDS.flatMap((field) => field.kind === "date"
      ? [field.column, field.monthYearColumn, field.notProvidedColumn]
      : [field.column]),
  ].join(", ");
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

async function candidateExists(candidateId: string): Promise<boolean> {
  return Boolean(await queryOne("SELECT id FROM candidates WHERE id = $1", [candidateId]));
}

function recordActivity(userId: string, candidateId: string, action: "created" | "updated" | "deleted"): void {
  backgroundDispatch(logActivity({
    userId,
    type: action === "deleted" ? "delete" : action === "created" ? "create" : "update",
    description: `${action === "created" ? "Added" : action === "updated" ? "Updated" : "Deleted"} candidate OPT/work authorization status`,
    entityType: "candidate_opt_status",
    entityId: candidateId,
    metadata: { candidate_id: candidateId },
  }));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    if (!(await candidateExists(params.id))) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    const row = await queryOne<DbOptStatus>(
      `SELECT ${selectColumns()} FROM candidate_opt_status WHERE candidate_id = $1`,
      [params.id],
    );
    return NextResponse.json(row ? toRecord(row) : null, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error: any) {
    console.error("[Candidate OPT Status API] Load failed:", error?.message ?? error);
    return NextResponse.json({ error: "Could not load OPT status." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = parseCandidateOptStatusData(body?.data);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    if (!(await candidateExists(params.id))) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
    const entries = candidateOptStatusDbEntries(parsed.data);
    const columns = entries.map(({ column }) => column);
    const values = entries.map(({ value }) => value);
    const placeholders = values.map((_, index) => `$${index + 2}`);
    const row = await queryOne<DbOptStatus>(
      `INSERT INTO candidate_opt_status (candidate_id, ${columns.join(", ")})
       VALUES ($1, ${placeholders.join(", ")})
       RETURNING ${selectColumns()}`,
      [params.id, ...values],
    );
    if (!row) throw new Error("The status record was not created.");
    recordActivity(context!.profile.user_id, params.id, "created");
    return NextResponse.json(toRecord(row), { status: 201 });
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "This candidate already has an OPT/work authorization record. Reload the tab to edit it." }, { status: 409 });
    }
    console.error("[Candidate OPT Status API] Create failed:", error?.message ?? error);
    return NextResponse.json({ error: "Could not create OPT status." }, { status: 500 });
  }
}
