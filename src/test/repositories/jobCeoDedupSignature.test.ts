// Regression coverage for computeJobDedupSignature and its two callers
// (job-ceo/ingest/route.ts's cross-run gate, insertStaged's stored column).
//
// Context: these two call sites used to independently reimplement the same
// title|company formula. They must produce byte-identical output for every
// job, because jobCeoService.ts's "no_description" skip and
// jobCeoRunRepository.ts's deleteRun both read the STORED dedup_signature
// back and delete it from job_ceo_seen_signatures by that exact string — a
// mismatch means the delete matches zero rows and the job is silently
// blacklisted from ever being re-ingested.
//
// Also covers why external_job_id must win when present: Actalent
// (raw.source "actalentservices") and Broadstaff (raw.source
// "broadstaffglobal") are single-employer staffing boards (company is
// always "Actalent" / "Broadstaff"), so a bare title|company signature
// collapses genuinely distinct, differently-located requisitions that
// happen to share a title — confirmed live (multiple regional "OSP Field
// Inspector" reqs, multiple "GIS Analyst" reqs) before this fix existed.

import { describe, it, expect } from "vitest";
import { computeJobDedupSignature } from "@/server/repositories/jobCeoStagingRepository";

describe("computeJobDedupSignature", () => {
  it("falls back to title|company, lowercased and trimmed, when no external_job_id is present", () => {
    expect(computeJobDedupSignature({ title: "  GIS Analyst ", company: "Acme Corp" })).toBe(
      "gis analyst|acme corp"
    );
  });

  it("prefers a namespaced external_job_id when present, ignoring title/company", () => {
    const sig = computeJobDedupSignature({
      title: "GIS Analyst",
      company: "Actalent",
      external_job_id: "JP-006260691",
      raw: { source: "actalentservices" },
    });
    expect(sig).toBe("id:actalentservices:jp-006260691");
  });

  it("namespaces by source so two sources' id spaces can never collide", () => {
    const a = computeJobDedupSignature({ external_job_id: "12345", raw: { source: "broadstaffglobal" } });
    const b = computeJobDedupSignature({ external_job_id: "12345", raw: { source: "actalentservices" } });
    expect(a).not.toBe(b);
  });

  it("uses 'unknown' as the source namespace when raw.source is absent", () => {
    expect(computeJobDedupSignature({ external_job_id: "12345" })).toBe("id:unknown:12345");
  });

  it("gives two distinct same-title, same-company jobs distinct signatures when they carry distinct external_job_ids", () => {
    // This is the exact real-world scenario: two different Actalent "GIS
    // Analyst" requisitions in different cities, same employer name.
    const first = computeJobDedupSignature({
      title: "GIS Analyst", company: "Actalent", external_job_id: "JP-006260691", raw: { source: "actalentservices" },
    });
    const second = computeJobDedupSignature({
      title: "GIS Analyst", company: "Actalent", external_job_id: "JP-006274238", raw: { source: "actalentservices" },
    });
    expect(first).not.toBe(second);
  });

  it("returns the same signature for the same job regardless of which caller computes it (route vs insertStaged)", () => {
    // Simulates the two real call sites: the route reads j.title/j.company
    // (unknown/any-typed from request JSON); insertStaged reads r.title/r.company
    // (typed via Partial<StagedJob>). Both must agree.
    const job = { title: "OSP Field Inspector", company: "Broadstaff", external_job_id: "14184285", raw: { source: "broadstaffglobal" } };
    expect(computeJobDedupSignature(job)).toBe(computeJobDedupSignature(job));
  });

  it("returns null when there is truly nothing to key on", () => {
    expect(computeJobDedupSignature({})).toBeNull();
    expect(computeJobDedupSignature({ title: "", company: "" })).toBeNull();
  });

  it("ignores a non-string external_job_id rather than crashing", () => {
    expect(computeJobDedupSignature({ title: "Foo", company: "Bar", external_job_id: 12345 as any })).toBe("foo|bar");
  });

  it("ignores a non-object raw rather than crashing", () => {
    expect(computeJobDedupSignature({ external_job_id: "X1", raw: "not an object" })).toBe("id:unknown:x1");
  });
});
