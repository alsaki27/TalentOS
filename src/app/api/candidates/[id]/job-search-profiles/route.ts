import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

type ProfileRow = {
  id: string | null;
  candidate_id: string;
  base_resume_id: string;
  resume_name: string;
  resume_status: string;
  resume_updated_at: string;
  keywords: string[];
  keyword_states: unknown[];
  additional_rules: string;
  profile_updated_at: string | null;
  generation_status: string;
  last_generated_at: string | null;
  last_generation_model: string | null;
  last_generation_prompt_version: string | null;
  last_generation_error: string | null;
};

async function activeCandidate(candidateId: string) {
  return queryOne<{ id: string }>(
    "SELECT id FROM candidates WHERE id = $1 AND status = 'active'",
    [candidateId]
  );
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!(await activeCandidate(params.id))) {
    return NextResponse.json({ error: "Active candidate not found" }, { status: 404 });
  }

  const profiles = await query<ProfileRow>(
    `SELECT p.id,
            br.candidate_id,
            br.id AS base_resume_id,
            br.name AS resume_name,
            br.status AS resume_status,
            br.updated_at AS resume_updated_at,
            COALESCE(p.keywords, '{}') AS keywords,
            COALESCE(p.keyword_states, '[]'::jsonb) AS keyword_states,
            COALESCE(p.additional_rules, '') AS additional_rules,
            p.updated_at AS profile_updated_at,
            COALESCE(p.generation_status, 'not_generated') AS generation_status,
            p.last_generated_at,
            p.last_generation_model,
            p.last_generation_prompt_version,
            p.last_generation_error
       FROM base_resumes br
       LEFT JOIN candidate_resume_search_profiles p ON p.base_resume_id = br.id
      WHERE br.candidate_id = $1
      ORDER BY br.updated_at DESC`,
    [params.id]
  );

  return NextResponse.json({ profiles, canEdit: MASTER_DATA_MANAGER_ROLES.includes(context!.profile.role) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  if (!(await activeCandidate(params.id))) {
    return NextResponse.json({ error: "Active candidate not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const baseResumeId = typeof body.baseResumeId === "string" ? body.baseResumeId : "";
  const rawKeywords = Array.isArray(body.keywords)
    ? Array.from(new Set(body.keywords
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim())
        .filter(Boolean)))
    : [];
  const rawStates = Array.isArray(body.keywordStates) ? body.keywordStates : null;
  const keywordStates = rawStates
    ? rawStates
      .filter((value: unknown) => Boolean(value && typeof value === "object" && typeof (value as any).term === "string"))
      .map((value: any) => ({
        term: value.term.trim().slice(0, 120),
        status: value.status === "dismissed" ? "dismissed" : "active",
        category: typeof value.category === "string" ? value.category.trim().slice(0, 40) : "",
        evidence: typeof value.evidence === "string" ? value.evidence.trim().slice(0, 24) : "",
        reason: typeof value.reason === "string" ? value.reason.trim().slice(0, 240) : "",
        source: value.source === "ai" ? "ai" : "manual",
        updated_by: context!.profile.user_id,
        updated_at: new Date().toISOString(),
      }))
      .filter((value: any) => value.term.length > 1)
    : rawKeywords.map((term) => ({
      term,
      status: "active",
      source: "manual",
      updated_by: context!.profile.user_id,
      updated_at: new Date().toISOString(),
    }));
  const keywords = Array.from(new Set(keywordStates
    .filter((value: any) => value.status === "active")
    .map((value: any) => value.term))) .slice(0, 48);
  const additionalRules = typeof body.additionalRules === "string"
    ? body.additionalRules.trim()
    : "";

  if (!baseResumeId) return NextResponse.json({ error: "baseResumeId is required" }, { status: 400 });
  if (keywords.length > 48) return NextResponse.json({ error: "Maximum 48 active keywords" }, { status: 400 });
  if (additionalRules.length > 4000) return NextResponse.json({ error: "Additional rules are too long" }, { status: 400 });

  const resume = await queryOne<{ id: string }>(
    "SELECT id FROM base_resumes WHERE id = $1 AND candidate_id = $2",
    [baseResumeId, params.id]
  );
  if (!resume) return NextResponse.json({ error: "Base resume not found for candidate" }, { status: 404 });

  const row = await queryOne(
    `INSERT INTO candidate_resume_search_profiles
       (candidate_id, base_resume_id, keywords, keyword_states, additional_rules, generation_status, created_by, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'manual', $6, $6)
     ON CONFLICT (base_resume_id) DO UPDATE SET
       keywords = EXCLUDED.keywords,
       keyword_states = EXCLUDED.keyword_states,
       additional_rules = EXCLUDED.additional_rules,
       generation_status = 'manual',
       last_generation_error = NULL,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [params.id, baseResumeId, keywords, JSON.stringify(keywordStates), additionalRules, context!.profile.user_id]
  );

  return NextResponse.json({ profile: row });
}
