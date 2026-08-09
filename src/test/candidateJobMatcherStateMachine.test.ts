import { readFileSync } from "fs";
import { describe, expect, test } from "vitest";

const service = readFileSync("src/server/services/candidateJobMatcherService.ts", "utf8");
const migration = readFileSync("sql/neon_fixes/067_candidate_job_matcher.sql", "utf8");
const rulesMigration = readFileSync("sql/neon_fixes/068_candidate_search_profile_rules_and_revisions.sql", "utf8");
const workflow = readFileSync(".github/workflows/scheduled-jobs.yml", "utf8");

describe("candidate matcher durable state machine contract", () => {
  test("daily runs are leased and decision writes are idempotent", () => {
    expect(migration).toContain("run_key text NOT NULL UNIQUE");
    expect(migration).toContain("UNIQUE (run_id, candidate_id, job_id)");
    expect(service).toContain("updated_at < NOW() - INTERVAL '30 minutes'");
    expect(service).toContain("processing_token = $7");
  });

  test("uses bounded bulk decision writes instead of one database call per pair", () => {
    expect(service).toContain("offset += 500");
    expect(service).toContain("jsonb_to_recordset($1::jsonb)");
    expect(service).toContain("ON CONFLICT (run_id, candidate_id, job_id) DO NOTHING");
  });

  test("AE approval cannot mark an application externally applied", () => {
    expect(migration).toContain("applications_automation_idempotency_idx");
    expect(service).toMatch(/automation_idempotency_key, applied_at\)/);
    expect(service).toMatch(/\$2, \$5, NULL/);
    expect(service).toContain("Created from an AE-approved candidate-job match");
    expect(service).toContain("triggerAiWorkflowForApplication(created.application_id, options.actorUserId, decision.base_resume_id)");
  });

  test("approved applications can safely retry a transient workflow-start failure", () => {
    expect(service).toContain('["pending", "approved"].includes(decision.review_status)');
    expect(service).toContain("triggerAiWorkflowForApplication(existing.application_id");
    expect(service).toContain("resume_generation_status = 'failed'");
  });

  test("manual workflow dispatch remains dry-run while schedule can use configured mode", () => {
    expect(workflow).toContain("github.event_name == 'schedule' && 'scheduled' || 'manual'");
    expect(workflow).toContain('X-Candidate-Match-Invocation: $INVOCATION');
  });

  test("profile history, disable state, rule audit, and active-term ceiling are durable", () => {
    expect(rulesMigration).toContain("candidate_resume_search_profile_revisions");
    expect(rulesMigration).toContain("'disabled'");
    expect(rulesMigration).toContain("candidate_job_match_rule_results");
    expect(rulesMigration).toContain("candidate_active_keyword_count(keyword_states) <= 48");
  });
});
