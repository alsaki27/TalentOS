import { describe, it, expect } from "vitest";
import { normalizeUrlFingerprint, computeApplyLinkFingerprint } from "@/lib/jobUrlFingerprint";

describe("normalizeUrlFingerprint", () => {
  it("strips utm_* and ref tracking params", () => {
    const a = normalizeUrlFingerprint("https://example.com/job/1?utm_source=x&utm_medium=y&utm_campaign=z&ref=abc");
    const b = normalizeUrlFingerprint("https://example.com/job/1");
    expect(a).toBe(b);
  });

  it("is case-insensitive", () => {
    expect(normalizeUrlFingerprint("HTTPS://EXAMPLE.COM/Job/1")).toBe(normalizeUrlFingerprint("https://example.com/job/1"));
  });

  it("strips a www. prefix", () => {
    expect(normalizeUrlFingerprint("https://www.example.com/job/1")).toBe(normalizeUrlFingerprint("https://example.com/job/1"));
  });

  it("strips a trailing slash", () => {
    expect(normalizeUrlFingerprint("https://example.com/job/1/")).toBe(normalizeUrlFingerprint("https://example.com/job/1"));
  });

  it("treats http and https as equivalent (host+path+search only)", () => {
    expect(normalizeUrlFingerprint("http://example.com/job/1")).toBe(normalizeUrlFingerprint("https://example.com/job/1"));
  });

  it("keeps non-tracking query params that distinguish real postings (e.g. Indeed's jk=)", () => {
    const a = normalizeUrlFingerprint("https://indeed.com/viewjob?jk=aaa111");
    const b = normalizeUrlFingerprint("https://indeed.com/viewjob?jk=bbb222");
    expect(a).not.toBe(b);
  });

  it("returns different fingerprints for genuinely different postings on the same domain", () => {
    const a = normalizeUrlFingerprint("https://example.com/jobs/software-engineer-123");
    const b = normalizeUrlFingerprint("https://example.com/jobs/product-manager-456");
    expect(a).not.toBe(b);
  });

  it("returns an empty string for null/undefined/blank input", () => {
    expect(normalizeUrlFingerprint(null)).toBe("");
    expect(normalizeUrlFingerprint(undefined)).toBe("");
    expect(normalizeUrlFingerprint("   ")).toBe("");
  });

  it("falls back to a normalized raw string for an unparseable URL, without throwing", () => {
    expect(() => normalizeUrlFingerprint("not a url at all")).not.toThrow();
    expect(normalizeUrlFingerprint("not a url at all")).toBe(normalizeUrlFingerprint("NOT A URL AT ALL"));
  });
});

describe("computeApplyLinkFingerprint", () => {
  it("prefers apply_url over source_url when both are present and different", () => {
    const fp = computeApplyLinkFingerprint({ applyUrl: "https://company.com/apply/1", sourceUrl: "https://aggregator.com/listing/1" });
    expect(fp).toBe(normalizeUrlFingerprint("https://company.com/apply/1"));
  });

  it("falls back to source_url when apply_url is missing", () => {
    const fp = computeApplyLinkFingerprint({ applyUrl: null, sourceUrl: "https://aggregator.com/listing/1" });
    expect(fp).toBe(normalizeUrlFingerprint("https://aggregator.com/listing/1"));
  });

  it("falls back to source_url when apply_url is an empty string", () => {
    const fp = computeApplyLinkFingerprint({ applyUrl: "", sourceUrl: "https://aggregator.com/listing/1" });
    expect(fp).toBe(normalizeUrlFingerprint("https://aggregator.com/listing/1"));
  });

  it("returns null (never an empty string) when neither URL is present", () => {
    expect(computeApplyLinkFingerprint({})).toBeNull();
    expect(computeApplyLinkFingerprint({ applyUrl: null, sourceUrl: null })).toBeNull();
    expect(computeApplyLinkFingerprint({ applyUrl: "", sourceUrl: "" })).toBeNull();
  });
});
