import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { sha256Hex } from "@/lib/sha256";
import { queryOne } from "@/server/db/neon";
import { MAX_BASE_RESUME_KEYWORDS, MIN_BASE_RESUME_KEYWORDS } from "@/server/services/baseResumeJobSearchKeywordService";

export async function POST(
  _request: Request,
  { params }: { params: { id: string; profileId: string } },
) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const profile = await queryOne<{
    id: string;
    candidate_id: string;
    keyword_states: unknown;
    keywords: string[];
    resume_content_hash: string | null;
    profile_version: number;
    review_status: string;
    content: unknown;
  }>(
    `SELECT p.id, p.candidate_id, p.keyword_states, p.keywords, p.resume_content_hash,
            p.profile_version, p.review_status, br.content
       FROM candidate_resume_search_profiles p
       JOIN base_resumes br ON br.id = p.base_resume_id
       JOIN candidates c ON c.id = p.candidate_id
      WHERE p.id = $1 AND p.candidate_id = $2 AND lower(c.status) = 'active'
        AND COALESCE(c.pipeline_stage, 'not_started') <> 'paused'`,
    [params.profileId, params.id],
  );
  if (!profile) return NextResponse.json({ error: "Active search profile not found." }, { status: 404 });
  if (profile.review_status === "disabled") {
    return NextResponse.json({ error: "Enable this profile before approving it for matching." }, { status: 409 });
  }

  const states = Array.isArray(profile.keyword_states) ? profile.keyword_states : [];
  const activeTerms = states.length
    ? Array.from(new Set(states
        .filter((item: any) => item && item.status !== "dismissed" && typeof item.term === "string")
        .map((item: any) => item.term.trim().toLowerCase())
        .filter(Boolean)))
    : Array.from(new Set((profile.keywords || []).map((term) => term.trim().toLowerCase()).filter(Boolean)));
  if (activeTerms.length < MIN_BASE_RESUME_KEYWORDS || activeTerms.length > MAX_BASE_RESUME_KEYWORDS) {
    return NextResponse.json({
      error: `An approved profile must contain ${MIN_BASE_RESUME_KEYWORDS}-${MAX_BASE_RESUME_KEYWORDS} active keywords.`,
      activeKeywordCount: activeTerms.length,
    }, { status: 400 });
  }

  const currentResumeHash = await sha256Hex(JSON.stringify(profile.content ?? {}));
  if (profile.resume_content_hash && profile.resume_content_hash !== currentResumeHash) {
    await queryOne(
      "UPDATE candidate_resume_search_profiles SET review_status = 'stale', updated_at = NOW() WHERE id = $1 RETURNING id",
      [profile.id],
    );
    return NextResponse.json({ error: "The base resume changed after this profile was generated. Regenerate it before approval." }, { status: 409 });
  }

  const approved = await queryOne(
    `UPDATE candidate_resume_search_profiles
        SET review_status = 'approved', approved_by = $1, approved_at = NOW(),
            approved_profile_version = profile_version, resume_content_hash = $2,
            updated_at = NOW()
      WHERE id = $3 AND profile_version = $4
      RETURNING *`,
    [context!.profile.user_id, currentResumeHash, profile.id, profile.profile_version],
  );
  if (!approved) return NextResponse.json({ error: "The profile changed during approval. Review the latest version and try again." }, { status: 409 });
  return NextResponse.json({ profile: approved });
}
