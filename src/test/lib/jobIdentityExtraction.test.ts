// Coverage for the identity extractors that make duplicate detection work on a
// platform nobody has written a matcher for, and that keep every identity a
// posting has instead of only one.
//
// The precision requirement here is absolute: a match on these is treated as
// authoritative and BLOCKS an insert, so collapsing two genuinely different
// postings onto one key would lose a real job. Every "must not match" case below
// is therefore as important as the "must match" ones.

import { describe, it, expect } from "vitest";
import {
  extractGenericJobKey,
  extractPlatformNamespace,
  extractAllIdentities,
  looksLikeSearchOrListingUrl,
  computeApplyLinkFingerprint,
} from "@/lib/jobUrlFingerprint";

describe("extractGenericJobKey — any platform, no per-site code", () => {
  it("pulls the trailing id out of a slugged url (the real DailyRemote shape from the repro)", () => {
    expect(
      extractGenericJobKey(
        "https://dailyremote.com/remote-job/application-security-engineer-mid-atlantic-region-remote-in-va-md-pa-nc-de-nj-or-dc-5163929?utm_source=chatgpt.com"
      )
    ).toBe("dailyremote.com:5163929");
  });

  it("gives one posting the same key even if its slug changes, which whole-url matching could not", () => {
    const a = extractGenericJobKey("https://dailyremote.com/remote-job/application-security-engineer-5163929");
    const b = extractGenericJobKey("https://dailyremote.com/remote-job/app-sec-engineer-mid-atlantic-5163929");
    expect(a).toBe(b);
    expect(a).toBe("dailyremote.com:5163929");
  });

  it("reads an id-shaped value off an id-named query param", () => {
    expect(extractGenericJobKey("https://careers.example.com/openings?jobId=884213")).toBe("careers.example.com:884213");
    expect(extractGenericJobKey("https://jobs.example.org/view?requisitionId=REQ-000123456")).toBeNull();
    expect(extractGenericJobKey("https://jobs.example.org/view?vacancyId=0a1b2c3d4e5f6a7b")).toBe(
      "jobs.example.org:0a1b2c3d4e5f6a7b"
    );
  });

  it("accepts a uuid path segment", () => {
    expect(extractGenericJobKey("https://boards.example.com/job/f4a34f38-0880-4431-83ec-6b6daeb57f91")).toBe(
      "boards.example.com:f4a34f38-0880-4431-83ec-6b6daeb57f91"
    );
  });

  it("refuses a value that is not id-shaped, rather than inventing an identity", () => {
    // A short number or a slug word must never become an id - that is how two
    // different postings would collapse onto one key.
    expect(extractGenericJobKey("https://careers.example.com/jobs?id=7")).toBeNull();
    expect(extractGenericJobKey("https://careers.example.com/careers/senior-fiber-engineer")).toBeNull();
    expect(extractGenericJobKey("https://careers.example.com/about-us")).toBeNull();
  });

  it("keeps two different ids on one host apart, and one id on two hosts apart", () => {
    expect(extractGenericJobKey("https://x.example.com/job/5163929")).not.toBe(
      extractGenericJobKey("https://x.example.com/job/5163930")
    );
    expect(extractGenericJobKey("https://a.example.com/job/5163929")).not.toBe(
      extractGenericJobKey("https://b.example.com/job/5163929")
    );
  });

  it("is safe with absent or unparseable input", () => {
    expect(extractGenericJobKey(null)).toBeNull();
    expect(extractGenericJobKey("not a url")).toBeNull();
  });
});

describe("looksLikeSearchOrListingUrl", () => {
  it("recognizes the real listing url that was wrongly stored as a job's identity", () => {
    // A row for "Construction Integration Manager" @ Electronic Environments was
    // fingerprinted as this - a query, not a posting. Two different jobs captured
    // from it would have shared an identity and blocked each other.
    expect(
      looksLikeSearchOrListingUrl(
        "https://www.ziprecruiter.com/jobs-search?search=telecommunications+manager&location=Atlanta%2C+GA"
      )
    ).toBe(true);
  });

  it("recognizes other listing shapes", () => {
    expect(looksLikeSearchOrListingUrl("https://www.indeed.com/jobs?q=osp+engineer&l=Texas")).toBe(true);
    expect(looksLikeSearchOrListingUrl("https://example.com/browse/engineering")).toBe(true);
  });

  it("does not flag a real posting url", () => {
    expect(looksLikeSearchOrListingUrl("https://www.indeed.com/viewjob?jk=8763525f8fdfc1b6")).toBe(false);
    expect(looksLikeSearchOrListingUrl("https://www.linkedin.com/jobs/view/4430748287")).toBe(false);
    expect(looksLikeSearchOrListingUrl("https://job-boards.greenhouse.io/acme/jobs/7431835003")).toBe(false);
  });
});

