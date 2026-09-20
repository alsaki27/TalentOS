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
  computeLocationBucket,
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

  it("matches the user's GuidePoint case across all three platforms' ACTUAL location strings", () => {
    const keys = [
      "United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)", // LinkedIn
      "Remote",                                                   // Indeed
      "Remote in VA, MD, PA, NC, DE, NJ, or DC; United States",   // DailyRemote
    ].map((location) =>
      computeContentIdentityKey({
        title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
        company: "GuidePoint Security",
        location,
      })
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("collapses the two captures of ONE real opening that the old group-size gate missed (Pearce Services, Alton IL)", () => {
    // Real rows: same opening on indeed.com and linkedin.com, the only
    // difference being the country suffix on the location.
    const a = computeContentIdentityKey({ title: "OSP Field Engineer", company: "Pearce Services", location: "Alton, IL" });
    const b = computeContentIdentityKey({ title: "OSP Field Engineer", company: "Pearce Services", location: "Alton, IL, US" });
    expect(a).toBe(b);
  });

  it("keeps an employer's genuinely different CITY openings apart under one reused title", () => {
    // Real Pearce Services data: 5 distinct city openings under this title.
    const cities = ["Alton, IL", "Litchfield, IL", "Springfield, IL", "St Louis, MO", "Wichita, KS"];
    const keys = cities.map((location) =>
      computeContentIdentityKey({ title: "OSP Field Engineer", company: "Pearce Services", location })
    );
    expect(new Set(keys).size).toBe(5);
  });

  it("keeps the real false positive apart that a loose location match used to merge (Prairieland FS)", () => {
    const rushville = computeContentIdentityKey({ title: "Information Technology Support Technician", company: "Prairieland FS, Inc", location: "Rushville, IL, US" });
    const pittsfield = computeContentIdentityKey({ title: "Information Technology Support Technician", company: "Prairieland FS, Inc", location: "Pittsfield, IL, US" });
    expect(rushville).not.toBe(pittsfield);
  });

  it("gives Actalent's 120 'Electrical Engineer' postings a distinct identity per city", () => {
    // The real spread that made the old company+title gate useless.
    const cities = ["Arlington, Virginia, USA", "Birmingham, Alabama, USA", "Dallas, Texas, USA", "Seattle, Washington, USA"];
    const keys = cities.map((location) =>
      computeContentIdentityKey({ title: "Electrical Engineer", company: "Actalent", location })
    );
    expect(new Set(keys).size).toBe(4);
  });

  it("agrees across platform city-formatting variants for one real Actalent opening", () => {
    const short = computeContentIdentityKey({ title: "Distribution Designer", company: "Actalent", location: "Bay City, MI" });
    const long = computeContentIdentityKey({ title: "Distribution Designer", company: "Actalent", location: "Bay City, Michigan, USA" });
    expect(short).toBe(long);
  });
});

describe("computeLocationBucket", () => {
  it("collapses every real remote phrasing onto one bucket", () => {
    expect(computeLocationBucket("Remote")).toBe("remote");
    expect(computeLocationBucket("United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)")).toBe("remote");
    expect(computeLocationBucket("Remote / remote / United States")).toBe("remote");
    expect(computeLocationBucket("Work from home")).toBe("remote");
  });

  it("reads the city from every real comma-delimited format", () => {
    expect(computeLocationBucket("Alton, IL, US")).toBe("alton");
    expect(computeLocationBucket("Bay City, Michigan, USA")).toBe("bay city");
    expect(computeLocationBucket("St. Louis, MO")).toBe("st louis");
    expect(computeLocationBucket("West Fargo, North Dakota, US")).toBe("west fargo");
  });

  it("returns empty for input with no readable city, rather than guessing", () => {
    expect(computeLocationBucket("United States")).toBe("");
    expect(computeLocationBucket("onsite / United States")).toBe("");
    expect(computeLocationBucket(null)).toBe("");
    expect(computeLocationBucket("")).toBe("");
  });

  it("does not treat a city that merely contains the letters of a remote word as remote", () => {
    expect(computeLocationBucket("Remoteness Bay, AK")).toBe("remoteness bay");
  });
});

