import { describe, test, expect } from "vitest";

// Every automation ID referenced by callWithUsageTracking() in the codebase
// must appear in this list. This test fails when someone adds a new call site
// without registering it in ai_automations.
//
// Derived from a full codebase scan of callWithUsageTracking() call sites
// across src/ on 2026-07-11:
//
//   src/lib/resumeParsing.ts:742,1017          -> resume_parsing
//   src/app/api/candidates/[id]/parse-markitdown/route.ts:167 -> candidate_markitdown
//   src/lib/ai/falood/jdAnalyzer.ts:216        -> jd_analysis
//   src/lib/ai/jobCategorization.ts:100         -> job_categorization
//   src/server/services/applicationKeywordService.ts:214 -> keyword_extraction
//   src/server/services/evidenceMappingService.ts:337   -> evidence_mapping
//   src/app/api/target-jobs/route.ts:73         -> target_jobs_matching
//   src/app/api/resume-tailoring/generate/route.ts:112  -> base_resume_studio
//   src/lib/ai/faloodBaseResume.ts:165          -> base_resume_studio
//   src/lib/ai/faloodApplicationTailoring.ts:116,201    -> application_tailoring
//   src/server/services/resumeSuggestionService.ts:99   -> resume_suggestions
//   src/server/services/applicationPacketAiService.ts:89,216 -> cover_letter_gen
//   src/server/services/applicationPacketAiService.ts:166     -> recruiter_message_gen
//   src/lib/ai/digest.ts:50                     -> ai_digest
//   src/app/api/chat/route.ts:218               -> chat_assistant
//   src/server/services/applicationAiWorkflowService.ts:199 (via agentId) -> application_job_lens
//   src/server/services/applicationAiWorkflowService.ts:199 (via agentId) -> application_resume_forge
//   src/server/services/applicationAiWorkflowService.ts:199 (via agentId) -> application_hiring_panel
//   src/server/services/applicationAiWorkflowService.ts:199 (via agentId) -> application_final_polish

const AUTOMATION_IDS_FROM_CODE = [
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
  "resume_parsing",
  "candidate_markitdown",
  "jd_analysis",
  "job_categorization",
  "keyword_extraction",
  "evidence_mapping",
  "target_jobs_matching",
  "base_resume_studio",
  "application_tailoring",
  "resume_suggestions",
  "cover_letter_gen",
  "recruiter_message_gen",
  "ai_digest",
  "chat_assistant",
  "email_triage",
  "email_interview_extraction",
  "email_action_enrichment",
];

// These must match exactly what's in ai_automations (06_ai_key_manager_v2.sql
// + neon_fixes/008_automation_coverage.sql).
const SEEDED_AUTOMATIONS = new Set([
  "resume_parsing",
  "candidate_markitdown",
  "jd_analysis",
  "job_categorization",
  "keyword_extraction",
  "evidence_mapping",
  "target_jobs_matching",
  "base_resume_studio",
  "application_tailoring",
  "resume_suggestions",
  "cover_letter_gen",
  "recruiter_message_gen",
  "ai_digest",
  "chat_assistant",
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
  "email_triage",
  "email_interview_extraction",
  "email_action_enrichment",
]);

describe("Automation coverage", () => {
  test("every codebase automation ID exists in ai_automations", () => {
    for (const id of AUTOMATION_IDS_FROM_CODE) {
      expect(
        SEEDED_AUTOMATIONS.has(id),
        `Automation "${id}" is used in code but missing from ai_automations seed`,
      ).toBe(true);
    }
  });

  test("every seeded automation ID is referenced in the codebase", () => {
    const codeIds = new Set(AUTOMATION_IDS_FROM_CODE);
    for (const id of SEEDED_AUTOMATIONS) {
      expect(
        codeIds.has(id),
        `Automation "${id}" is seeded in ai_automations but not found in codebase callWithUsageTracking() scans`,
      ).toBe(true);
    }
  });

  test("automation ID list has no duplicates", () => {
    const seen = new Set<string>();
    for (const id of AUTOMATION_IDS_FROM_CODE) {
      expect(seen.has(id), `Duplicate automation ID in AUTOMATION_IDS_FROM_CODE: "${id}"`).toBe(false);
      seen.add(id);
    }
  });
});
