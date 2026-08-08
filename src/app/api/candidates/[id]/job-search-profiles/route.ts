import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
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
  additional_rules: string;
  profile_updated_at: string | null;
};

async function activeCandidate(candidateId: string) {
  return queryOne<{ id: string }>(
    "SELECT id FROM candidates WHERE id = $1 AND status = 'active'",
    [candidateId]
  );
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
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
            COALESCE(p.additional_rules, '') AS additional_rules,
            p.updated_at AS profile_updated_at
       FROM base_resumes br
       LEFT JOIN candidate_resume_search_profiles p ON p.base_resume_id = br.id
      WHERE br.candidate_id = $1
      ORDER BY br.updated_at DESC`,
    [params.id]
  );

  return NextResponse.json({ profiles });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  if (!(await activeCandidate(params.id))) {
    return NextResponse.json({ error: "Active candidate not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const baseResumeId = typeof body.baseResumeId === "string" ? body.baseResumeId : "";
  const keywords = Array.isArray(body.keywords)
    ? Array.from(new Set(body.keywords
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => value.trim())
        .filter(Boolean)))
    : [];
  const additionalRules = typeof body.additionalRules === "string"
    ? body.additionalRules.trim()
    : "";

  if (!baseResumeId) return NextResponse.json({ error: "baseResumeId is required" }, { status: 400 });
  if (keywords.length > 100) return NextResponse.json({ error: "Maximum 100 keywords" }, { status: 400 });
  if (additionalRules.length > 4000) return NextResponse.json({ error: "Additional rules are too long" }, { status: 400 });

  const resume = await queryOne<{ id: string }>(
    "SELECT id FROM base_resumes WHERE id = $1 AND candidate_id = $2",
    [baseResumeId, params.id]
  );
  if (!resume) return NextResponse.json({ error: "Base resume not found for candidate" }, { status: 404 });

  const row = await queryOne(
    `INSERT INTO candidate_resume_search_profiles
       (candidate_id, base_resume_id, keywords, additional_rules, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (base_resume_id) DO UPDATE SET
       keywords = EXCLUDED.keywords,
       additional_rules = EXCLUDED.additional_rules,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [params.id, baseResumeId, keywords, additionalRules, context!.profile.user_id]
  );

  return NextResponse.json({ profile: row });
}
