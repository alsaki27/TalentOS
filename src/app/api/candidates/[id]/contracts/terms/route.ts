import { NextRequest, NextResponse } from "next/server";
import { requireCandidateContractAccess } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { currentTerms, validRuns, type AgreementRun } from "@/lib/candidateAgreementTerms";
import { CANDIDATE_AGREEMENT_VERSION } from "@/lib/candidatePortalAgreementVersion";

export const dynamic = "force-dynamic";
type Context = { params: { id: string } };
const headers = { "Cache-Control": "no-store" };

export async function GET(_req: NextRequest, { params }: Context) {
  const { response } = await requireCandidateContractAccess();
  if (response) return response;
  const row = await queryOne<{ contract_terms_version: string | null; agreement_runs: AgreementRun[] | null }>(
    `SELECT c.contract_terms_version, t.runs AS agreement_runs FROM candidates c
     LEFT JOIN candidate_agreement_terms t ON t.candidate_id = c.id WHERE c.id = $1`, [params.id]);
  if (!row) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  const { runs, version } = currentTerms(row);
  return NextResponse.json({ runs, version }, { headers });
}

export async function PUT(req: NextRequest, { params }: Context) {
  const { response } = await requireCandidateContractAccess();
  if (response) return response;
  const body = await req.json().catch(() => null);
  if (!validRuns(body?.runs) || typeof body.version !== "string") {
    return NextResponse.json({ error: "Enter agreement terms of up to 100,000 characters." }, { status: 400 });
  }
  const version = crypto.randomUUID();
  const saved = await queryOne(
    `WITH revised AS (UPDATE candidates SET contract_terms_version = $2 WHERE id = $1
       AND NOT has_contract AND COALESCE(contract_terms_version, $3) = $4 RETURNING id)
     INSERT INTO candidate_agreement_terms(candidate_id, runs)
     SELECT id, $5::jsonb FROM revised ON CONFLICT(candidate_id) DO UPDATE SET runs = excluded.runs RETURNING candidate_id`,
    [params.id, version, CANDIDATE_AGREEMENT_VERSION, body.version, JSON.stringify(body.runs)]);
  if (!saved) return NextResponse.json({ error: "The agreement changed or was signed. Reload before editing." }, { status: 409 });
  return NextResponse.json({ version }, { headers });
}
