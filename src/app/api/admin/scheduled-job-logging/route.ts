import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { encryptSecret, fingerprintKey } from "@/server/security/secretCrypto";
import { hasScheduledLoggingSession } from "@/server/security/scheduledCandidateLoggingAuth";

export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set([
  "openai", "anthropic", "google", "openrouter", "deepseek", "glm",
  "opencode", "moonshot", "groq", "nvidia", "openai_compatible", "google_vertex_proxy",
]);

async function requireUnlockedAdmin() {
  const auth = await requireCurrentUser(["admin"]);
  if (auth.response) return { response: auth.response, userId: null };
  if (!(await hasScheduledLoggingSession(auth.context.profile.user_id))) {
    return { response: NextResponse.json({ error: "Unlock the scheduled logging page first." }, { status: 423 }), userId: null };
  }
  return { response: null, userId: auth.context.profile.user_id };
}

export async function GET() {
  const auth = await requireCurrentUser(["admin"]);
  if (auth.response) return auth.response;
  try {
    const config = await queryOne<any>(
      `SELECT id, is_enabled, (password_hash IS NOT NULL) AS password_configured,
              ai_provider, ai_model, ai_base_url, (ai_encrypted_api_key IS NOT NULL) AS has_ai_key,
              ai_key_fingerprint, match_threshold, jobs_per_run, ai_calls_per_run,
              max_applications_per_run, job_freshness_days, custom_prompt, include_inactive_candidates,
              assigned_by_user_id, application_owner_user_id, updated_at
         FROM scheduled_candidate_logging_config WHERE id = true`,
    );
    if (!config) return NextResponse.json({ error: "Feature migration is not installed." }, { status: 503 });
    const unlocked = await hasScheduledLoggingSession(auth.context.profile.user_id);
    if (!unlocked) return NextResponse.json({ locked: true, config: { password_configured: config.password_configured } });

    const [candidates, rules, members, runs, sources, decisions] = await Promise.all([
      query<any>(
        `SELECT c.id, c.name, c.status, c.pipeline_stage,
                (SELECT COUNT(*)::int FROM base_resumes br WHERE br.candidate_id = c.id AND br.status IN ('draft', 'approved')) AS approved_resume_count
           FROM candidates c
          WHERE c.status = 'active' AND c.pipeline_stage = 'applying'
          ORDER BY c.name ASC`,
      ),
      query<any>(
        `SELECT r.candidate_id, r.is_enabled, r.priority, r.preferences, r.custom_requirements
           FROM scheduled_candidate_logging_candidate_rules r
           JOIN candidates c ON c.id = r.candidate_id
          WHERE c.status = 'active' AND c.pipeline_stage = 'applying'`,
      ),
      query<any>("SELECT user_id, display_name, role FROM profiles WHERE is_active = true AND role IN ('admin','manager','application_engineer') ORDER BY display_name"),
      query<any>(
        `SELECT r.id, r.trigger_type, r.status, r.jobs_seen, r.candidate_pairs_scored, r.applications_created,
                r.skipped_count, r.failed_count, r.ai_calls, r.input_tokens, r.output_tokens,
                r.started_at, r.finished_at, r.error_message, r.config_snapshot,
                COALESCE(a.success_count, 0)::int AS ai_success_count,
                COALESCE(a.ai_failure_count, 0)::int AS ai_failure_count,
                a.avg_latency_ms
           FROM scheduled_candidate_logging_runs r
           LEFT JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE status = 'success') AS success_count,
                    COUNT(*) FILTER (WHERE status = 'failed') AS ai_failure_count,
                    ROUND(AVG(latency_ms))::int AS avg_latency_ms
               FROM scheduled_candidate_logging_ai_events WHERE run_id = r.id
           ) a ON true
          ORDER BY r.started_at DESC LIMIT 12`,
      ),
      query<any>(
        `SELECT source, COUNT(*)::int AS pending_count, MAX(ingested_at) AS latest_ingested_at
           FROM scheduled_job_ingestion_events WHERE processing_status <> 'complete'
           GROUP BY source ORDER BY source`,
      ),
      query<any>(
        `SELECT d.id, d.run_id, d.job_id, j.title AS job_title, j.company, e.source,
                d.candidate_id, c.name AS candidate_name, d.base_resume_id,
                br.name AS base_resume_name, d.deterministic_score, d.match_score,
                d.priority, d.status, d.reason, d.application_id, d.updated_at
           FROM scheduled_candidate_logging_decisions d
           JOIN jobs j ON j.id = d.job_id
           JOIN candidates c ON c.id = d.candidate_id
           JOIN scheduled_job_ingestion_events e ON e.id = d.ingestion_event_id
           LEFT JOIN base_resumes br ON br.id = d.base_resume_id
          ORDER BY d.updated_at DESC LIMIT 100`,
      ),
    ]);
    return NextResponse.json({
      locked: false,
      config,
      candidates,
      candidateRules: rules,
      teamMembers: members,
      recentRuns: runs,
      scheduledSources: sources,
      recentDecisions: decisions,
    });
  } catch (error) {
    console.error("[Scheduled candidate logging] Load failed:", error);
    return NextResponse.json({ error: "Could not load scheduled logging settings." }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireUnlockedAdmin();
  if (auth.response) return auth.response;
  const userId = auth.userId!;
  try {
    const body = await request.json();
    const provider = String(body.ai_provider ?? "");
    const model = String(body.ai_model ?? "").trim();
    const apiKey = typeof body.ai_api_key === "string" ? body.ai_api_key.trim() : "";
    const threshold = Number(body.match_threshold);
    const jobsPerRun = Number(body.jobs_per_run);
    const aiCallsPerRun = Number(body.ai_calls_per_run);
    const maxApplications = Number(body.max_applications_per_run);
    const jobFreshnessDays = Number(body.job_freshness_days);
    const isEnabled = body.is_enabled === true;
    const customPrompt = typeof body.custom_prompt === "string" ? body.custom_prompt : "";
    const baseUrl = typeof body.ai_base_url === "string" ? body.ai_base_url.trim() || null : null;
    if (Array.isArray(body.candidate_rules)) {
      if (body.candidate_rules.length > 2_000) return NextResponse.json({ error: "Too many candidate settings were submitted." }, { status: 413 });
      const candidateIds: string[] = [];
      for (const rule of body.candidate_rules) {
        if (!rule || typeof rule.candidate_id !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rule.candidate_id)) {
          return NextResponse.json({ error: "Candidate settings can only be saved for active candidates who are applying." }, { status: 400 });
        }
        candidateIds.push(rule.candidate_id);
        const preferences = rule?.preferences && typeof rule.preferences === "object" && !Array.isArray(rule.preferences) ? rule.preferences : {};
        if (JSON.stringify(preferences).length > 10_000) return NextResponse.json({ error: "A candidate preference entry is too large." }, { status: 400 });
        if (typeof rule?.custom_requirements === "string" && rule.custom_requirements.length > 3_000) {
          return NextResponse.json({ error: "Candidate custom requirements are limited to 3,000 characters." }, { status: 400 });
        }
      }
      if (new Set(candidateIds).size !== candidateIds.length) {
        return NextResponse.json({ error: "Each active applying candidate can only have one settings entry." }, { status: 400 });
      }
      if (candidateIds.length) {
        const eligible = await query<{ id: string }>(
          `SELECT id FROM candidates
            WHERE id = ANY($1::uuid[]) AND status = 'active' AND pipeline_stage = 'applying'`,
          [candidateIds],
        );
        if (eligible.length !== candidateIds.length) {
          return NextResponse.json({ error: "One or more candidates are no longer active and applying. Refresh the page before saving." }, { status: 409 });
        }
      }
    }

    // BEGIN commented out (restorable together with the matching blocks in
    // client.tsx and scheduledCandidateLoggingService.ts): this feature used
    // to require its own dedicated provider+model before it could be
    // enabled. Stage 2 now runs through the shared OpenCode pool, so no
    // per-feature provider/model is required to enable the schedule.
    // if ((provider && !VALID_PROVIDERS.has(provider)) || (isEnabled && (!provider || !model))) {
    //   return NextResponse.json({ error: "Choose a supported provider and model before enabling the schedule." }, { status: 400 });
    // }
    if (provider && !VALID_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
    }
    // END commented out
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) return NextResponse.json({ error: "Match threshold must be 0–100." }, { status: 400 });
    if (!Number.isInteger(jobsPerRun) || jobsPerRun < 1 || jobsPerRun > 100) return NextResponse.json({ error: "Jobs per run must be 1–100." }, { status: 400 });
    if (!Number.isInteger(aiCallsPerRun) || aiCallsPerRun < 1 || aiCallsPerRun > 200) return NextResponse.json({ error: "AI calls per run must be 1–200." }, { status: 400 });
    if (!Number.isInteger(maxApplications) || maxApplications < 1 || maxApplications > 100) return NextResponse.json({ error: "Applications per run must be 1–100." }, { status: 400 });
    if (!Number.isInteger(jobFreshnessDays) || jobFreshnessDays < 1 || jobFreshnessDays > 30) return NextResponse.json({ error: "Job freshness window must be 1–30 days." }, { status: 400 });
    if (customPrompt.length > 6000) return NextResponse.json({ error: "Custom prompt is limited to 6,000 characters." }, { status: 400 });

    const assignedBy = typeof body.assigned_by_user_id === "string" ? body.assigned_by_user_id : null;
    const owner = typeof body.application_owner_user_id === "string" ? body.application_owner_user_id : null;
    if (isEnabled && (!assignedBy || !owner)) return NextResponse.json({ error: "Select both an assigned-by member and an application owner." }, { status: 400 });
    for (const teamUserId of [assignedBy, owner].filter(Boolean)) {
      const member = await queryOne("SELECT user_id FROM profiles WHERE user_id = $1 AND is_active = true", [teamUserId]);
      if (!member) return NextResponse.json({ error: "Assigned-by and application-owner selections must be active team members." }, { status: 400 });
    }

    const current = await queryOne<{ ai_encrypted_api_key: string | null }>("SELECT ai_encrypted_api_key FROM scheduled_candidate_logging_config WHERE id = true");
    // BEGIN commented out (restorable, same marker as above): no per-feature
    // API key is required to enable the schedule anymore.
    // if (isEnabled && !apiKey && !current?.ai_encrypted_api_key) return NextResponse.json({ error: "Add the separate AI provider API key before enabling." }, { status: 400 });
    // END commented out
    if (apiKey.length > 6000) return NextResponse.json({ error: "API key is too long." }, { status: 400 });
    const encryptedKey = apiKey ? await encryptSecret(apiKey) : current?.ai_encrypted_api_key ?? null;
    const fingerprint = apiKey ? await fingerprintKey(apiKey) : null;
    // BEGIN commented out (restorable, same marker as above): this gate
    // fired incorrectly post-redesign because the config row still carries
    // a stale pre-redesign ai_provider value (e.g. "groq") that the UI no
    // longer edits but still round-trips in every save - with no base URL
    // ever submitted, every save failed with "requires an API base URL."
    // if (isEnabled && ["openai_compatible", "google_vertex_proxy", "groq", "openrouter"].includes(provider) && !baseUrl) {
    //   return NextResponse.json({ error: "The selected provider requires an API base URL." }, { status: 400 });
    // }
    // END commented out
    if (baseUrl) {
      let parsed: URL;
      try { parsed = new URL(baseUrl); } catch { return NextResponse.json({ error: "AI base URL must be a valid HTTPS URL." }, { status: 400 }); }
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        return NextResponse.json({ error: "AI base URL must use HTTPS (localhost is allowed for local testing)." }, { status: 400 });
      }
    }

    const configSaved = await queryOne(
      `UPDATE scheduled_candidate_logging_config
          SET is_enabled = $1, ai_provider = $2, ai_model = $3, ai_base_url = $4,
              ai_encrypted_api_key = $5, ai_key_fingerprint = COALESCE($6, ai_key_fingerprint),
              match_threshold = $7, jobs_per_run = $8, ai_calls_per_run = $9,
              max_applications_per_run = $10, job_freshness_days = $11, custom_prompt = $12,
              include_inactive_candidates = $13, assigned_by_user_id = $14,
              application_owner_user_id = $15, updated_by_user_id = $16, updated_at = NOW()
        WHERE id = true
        RETURNING id, ai_key_fingerprint, updated_at,
                  (ai_encrypted_api_key IS NOT NULL) AS has_ai_key`,
      [isEnabled, provider || null, model || null, baseUrl, encryptedKey, fingerprint,
        threshold, jobsPerRun, aiCallsPerRun, maxApplications, jobFreshnessDays,
        customPrompt, false,
        assignedBy, owner, userId],
    );
    if (!configSaved) return NextResponse.json({ error: "Settings were not saved. The feature configuration row is missing." }, { status: 500 });

    if (Array.isArray(body.candidate_rules)) {
      for (const rule of body.candidate_rules) {
        if (!rule || typeof rule.candidate_id !== "string") continue;
        const priority = ["high", "default", "low"].includes(rule.priority) ? rule.priority : "default";
        const preferences = rule.preferences && typeof rule.preferences === "object" && !Array.isArray(rule.preferences) ? rule.preferences : {};
        const customRequirements = typeof rule.custom_requirements === "string" ? rule.custom_requirements.slice(0, 3000) : "";
        await queryOne(
          `INSERT INTO scheduled_candidate_logging_candidate_rules
             (candidate_id, is_enabled, priority, preferences, custom_requirements, updated_by_user_id, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())
           ON CONFLICT (candidate_id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled,
             priority = EXCLUDED.priority, preferences = EXCLUDED.preferences,
             custom_requirements = EXCLUDED.custom_requirements,
             updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
           RETURNING candidate_id`,
          [rule.candidate_id, rule.is_enabled === true, priority, JSON.stringify(preferences), customRequirements, userId],
        );
      }
    }
    return NextResponse.json({
      ok: true,
      message: "Scheduled job logging settings saved.",
      updated_at: configSaved.updated_at,
      has_ai_key: configSaved.has_ai_key,
      ai_key_fingerprint: configSaved.ai_key_fingerprint,
    });
  } catch (error) {
    console.error("[Scheduled candidate logging] Save failed:", error);
    return NextResponse.json({ error: "Could not save settings. Check that the feature migration is installed." }, { status: 500 });
  }
}
