// Coverage for the content-identity normalization behind cross-platform
// duplicate detection. Every fixture below is real data - taken from the
// TalentOS jobs table or from the reported repro - not invented. See
// src/lib/jobContentIdentity.ts for the measurement each rule came from.

import { describe, it, expect } from "vitest";
import {
  normalizeCompanyName,
  normalizeJobTitle,
  computeContentIdentityKey,
  computeLocationBucket,
  computeTitleLocationKey,
  isSiteNameNotEmployer,
  companyNameAppearsInText,
} from "@/lib/jobContentIdentity";

// The two rows the extension actually wrote for ONE GuidePoint Security posting.
// The Indeed capture arrived with the SITE as the employer and a fragment of the
// description's CI/CD tool list as the location; the LinkedIn capture was correct
// but had no location at all. This is the reported bug, verbatim.
const REAL_LINKEDIN_CAPTURE = {
  title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
  company: "GuidePoint Security",
  location: "",
  url: "https://www.linkedin.com/jobs/view/application-security-engineer-mid-atlantic-region-remote-in-va-md-pa-nc-de-nj-or-dc-at-guidepoint-security-4430748287/",
};
const REAL_INDEED_CAPTURE = {
  title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ or DC)",
  company: "Indeed.com",
  location: "GitLab Runners, Azure",
  url: "https://www.indeed.com/viewjob?jk=8763525f8fdfc1b6&utm_source=chatgpt.com",
  signals: ["h1", "og:site_name", "heuristic:block"],
};

