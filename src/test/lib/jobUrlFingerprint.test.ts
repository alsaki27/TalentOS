// Coverage for the apply-link fingerprint used by EVERY job-creation path
// (createJob/createJobs -> jobDuplicateGuard). Every URL below is a real
// shape taken from production data, not invented - the bug this guards
// against was that the same posting, captured twice, produced two different
// fingerprints and was stored twice.

import { describe, it, expect } from "vitest";
import {
  computeApplyLinkFingerprint,
  extractCanonicalJobKey,
  extractPlatformNamespace,
  normalizeUrlFingerprint,
} from "@/lib/jobUrlFingerprint";

describe("extractCanonicalJobKey — Indeed", () => {
  it("collapses the same jk across different per-view tk tracking keys", () => {
    // These five are real rows that were stored as five separate jobs.
    const urls = [
      "https://www.indeed.com/viewjob?jk=f2645064e02dfc3a&tk=1k29mp61jjccu800&from=serp&vjs=3",
      "https://www.indeed.com/viewjob?jk=f2645064e02dfc3a&tk=1k277sd0giju6801&from=serp&vjs=3",
      "https://www.indeed.com/viewjob?jk=f2645064e02dfc3a&tk=1k25bhanpiq50800&from=serp&vjs=3",
      "https://www.indeed.com/viewjob?jk=f2645064e02dfc3a&tk=1k1vpsf0th3lb801&from=serp&vjs=3",
      "https://www.indeed.com/viewjob?jk=f2645064e02dfc3a&tk=1k1vf4k6di9ti801&from=serp&vjs=3",
    ];
    const keys = new Set(urls.map((u) => extractCanonicalJobKey(u)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("indeed:f2645064e02dfc3a");
  });

  it("treats /viewjob?jk=X and /job/<slug>-X as the same posting", () => {
    // Real row: the Apify actor stored the /job/ form as source_url while
    // apply_url carried the /viewjob form, for one single posting.
    const viewjob = extractCanonicalJobKey("https://www.indeed.com/viewjob?jk=74067ae9700ad5ee");
    const slugged = extractCanonicalJobKey("http://www.indeed.com/job/data-center-field-engineer-74067ae9700ad5ee");
    expect(viewjob).toBe("indeed:74067ae9700ad5ee");
    expect(slugged).toBe("indeed:74067ae9700ad5ee");
  });

  it("keeps genuinely different Indeed postings apart", () => {
    expect(extractCanonicalJobKey("https://www.indeed.com/viewjob?jk=f2645064e02dfc3a"))
      .not.toBe(extractCanonicalJobKey("https://www.indeed.com/viewjob?jk=52dfbe218bd463e1"));
  });
});

describe("extractCanonicalJobKey — LinkedIn", () => {
  it("collapses bare-id and slugged-id URLs for one posting", () => {
    // Both real rows for LinkedIn posting 4331177628.
    expect(extractCanonicalJobKey("https://www.linkedin.com/jobs/view/4331177628/")).toBe("linkedin:4331177628");
    expect(
      extractCanonicalJobKey(
        "https://www.linkedin.com/jobs/view/osp-engineer-at-pearce-services-4331177628?position=14&pageNum=0&refId=abc%3D%3D&trackingId=xyz"
      )
    ).toBe("linkedin:4331177628");
  });

  it("ignores position/pageNum/refId/trackingId churn", () => {
    const a = extractCanonicalJobKey("https://www.linkedin.com/jobs/view/outside-plant-engineer-at-bluebird-fiber-4420622410?position=3&pageNum=0&refId=ljLF");
    const b = extractCanonicalJobKey("https://www.linkedin.com/jobs/view/outside-plant-engineer-at-bluebird-fiber-4420622410?position=47&pageNum=2&refId=ZZZZ");
    expect(a).toBe(b);
    expect(a).toBe("linkedin:4420622410");
  });

  it("keeps genuinely different LinkedIn postings apart", () => {
    // Real, distinct Pearce Services postings that must NOT be merged.
    const ids = [
      "https://www.linkedin.com/jobs/view/4331177628/",
      "https://www.linkedin.com/jobs/view/4438680064/",
      "https://www.linkedin.com/jobs/view/4429952811/",
      "https://www.linkedin.com/jobs/view/4331180610/",
    ].map((u) => extractCanonicalJobKey(u));
    expect(new Set(ids).size).toBe(4);
  });
});

describe("extractCanonicalJobKey — ATS platforms", () => {
  it("handles Greenhouse, ignoring the gh_src tracking param", () => {
    expect(extractCanonicalJobKey("https://job-boards.greenhouse.io/2kvegas/jobs/7431835003?gh_src=709ea1cf3us"))
      .toBe("greenhouse:2kvegas:7431835003");
    expect(extractCanonicalJobKey("https://job-boards.greenhouse.io/actpowerservices/jobs/7826587003"))
      .toBe("greenhouse:actpowerservices:7826587003");
  });

  it("treats a Lever job and its /apply variant as one posting", () => {
    const base = extractCanonicalJobKey("https://jobs.lever.co/CesiumAstro/f4a34f38-0880-4431-83ec-6b6daeb57f91");
    const apply = extractCanonicalJobKey("https://jobs.lever.co/CesiumAstro/f4a34f38-0880-4431-83ec-6b6daeb57f91/apply");
    expect(base).toBe(apply);
    expect(base).toBe("lever:cesiumastro:f4a34f38-0880-4431-83ec-6b6daeb57f91");
  });

  it("handles SmartRecruiters numeric ids", () => {
    expect(extractCanonicalJobKey("https://jobs.smartrecruiters.com/AECOM2/744000138194678-electrical-engineer-bess-focus-"))
      .toBe("smartrecruiters:aecom2:744000138194678");
  });

  it("treats hiring.cafe /job/<id> and /viewjob/<id> as one posting", () => {
    expect(extractCanonicalJobKey("https://hiring.cafe/job/yvwkuenixfen2y7z")).toBe("hiringcafe:yvwkuenixfen2y7z");
    expect(extractCanonicalJobKey("https://hiring.cafe/viewjob/yvwkuenixfen2y7z")).toBe("hiringcafe:yvwkuenixfen2y7z");
  });

  it("returns null for a URL that isn't a recognized platform job page", () => {
    expect(extractCanonicalJobKey("https://example.com/careers/engineer")).toBeNull();
    expect(extractCanonicalJobKey("http://ziprecruiter.com/jobs-search?search=OSP&location=US")).toBeNull();
    expect(extractCanonicalJobKey("not a url")).toBeNull();
    expect(extractCanonicalJobKey(null)).toBeNull();
  });
});

describe("normalizeUrlFingerprint — non-platform URLs", () => {
  it("strips tracking params but keeps meaningful ones", () => {
    const a = normalizeUrlFingerprint("https://careers.example.com/job?id=123&utm_source=x&gclid=y");
    const b = normalizeUrlFingerprint("https://careers.example.com/job?id=123");
    expect(a).toBe(b);
    expect(a).toContain("id=123");
  });

  it("preserves literal hyphens in the path", () => {
    // The old character class parsed ".-=" as a range and silently ate every
    // hyphen; "senior-engineer" became "seniorengineer".
    expect(normalizeUrlFingerprint("https://careers.example.com/senior-fiber-engineer")).toContain("senior-fiber-engineer");
  });

  it("keeps genuinely different postings on the same host apart", () => {
    expect(normalizeUrlFingerprint("https://careers.example.com/job?id=123"))
      .not.toBe(normalizeUrlFingerprint("https://careers.example.com/job?id=456"));
  });

  it("returns empty string for absent input", () => {
    expect(normalizeUrlFingerprint(null)).toBe("");
    expect(normalizeUrlFingerprint("   ")).toBe("");
  });
});

describe("computeApplyLinkFingerprint", () => {
  it("matches a row whose apply_url is the Indeed link against one whose source_url is", () => {
    const viaApply = computeApplyLinkFingerprint({ applyUrl: "https://www.indeed.com/viewjob?jk=abc123def4567890&tk=zzz", sourceUrl: null });
    const viaSource = computeApplyLinkFingerprint({ applyUrl: null, sourceUrl: "http://www.indeed.com/job/some-role-abc123def4567890" });
    expect(viaApply).toBe(viaSource);
  });

  it("prefers a canonical platform key on source_url over a non-platform apply_url", () => {
    // A row whose apply_url points at an unrecognized employer ATS but whose
    // source_url is the Indeed posting must still match a second capture of
    // that same Indeed posting.
    const fp = computeApplyLinkFingerprint({
      applyUrl: "https://careers.employer.com/apply/opening",
      sourceUrl: "https://www.indeed.com/viewjob?jk=abc123def4567890",
    });
    expect(fp).toBe("indeed:abc123def4567890");
  });

  it("returns null when neither URL is present, never an empty string", () => {
    expect(computeApplyLinkFingerprint({})).toBeNull();
    expect(computeApplyLinkFingerprint({ applyUrl: "", sourceUrl: null })).toBeNull();
  });

  it("still fingerprints an unrecognized platform via URL normalization", () => {
    const fp = computeApplyLinkFingerprint({ applyUrl: "https://careers.example.com/job/9876" });
    expect(fp).toBeTruthy();
    expect(fp).toContain("careers.example.com");
  });
});

describe("extractPlatformNamespace", () => {
  it("reads the platform off a canonical key", () => {
    expect(extractPlatformNamespace("indeed:f2645064e02dfc3a")).toBe("indeed");
    expect(extractPlatformNamespace("linkedin:4331177628")).toBe("linkedin");
    expect(extractPlatformNamespace("greenhouse:2kvegas:7431835003")).toBe("greenhouse");
    expect(extractPlatformNamespace("lever:cesiumastro:f4a34f38")).toBe("lever");
  });

  it("reduces a normalized-URL fingerprint to its brand label", () => {
    expect(extractPlatformNamespace("dailyremote.com/remote-job/application-security-engineer-5163929")).toBe("dailyremote");
    expect(extractPlatformNamespace("simplyhired.com/job/8fbv3te484jk")).toBe("simplyhired");
  });

  it("agrees across BOTH fingerprint forms of one platform - the real Bowman Consulting miss", () => {
    // A LinkedIn job page yields a canonical key; a LinkedIn feed post yields a
    // normalized-URL fingerprint. Both must read as "linkedin" or the
    // same-platform veto cannot fire.
    expect(extractPlatformNamespace("linkedin:4414040634")).toBe("linkedin");
    expect(extractPlatformNamespace("linkedin.com/feed/update/urnliactivity7497664327231909888")).toBe("linkedin");
    expect(extractPlatformNamespace("linkedin:4414040634"))
      .toBe(extractPlatformNamespace("linkedin.com/feed/update/urnliactivity7497664327231909888"));
  });

  it("aligns an ATS host with its canonical platform token", () => {
    expect(extractPlatformNamespace("job-boards.greenhouse.io/board/jobs/1")).toBe("greenhouse");
    expect(extractPlatformNamespace("greenhouse:board:1")).toBe("greenhouse");
  });

  it("strips a port and uses the brand label for a deep ATS hostname", () => {
    expect(extractPlatformNamespace("fa-exkk-saasfaprod1.fa.ocs.oraclecloud.com:443/job/1")).toBe("oraclecloud");
  });

  it("returns null for absent input", () => {
    expect(extractPlatformNamespace(null)).toBeNull();
    expect(extractPlatformNamespace("   ")).toBeNull();
  });

  it("agrees for two ids on one platform and differs across platforms - the property the guard relies on", () => {
    expect(extractPlatformNamespace("indeed:aaa")).toBe(extractPlatformNamespace("indeed:bbb"));
    expect(extractPlatformNamespace("indeed:aaa")).not.toBe(extractPlatformNamespace("linkedin:123456"));
  });
});
