// Coverage for the cross-platform content-duplicate guard. Every scenario
// is built from real TalentOS production data (the exact company/title
// pairs and row shapes returned by the live-data research done while
// building this feature) - see jobContentDuplicateGuard.ts and
// jobContentIdentity.ts for the full evidence and reasoning.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

import { query } from "@/server/db/neon";
import { checkContentDuplicate, checkContentDuplicatesBatch } from "@/server/services/jobContentDuplicateGuard";
import { computeContentIdentityKey } from "@/lib/jobContentIdentity";

const linkedinRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "job-linkedin-1",
  title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
  company: "GuidePoint Security",
  location: "United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
  apply_url: "https://www.linkedin.com/jobs/view/4430748287",
  source_url: null,
  source: "apify:linkedin",
  content_identity_key: computeContentIdentityKey({
    title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
    company: "GuidePoint Security",
    location: "United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
  }),
  created_at: "2026-09-10T00:00:00Z",
  apply_link_fingerprint: "linkedin:4430748287",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkContentDuplicate — the user's real reported case (GuidePoint Security)", () => {
  it("blocks nothing on the FIRST capture (nothing exists yet under this identity)", async () => {
    (query as any).mockResolvedValue([]);
    const result = await checkContentDuplicate({
      title: linkedinRow().title,
      company: "GuidePoint Security",
      location: linkedinRow().location,
    });
    expect(result.isContentDuplicate).toBe(false);
    expect(result.contentIdentityKey).not.toBeNull();
  });

  it("flags the SECOND platform's capture (Indeed) as a content duplicate of the first (LinkedIn) row", async () => {
    (query as any).mockResolvedValue([linkedinRow()]);
    const result = await checkContentDuplicate({
      title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
      company: "GuidePoint Security",
      location: "Remote",
    });
    expect(result.isContentDuplicate).toBe(true);
    if (result.isContentDuplicate) expect(result.existing.id).toBe("job-linkedin-1");
  });

  it("flags the THIRD platform's capture (DailyRemote) the same way, still pointing at the original", async () => {
    (query as any).mockResolvedValue([linkedinRow()]);
    const result = await checkContentDuplicate({
      title: "Application security engineer - Mid Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
      company: "GuidePoint Security",
      location: "Remote in VA, MD, PA, NC, DE, NJ, or DC; United States",
    });
    expect(result.isContentDuplicate).toBe(true);
    if (result.isContentDuplicate) expect(result.existing.id).toBe("job-linkedin-1");
  });
});