describe("normalizeJobTitle", () => {
  it("agrees despite comma/slash/case differences (real Elkhart County / Actalent rows)", () => {
    expect(normalizeJobTitle("Inspector, OSP Construction")).toBe(normalizeJobTitle("Inspector OSP Construction"));
    expect(normalizeJobTitle("Drafter/designer")).toBe(normalizeJobTitle("Drafter/Designer"));
  });

  it("agrees on the repro's two titles, which differ only by one comma", () => {
    expect(normalizeJobTitle(REAL_INDEED_CAPTURE.title)).toBe(normalizeJobTitle(REAL_LINKEDIN_CAPTURE.title));
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
  it("drops one trailing legal-entity suffix so Inc/LLC variants agree", () => {
    expect(normalizeCompanyName("Electrical Consultants, Inc.")).toBe(normalizeCompanyName("Electrical Consultants"));
    expect(normalizeCompanyName("Electronic Environments Co LLC")).toBe(normalizeCompanyName("Electronic Environments"));
  });

  it("only strips a suffix from the END, never a real word that happens to be one", () => {
    expect(normalizeCompanyName("Group Health")).toBe("group health");
  });

  it("keeps genuinely different companies apart", () => {
    expect(normalizeCompanyName("Amazon")).not.toBe(normalizeCompanyName("AWS"));
  });

  it("returns empty string for absent input", () => {
    expect(normalizeCompanyName(null)).toBe("");
  });
});

describe("isSiteNameNotEmployer", () => {
  it("flags the real corrupted capture from the extension's provenance signals alone", () => {
    expect(isSiteNameNotEmployer("Indeed.com", null, REAL_INDEED_CAPTURE.signals)).toBe(true);
    expect(isSiteNameNotEmployer("Anything At All", null, ["title:last"])).toBe(true);
  });

  it("flags a company value that IS the domain, from the url alone and with no signals", () => {
    expect(isSiteNameNotEmployer("Indeed.com", REAL_INDEED_CAPTURE.url)).toBe(true);
    expect(isSiteNameNotEmployer("indeed.com", "https://www.indeed.com/viewjob?jk=abc")).toBe(true);
  });

  it("catches a TLD-less site name through signals, which is the only place it can come from", () => {
    // "HiringCafe" / "ZipRecruiter" only ever arise from the extension's
    // og:site_name or title:last fallbacks, and those report themselves.
    expect(isSiteNameNotEmployer("HiringCafe", "https://hiringcafe.com/job/x", ["og:site_name"])).toBe(true);
    expect(isSiteNameNotEmployer("ZipRecruiter", "https://www.ziprecruiter.com/jobs-search?search=osp", ["og:site_name"])).toBe(true);
  });

  it("does NOT reject a real employer captured from its own careers domain", () => {
    // The brand label matching the host is the expected, correct case here - it is
    // the best confirmation available, not a corruption. Rejecting it would strip
    // the identity from every job imported from a company's own site or ATS.
    expect(isSiteNameNotEmployer("Acme", "https://careers.acme.com/jobs/884213")).toBe(false);
    expect(isSiteNameNotEmployer("Actalent", "https://careers.actalentservices.com/us/en/job/123")).toBe(false);
    expect(isSiteNameNotEmployer("Pearce Services", "https://job-boards.greenhouse.io/pearceservices/jobs/1")).toBe(false);
  });

  it("leaves a real employer alone, including on those same platforms", () => {
    expect(isSiteNameNotEmployer("GuidePoint Security", REAL_LINKEDIN_CAPTURE.url)).toBe(false);
    expect(isSiteNameNotEmployer("Cerris Systems", "https://www.linkedin.com/jobs/view/123456789")).toBe(false);
    expect(isSiteNameNotEmployer("DataOne Systems", "https://www.indeed.com/viewjob?jk=abc")).toBe(false);
  });

  it("does not let a trustworthy signal override a site-name match", () => {
    // Provenance claims the company came from JSON-LD, but the value is still the
    // site's own name - the url check has to catch it anyway.
    expect(isSiteNameNotEmployer("Indeed.com", REAL_INDEED_CAPTURE.url, ["ld:hiringOrganization"])).toBe(true);
  });

  it("is safe with missing or unparseable input", () => {
    expect(isSiteNameNotEmployer(null, "https://indeed.com/x")).toBe(false);
    expect(isSiteNameNotEmployer("Indeed.com", null)).toBe(false);
    expect(isSiteNameNotEmployer("Indeed.com", "not a url")).toBe(false);
  });
});

describe("computeLocationBucket", () => {
  it("rejects the real junk locations the extension produced", () => {
    expect(computeLocationBucket("GitLab Runners, Azure")).toBe("");
    expect(computeLocationBucket("GIS, Mapping")).toBe("");
  });

  it("reads the city from every real format, because a real region follows it", () => {
    expect(computeLocationBucket("Alton, IL, US")).toBe("alton");
    expect(computeLocationBucket("Bay City, Michigan, USA")).toBe("bay city");
    expect(computeLocationBucket("Danvers, MA, US")).toBe("danvers");
    expect(computeLocationBucket("St. Louis, MO")).toBe("st louis");
  });

  it("collapses every real remote phrasing onto one bucket", () => {
    expect(computeLocationBucket("Remote")).toBe("remote");
    expect(computeLocationBucket("United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)")).toBe("remote");
    expect(computeLocationBucket("Remote / remote / United States")).toBe("remote");
  });

  it("takes remoteness from the title or the explicit flag when the location is junk or empty", () => {
    expect(computeLocationBucket(REAL_INDEED_CAPTURE.location, REAL_INDEED_CAPTURE.title)).toBe("remote");
    expect(computeLocationBucket(REAL_LINKEDIN_CAPTURE.location, REAL_LINKEDIN_CAPTURE.title)).toBe("remote");
    expect(computeLocationBucket("GIS, Mapping", "Data Analyst", true)).toBe("remote");
  });

  it("returns empty rather than guessing when nothing is trustworthy", () => {
    expect(computeLocationBucket("United States")).toBe("");
    expect(computeLocationBucket("onsite / United States")).toBe("");
    expect(computeLocationBucket(null)).toBe("");
  });

  it("does not treat a city merely containing a remote word as remote", () => {
    expect(computeLocationBucket("Remoteness Bay, AK")).toBe("remoteness bay");
  });
});

describe("computeContentIdentityKey", () => {
  it("refuses to build an identity from a site name, so the corrupted row claims no bogus employer", () => {
    expect(computeContentIdentityKey(REAL_INDEED_CAPTURE)).toBeNull();
    expect(computeContentIdentityKey(REAL_LINKEDIN_CAPTURE)).not.toBeNull();
  });

  it("matches the repro across all three platforms' ACTUAL location strings", () => {
    const keys = [
      "United States (Remote in VA, MD, PA, NC, DE, NJ, or DC)", // LinkedIn
      "Remote", // Indeed
      "Remote in VA, MD, PA, NC, DE, NJ, or DC; United States", // DailyRemote
    ].map((location) =>
      computeContentIdentityKey({ title: REAL_LINKEDIN_CAPTURE.title, company: "GuidePoint Security", location })
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("merges the two captures of ONE opening that the old group-size gate missed (Pearce, Alton IL)", () => {
    const a = computeContentIdentityKey({ title: "OSP Field Engineer", company: "Pearce Services", location: "Alton, IL" });
    const b = computeContentIdentityKey({ title: "OSP Field Engineer", company: "Pearce Services", location: "Alton, IL, US" });
    expect(a).toBe(b);
  });

  it("keeps an employer's distinct CITY openings apart under one reused title (real Pearce spread)", () => {
    const keys = ["Alton, IL", "Litchfield, IL", "Springfield, IL", "St Louis, MO", "Wichita, KS"].map((location) =>
      computeContentIdentityKey({ title: "OSP Field Engineer", company: "Pearce Services", location })
    );
    expect(new Set(keys).size).toBe(5);
  });

  it("gives Actalent's 120 'Electrical Engineer' rows one identity per city", () => {
    const keys = ["Arlington, Virginia, USA", "Birmingham, Alabama, USA", "Dallas, Texas, USA", "Seattle, Washington, USA"].map(
      (location) => computeContentIdentityKey({ title: "Electrical Engineer", company: "Actalent", location })
    );
    expect(new Set(keys).size).toBe(4);
  });

  it("agrees across platform city-format variants for one real Actalent opening", () => {
    expect(computeContentIdentityKey({ title: "Distribution Designer", company: "Actalent", location: "Bay City, MI" })).toBe(
      computeContentIdentityKey({ title: "Distribution Designer", company: "Actalent", location: "Bay City, Michigan, USA" })
    );
  });

  it("keeps apart the real false positive a loose location match used to merge (Prairieland FS)", () => {
    const rushville = computeContentIdentityKey({
      title: "Information Technology Support Technician",
      company: "Prairieland FS, Inc",
      location: "Rushville, IL, US",
    });
    const pittsfield = computeContentIdentityKey({
      title: "Information Technology Support Technician",
      company: "Prairieland FS, Inc",
      location: "Pittsfield, IL, US",
    });
    expect(rushville).not.toBe(pittsfield);
  });

  it("returns null when title or company is missing, never an empty-string collision", () => {
    expect(computeContentIdentityKey({ title: "Engineer", company: null })).toBeNull();
    expect(computeContentIdentityKey({ title: null, company: "Acme" })).toBeNull();
    expect(computeContentIdentityKey({ title: "", company: "" })).toBeNull();
  });
});

describe("computeTitleLocationKey — the fallback identity", () => {
  it("gives both repro captures the SAME fallback key, which is what makes the fix possible", () => {
    const li = computeTitleLocationKey(REAL_LINKEDIN_CAPTURE);
    const ind = computeTitleLocationKey(REAL_INDEED_CAPTURE);
    expect(li).not.toBeNull();
    expect(ind).toBe(li);
  });

  it("still separates the real ABB cross-platform pair of DISTINCT jobs", () => {
    // Their descriptions score J=0.85 - higher than some true duplicates - so the
    // location bucket is the only thing keeping them apart. It must.
    const a = computeTitleLocationKey({ title: "Senior Field Service Technician", location: "United States" });
    const b = computeTitleLocationKey({ title: "Senior Field Service Technician", location: "Sioux Falls, SD, USA" });
    expect(a).not.toBe(b);
  });

  it("is null without a title, since the title is all it has to go on", () => {
    expect(computeTitleLocationKey({ title: null, location: "Austin, TX" })).toBeNull();
  });
});

describe("companyNameAppearsInText", () => {
  it("corroborates the repro: the real employer is named in the corrupted row's own description", () => {
    const indeedDescriptionOpening =
      "GuidePoint Security provides trusted cybersecurity expertise, solutions and services that help organizations make better decisions and minimize risk.";
    expect(companyNameAppearsInText("GuidePoint Security", indeedDescriptionOpening)).toBe(true);
    expect(companyNameAppearsInText("Some Unrelated Employer", indeedDescriptionOpening)).toBe(false);
  });

  it("ignores case and punctuation differences", () => {
    expect(companyNameAppearsInText("Electrical Consultants, Inc.", "Join ELECTRICAL CONSULTANTS today")).toBe(true);
  });

  it("refuses to corroborate on a too-short or absent name", () => {
    expect(companyNameAppearsInText("AT", "at the office")).toBe(false);
    expect(companyNameAppearsInText(null, "anything")).toBe(false);
    expect(companyNameAppearsInText("Acme", null)).toBe(false);
  });
});