describe("extractPlatformNamespace", () => {
  it("reads the platform off a canonical key", () => {
    expect(extractPlatformNamespace("indeed:f2645064e02dfc3a")).toBe("indeed");
    expect(extractPlatformNamespace("greenhouse:2kvegas:7431835003")).toBe("greenhouse");
    expect(extractPlatformNamespace("lever:cesiumastro:f4a34f38")).toBe("lever");
  });

  it("agrees across BOTH fingerprint forms of one platform — the real Bowman Consulting miss", () => {
    // A LinkedIn job page yields a canonical key; a LinkedIn feed post yields a
    // normalized-url fingerprint. Both must read as "linkedin" or the
    // same-platform veto cannot fire, and a real pair slipped through on this.
    expect(extractPlatformNamespace("linkedin:4414040634")).toBe("linkedin");
    expect(extractPlatformNamespace("linkedin.com/feed/update/urnliactivity7497664327231909888")).toBe("linkedin");
  });

  it("aligns an ATS host with its canonical platform token", () => {
    expect(extractPlatformNamespace("job-boards.greenhouse.io/acme/jobs/1")).toBe("greenhouse");
    expect(extractPlatformNamespace("greenhouse:acme:1")).toBe("greenhouse");
  });

  it("reduces a generic host:id key and a deep ATS host to the same brand label", () => {
    expect(extractPlatformNamespace("dailyremote.com:5163929")).toBe("dailyremote");
    expect(extractPlatformNamespace("abb.wd3.myworkdayjobs.com/x/job/y")).toBe("myworkdayjobs");
  });

  it("distinguishes different platforms, which is what the veto depends on", () => {
    expect(extractPlatformNamespace("indeed:aaa")).toBe(extractPlatformNamespace("indeed:bbb"));
    expect(extractPlatformNamespace("indeed:aaa")).not.toBe(extractPlatformNamespace("linkedin:123456"));
  });

  it("is safe with absent input", () => {
    expect(extractPlatformNamespace(null)).toBeNull();
    expect(extractPlatformNamespace("   ")).toBeNull();
  });
});

describe("extractAllIdentities — keeping the ATS requisition instead of discarding it", () => {
  it("keeps BOTH identities for the real row whose Greenhouse link was being thrown away", () => {
    // Live row: apply_url was the Indeed posting, source_url the Greenhouse
    // shortlink. computeApplyLinkFingerprint stores only "indeed:...", so a
    // capture of that same requisition from anywhere else could never match.
    const identities = extractAllIdentities([
      "https://www.indeed.com/viewjob?jk=30cb1d400c13fdc4",
      "https://job-boards.greenhouse.io/box/jobs/7431835003",
    ]);
    const values = identities.map((i) => i.identity);
    expect(values).toContain("indeed:30cb1d400c13fdc4");
    expect(values).toContain("greenhouse:box:7431835003");
    expect(identities.every((i) => i.kind === "platform")).toBe(true);
  });

  it("is what lets two aggregators be linked through one shared requisition", () => {
    const fromLinkedIn = extractAllIdentities([
      "https://www.linkedin.com/jobs/view/4430748287",
      "https://job-boards.greenhouse.io/guidepointsecurity/jobs/7999111",
    ]).map((i) => i.identity);
    const fromIndeed = extractAllIdentities([
      "https://www.indeed.com/viewjob?jk=8763525f8fdfc1b6",
      "https://job-boards.greenhouse.io/guidepointsecurity/jobs/7999111",
    ]).map((i) => i.identity);
    const shared = fromLinkedIn.filter((i) => fromIndeed.includes(i));
    expect(shared).toEqual(["greenhouse:guidepointsecurity:7999111"]);
  });

  it("marks a generically-extracted id as the weaker kind", () => {
    const identities = extractAllIdentities(["https://dailyremote.com/remote-job/app-sec-5163929"]);
    expect(identities).toEqual([{ identity: "dailyremote.com:5163929", kind: "generic" }]);
  });

  it("EXCLUDES a search/listing url, so two jobs found on one search page never collide", () => {
    expect(
      extractAllIdentities(["https://www.ziprecruiter.com/jobs-search?search=osp+engineer&location=Atlanta"])
    ).toEqual([]);
  });

  it("dedupes and tolerates empty input", () => {
    const identities = extractAllIdentities([
      "https://www.indeed.com/viewjob?jk=abc123def4567890",
      "https://www.indeed.com/viewjob?jk=abc123def4567890&tk=zzz",
      null,
      "",
    ]);
    expect(identities).toEqual([{ identity: "indeed:abc123def4567890", kind: "platform" }]);
    expect(extractAllIdentities([])).toEqual([]);
  });
});

describe("computeApplyLinkFingerprint still benefits from the generic extractor", () => {
  it("fingerprints a slugged unrecognized-platform url by its id, not its slug", () => {
    expect(computeApplyLinkFingerprint({ applyUrl: "https://dailyremote.com/remote-job/app-sec-engineer-5163929" })).toBe(
      "dailyremote.com:5163929"
    );
  });

  it("leaves the verified platform extractors in charge where they apply", () => {
    expect(computeApplyLinkFingerprint({ applyUrl: "https://www.indeed.com/viewjob?jk=f2645064e02dfc3a&tk=zzz" })).toBe(
      "indeed:f2645064e02dfc3a"
    );
  });
});