describe("checkContentDuplicate — real false-positive-risk data must NOT be flagged", () => {
  it("never flags Amazon's 'Innovation and Design Engineer, Worldwide Design Engineering' (9+ real distinct requisitions)", async () => {
    (query as any).mockResolvedValue([
      { id: "amz-1", title: "Innovation and Design Engineer, Worldwide Design Engineering", company: "Amazon", location: "Arlington, VA", apply_url: null, source_url: "https://www.linkedin.com/jobs/view/4404514393", source: "apify:linkedin", created_at: "2026-06-22T00:00:00Z", apply_link_fingerprint: "linkedin:4404514393" },
      { id: "amz-2", title: "Innovation and Design Engineer, Worldwide Design Engineering", company: "Amazon", location: "Arlington, VA", apply_url: null, source_url: "https://www.linkedin.com/jobs/view/4404523272", source: "apify:linkedin", created_at: "2026-06-22T00:00:00Z", apply_link_fingerprint: "linkedin:4404523272" },
      { id: "amz-3", title: "Innovation and Design Engineer, Worldwide Design Engineering", company: "Amazon", location: "Bellevue, WA", apply_url: null, source_url: "https://www.linkedin.com/jobs/view/4419996520", source: "apify:linkedin", created_at: "2026-06-22T00:00:00Z", apply_link_fingerprint: "linkedin:4419996520" },
    ]);
    const result = await checkContentDuplicate({
      title: "Innovation and Design Engineer, Worldwide Design Engineering",
      company: "Amazon",
      location: "Nashville, TN",
    });
    expect(result.isContentDuplicate).toBe(false);
  });

  it("never flags ABB's 'Senior Field Service Technician' (10 real distinct requisitions, several in the identical city)", async () => {
    (query as any).mockResolvedValue([
      { id: "abb-1", title: "Senior Field Service Technician", company: "ABB", location: "Bland, VA, USA", apply_url: "https://abb.wd3.myworkdayjobs.com/.../Senior-Field-Service-Technician_JR00032040-1", source_url: null, source: "apify:indeed", created_at: "2026-08-18T00:00:00Z", apply_link_fingerprint: "abb.wd3.myworkdayjobs.com/senior-field-service-technician_jr00032040-1" },
      { id: "abb-2", title: "Senior Field Service Technician", company: "ABB", location: "Bland, VA, USA", apply_url: "https://abb.wd3.myworkdayjobs.com/.../Senior-Field-Service-Technician_JR00032041", source_url: null, source: "apify:indeed", created_at: "2026-08-18T00:00:00Z", apply_link_fingerprint: "abb.wd3.myworkdayjobs.com/senior-field-service-technician_jr00032041" },
    ]);
    // Even a location-IDENTICAL third Bland, VA posting must not be flagged,
    // because the group already has 2 distinct real postings under this
    // title+company - the templater signal, not location, is what protects
    // this case.
    const result = await checkContentDuplicate({
      title: "Senior Field Service Technician",
      company: "ABB",
      location: "Bland, VA, USA",
    });
    expect(result.isContentDuplicate).toBe(false);
  });

  it("refuses a match when both sides are on the SAME platform - that platform's two ids are its own assertion that they differ", async () => {
    // Real case this protects: two Indeed postings for "Information Technology
    // Support Technician" @ Prairieland FS with different jk values. Location
    // mismatches are handled by the identity key itself (the query filters on
    // it), so the guard's remaining job is exactly this rule.
    (query as any).mockResolvedValue([
      linkedinRow({ id: "indeed-existing", apply_link_fingerprint: "indeed:aaaaaaaaaaaaaaaa" }),
    ]);
    const result = await checkContentDuplicate({
      title: linkedinRow().title,
      company: "GuidePoint Security",
      location: "Remote",
      fingerprint: "indeed:bbbbbbbbbbbbbbbb",
    });
    expect(result.isContentDuplicate).toBe(false);
  });

  it("still flags a match when the two sides are on DIFFERENT platforms", async () => {
    (query as any).mockResolvedValue([
      linkedinRow({ id: "li-existing", apply_link_fingerprint: "linkedin:4430748287" }),
    ]);
    const result = await checkContentDuplicate({
      title: linkedinRow().title,
      company: "GuidePoint Security",
      location: "Remote",
      fingerprint: "indeed:8763525f8fdfc1b6",
    });
    expect(result.isContentDuplicate).toBe(true);
    if (result.isContentDuplicate) expect(result.existing.id).toBe("li-existing");
  });

  it("returns not-a-duplicate without querying when title or company is missing", async () => {
    const result = await checkContentDuplicate({ title: "Engineer", company: null });
    expect(result.isContentDuplicate).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("checkContentDuplicatesBatch", () => {
  it("resolves each candidate independently against already-committed jobs, skipping the query entirely when no candidate has both title and company", async () => {
    const results = await checkContentDuplicatesBatch([{ title: "Engineer", company: null }]);
    expect(results).toEqual([{ isContentDuplicate: false, contentIdentityKey: null }]);
    expect(query).not.toHaveBeenCalled();
  });

  it("matches the batch equivalent of the GuidePoint case in one query", async () => {
    (query as any).mockResolvedValue([linkedinRow()]);
    const results = await checkContentDuplicatesBatch([
      { title: linkedinRow().title, company: "GuidePoint Security", location: "Remote" },
      { title: "Totally Unrelated Role", company: "Some Other Co", location: null },
    ]);
    expect(results[0].isContentDuplicate).toBe(true);
    expect(results[1].isContentDuplicate).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

// ── The reported bug, at the guard level. The Indeed capture arrives with
//    company "Indeed.com", so it has NO primary identity and must be resolved
//    through the title+location fallback plus description corroboration.
describe("checkContentDuplicate — fallback path for a site-name company", () => {
  const CORRUPTED_INDEED = {
    title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ or DC)",
    company: "Indeed.com",
    location: "GitLab Runners, Azure",
    url: "https://www.indeed.com/viewjob?jk=8763525f8fdfc1b6",
    fingerprint: "indeed:8763525f8fdfc1b6",
    descriptionText:
      "GuidePoint Security provides trusted cybersecurity expertise, solutions and services that help organizations make better decisions and minimize risk.",
  };
  const GOOD_LINKEDIN_ROW = {
    id: "li-row",
    title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
    company: "GuidePoint Security",
    location: "",
    apply_url: "https://www.linkedin.com/jobs/view/4430748287",
    source_url: null,
    source: "extension",
    created_at: "2026-09-20T12:28:09Z",
    apply_link_fingerprint: "linkedin:4430748287",
  };

  it("flags the corrupted Indeed capture as a duplicate of the good LinkedIn row", async () => {
    (query as any).mockResolvedValue([GOOD_LINKEDIN_ROW]);
    const result = await checkContentDuplicate(CORRUPTED_INDEED);
    expect(result.isContentDuplicate).toBe(true);
    if (result.isContentDuplicate) expect(result.existing.id).toBe("li-row");
  });

  it("refuses when the description does NOT name the matched employer - no corroboration, no match", async () => {
    (query as any).mockResolvedValue([GOOD_LINKEDIN_ROW]);
    const result = await checkContentDuplicate({
      ...CORRUPTED_INDEED,
      descriptionText: "An unrelated employer is hiring for a similar role.",
    });
    expect(result.isContentDuplicate).toBe(false);
  });

  it("refuses without a description at all, and does not even query", async () => {
    const result = await checkContentDuplicate({ ...CORRUPTED_INDEED, descriptionText: null });
    expect(result.isContentDuplicate).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("still applies the same-platform veto on the fallback path", async () => {
    (query as any).mockResolvedValue([
      { ...GOOD_LINKEDIN_ROW, id: "indeed-row", apply_link_fingerprint: "indeed:aaaaaaaaaaaaaaaa" },
    ]);
    const result = await checkContentDuplicate(CORRUPTED_INDEED);
    expect(result.isContentDuplicate).toBe(false);
  });

  it("refuses when two corroborating postings share the title+location - cannot tell which", async () => {
    (query as any).mockResolvedValue([
      GOOD_LINKEDIN_ROW,
      { ...GOOD_LINKEDIN_ROW, id: "li-row-2", apply_link_fingerprint: "linkedin:9999999999" },
    ]);
    const result = await checkContentDuplicate(CORRUPTED_INDEED);
    expect(result.isContentDuplicate).toBe(false);
  });
});
