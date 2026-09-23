import { describe, expect, test, vi } from "vitest";

// Importing the batch helper also loads the bridge dispatch adapter. Dispatch
// is unrelated to this pure selector and needs Next.js runtime-only modules.
vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: vi.fn().mockResolvedValue(undefined),
}));

import { pickDeterministicBatchWinners } from "@/lib/jobAgentImporter";
import type { BatchBridgeCandidateRow } from "@/server/repositories/jobAgentBridgeRepository";

function candidate(
  id: string,
  actorSource: BatchBridgeCandidateRow["actor_source"],
  title: string,
  overrides: Partial<BatchBridgeCandidateRow> = {}
): BatchBridgeCandidateRow {
  return {
    id,
    run_id: `run-${id}`,
    actor_source: actorSource,
    job_title: title,
    company_name: "Acme Engineering",
    location: null,
    salary_range: null,
    salary_min: null,
    salary_max: null,
    date_posted: null,
    via_platform: actorSource,
    source_url: null,
    apply_link: null,
    is_remote: null,
    employment_type: null,
    search_query_used: null,
    role_group: null,
    role_group_label: null,
    seniority_guess: null,
    tier: "best",
    tier_reason: null,
    ai_keywords: null,
    relevance_score: 1,
    is_false_positive: false,
    dedup_hash: null,
    source_url_hash: null,
    is_duplicate: false,
    import_status: "staged",
    imported_job_id: null,
    created_at: "2026-08-06T18:00:00.000Z",
    description_text: null,
    company_website: null,
    external_job_id: null,
    country: "United States",
    industry: null,
    ...overrides,
  };
}

describe("nightly same-batch duplicate winner selection", () => {
  test("uses completeness first, then Indeed → LinkedIn → Google, independent of input order", () => {
    const rows = [
      candidate("complete-indeed", "indeed", "Completeness Engineer"),
      candidate("complete-linkedin", "linkedin", "Completeness Engineer", {
        apply_link: "https://linkedin.example/apply",
      }),
      candidate("complete-google", "google", "Completeness Engineer", {
        apply_link: "https://google.example/apply",
        source_url: "https://google.example/job",
        description_text: "Detailed job description. ".repeat(8),
      }),
      candidate("three-way-indeed", "indeed", "Tie Break Engineer"),
      candidate("three-way-linkedin", "linkedin", "Tie Break Engineer"),
      candidate("three-way-google", "google", "Tie Break Engineer"),
      candidate("two-way-linkedin", "linkedin", "Secondary Tie Engineer"),
      candidate("two-way-google", "google", "Secondary Tie Engineer"),
    ];

    const permutations = [
      rows,
      [...rows].reverse(),
      [rows[5], rows[2], rows[7], rows[0], rows[4], rows[6], rows[1], rows[3]],
    ];

    for (const input of permutations) {
      const result = pickDeterministicBatchWinners(input);
      expect(result.winners.map((row) => row.id).sort()).toEqual([
        "complete-google",
        "three-way-indeed",
        "two-way-linkedin",
      ]);
      expect([...result.duplicateIds].sort()).toEqual([
        "complete-indeed",
        "complete-linkedin",
        "three-way-google",
        "three-way-linkedin",
        "two-way-google",
      ]);
    }
  });
});
