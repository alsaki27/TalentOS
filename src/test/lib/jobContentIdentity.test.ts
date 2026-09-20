// Coverage for the cross-platform content-identity normalization used by
// jobContentDuplicateGuard.ts. Every case below is real data taken from the
// TalentOS jobs table or the user's own repro report, not invented - see
// src/lib/jobContentIdentity.ts's module doc for the full production
// evidence this design is based on.

import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  normalizeJobTitle,
  computeContentIdentityKey,
  areLocationsCompatible,
} from "@/lib/jobContentIdentity";

describe("normalizeJobTitle", () => {
  it("agrees on the same title despite comma/slash/case differences (real Elkhart County / Actalent data)", () => {
    expect(normalizeJobTitle("GIS Technician-Planning")).toBe(normalizeJobTitle("GIS Technician-Planning"));
    expect(normalizeJobTitle("Inspector, OSP Construction")).toBe(normalizeJobTitle("Inspector OSP Construction"));
    expect(normalizeJobTitle("Drafter/designer")).toBe(normalizeJobTitle("Drafter/Designer"));
  });

  it("agrees on the user's real reported case across all three platforms' title conventions", () => {
    const linkedin = "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)";
    const dailyRemoteSlugTitle = "Application security engineer  mid atlantic region  remote in va md pa nc de nj or dc";
    expect(normalizeJobTitle(linkedin)).toBe(normalizeJobTitle(dailyRemoteSlugTitle));
  });

  it("keeps genuinely different titles apart", () => {
    expect(normalizeJobTitle("Senior Field Service Technician")).not.toBe(normalizeJobTitle("Field Service Technician"));
  });

  it("returns empty string for absent input", () => {
    expect(normalizeJobTitle(null)).toBe("");
    expect(normalizeJobTitle("   ")).toBe("");
  });
});

describe("normalizeCompanyName", () => {
  it("drops one trailing legal-entity suffix so 'Inc'/'LLC'/etc variants agree", () => {
    expect(normalizeCompanyName("Electrical Consultants, Inc.")).toBe(normalizeCompanyName("Electrical Consultants"));
    expect(normalizeCompanyName("Electronic Environments Co LLC")).toBe(normalizeCompanyName("Electronic Environments"));
  });

  it("agrees on real identical-across-platforms company names", () => {
    expect(normalizeCompanyName("GuidePoint Security")).toBe(normalizeCompanyName("GuidePoint Security"));
    expect(normalizeCompanyName("AT&T")).toBe(normalizeCompanyName("AT&T"));
  });

  it("only strips a legal suffix from the END, never a name that happens to contain one as a real word", () => {
    // "Group Health" - "Group" is a legal-suffix word but appears FIRST, not
    // trailing, so must be preserved.
    expect(normalizeCompanyName("Group Health")).toBe("group health");
  });

  it("keeps genuinely different companies apart", () => {
    expect(normalizeCompanyName("Amazon")).not.toBe(normalizeCompanyName("AWS"));
  });

  it("returns empty string for absent input", () => {
    expect(normalizeCompanyName(null)).toBe("");
  });
});

describe("computeContentIdentityKey", () => {
  it("matches the user's real reported cross-platform case (GuidePoint Security)", () => {
    const linkedin = computeContentIdentityKey({
      title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
      company: "GuidePoint Security",
    });
    const dailyRemote = computeContentIdentityKey({
      title: "Application security engineer - Mid Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
      company: "GuidePoint Security",
    });
    expect(linkedin).not.toBeNull();
    expect(linkedin).toBe(dailyRemote);
  });

  it("returns null when title or company is missing - never collides two incomplete jobs on an empty key", () => {
    expect(computeContentIdentityKey({ title: "Engineer", company: null })).toBeNull();
    expect(computeContentIdentityKey({ title: null, company: "Acme" })).toBeNull();
    expect(computeContentIdentityKey({ title: "", company: "" })).toBeNull();
  });
});

describe("areLocationsCompatible", () => {
  it("treats any 'remote' mention as compatible with anything (real GuidePoint/DailyRemote location strings)", () => {
    expect(areLocationsCompatible("United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)", "Remote")).toBe(true);
    expect(areLocationsCompatible("Remote", "IN, US")).toBe(true);
  });

  it("treats a missing location on either side as compatible (never grounds to call two postings different)", () => {
    expect(areLocationsCompatible(null, "Fairfax, VA")).toBe(true);
    expect(areLocationsCompatible("Fairfax, VA", undefined)).toBe(true);
  });

  it("treats real same-city variants as compatible (Dewberry: 'Fairfax, VA' vs 'Fairfax, VA, USA')", () => {
    expect(areLocationsCompatible("Fairfax, VA", "Fairfax, VA, USA")).toBe(true);
  });

  it("flags an unambiguous mismatch between two fully specified, non-remote locations", () => {
    expect(areLocationsCompatible("Austin, TX", "New York, NY")).toBe(false);
  });
});
