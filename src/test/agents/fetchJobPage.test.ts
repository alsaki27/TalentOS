// Regression coverage for the description-quality bug: OpenJobData sometimes supplies
// an application-FORM url rather than a job-detail url. Scraping one can return a
// browser/application error page instead of real content, and because these pages are
// often LONGER than the Description Enricher's 500-char "too thin to trust" cutoff, a
// long garbage description looked "complete" and was saved verbatim, never revisited.
// looksLikeErrorPage()/isContentUseless() close that gap — see fetchJobPage.ts.

import { describe, it, expect } from "vitest";
import {
  isContentUseless,
  looksLikeErrorPage,
  looksLikeLoginWall,
  looksLikeMissingJobContent,
  normalizeJobDetailUrl,
} from "@/lib/ai/job-agents/fetchJobPage";

function padTo(text: string, minLength: number): string {
  if (text.length >= minLength) return text;
  return text + " Lorem ipsum dolor sit amet consectetur adipiscing elit.".repeat(Math.ceil((minLength - text.length) / 56));
}

describe("looksLikeErrorPage", () => {
  it("flags an expired-application page even when padded well past the old 8000-char login-wall ceiling", () => {
    const longErrorPage = padTo("This application has expired. Please check back later for new openings.", 9000);
    expect(longErrorPage.length).toBeGreaterThan(8000);
    expect(looksLikeErrorPage(longErrorPage)).toBe(true);
  });

  it("flags a 'no longer accepting applications' page", () => {
    expect(looksLikeErrorPage("Sorry, this job is no longer accepting applications.")).toBe(true);
  });

  it("flags a 'position has been filled' page", () => {
    expect(looksLikeErrorPage("This position has been filled. Thank you for your interest.")).toBe(true);
  });

  it("flags a 404 / page-not-found page", () => {
    expect(looksLikeErrorPage("404 - Page Not Found. The page you requested could not be located.")).toBe(true);
  });

  it("flags a captcha/human-verification wall", () => {
    expect(looksLikeErrorPage("Please verify that you are human before continuing. Complete the captcha below.")).toBe(true);
  });

  it("flags a React error-boundary page", () => {
    expect(looksLikeErrorPage("Something went wrong. An unexpected error has occurred while loading this page.")).toBe(true);
  });

  it("does not flag a real job description that happens to be long", () => {
    const realDescription = padTo(
      "We are seeking a Fiber Design Engineer to join our outside plant team. Responsibilities include designing fiber optic networks, performing field surveys, and coordinating with permitting authorities. 3-5 years of telecom experience preferred.",
      9000
    );
    expect(looksLikeErrorPage(realDescription)).toBe(false);
  });

  // Found live 2026-10-27 via the recovery-retry feature: this module's own
  // comment in fetchJobPageText already documented "ADP, UKG/UltiPro serve an
  // immediate 'unsupported browser' page" as known — but nothing here ever
  // actually caught it. All 9 of the retry feature's first "successful"
  // recoveries turned out to be exactly this. One was already live on the
  // jobs page with this text as its description before the fix.
  it("flags ADP Workforce Now's browser-compatibility notice (verbatim text captured from a real production incident)", () => {
    const adpNotice = padTo(
      "Please switch to a supported browser listed here, or some features may not work correctly. We use our own and third-party cookies to improve your experience.",
      2094
    );
    expect(looksLikeErrorPage(adpNotice)).toBe(true);
  });

  it("flags UltiPro's job-board widget JS (verbatim text captured from a real production incident)", () => {
    const ultiProWidget = padTo(
      "Post : : : : : : : : 0 --> 1 && showAllLocations() == false, text: $.t('Opportunity.Opportunities.MoreJobLocations', { count : Locations().length - 1 }), click: function(){showAllLocations(true)}",
      873
    );
    expect(looksLikeErrorPage(ultiProWidget)).toBe(true);
  });
});

describe("looksLikeMissingJobContent", () => {
  // Found live 2026-10-27, same incident: an iCIMS career page's generic
  // EEO/accessibility footer plus navigation links - no job-specific content
  // at all - passed every other check (not a login wall, no matched error
  // phrase, 1,400+ chars long). Two different job postings on the same
  // employer's iCIMS site returned byte-identical text, confirming it's a
  // page template, not a real per-job description.
  it("flags iCIMS's EEO/accessibility footer (verbatim text captured from a real production incident, no error-page phrase present)", () => {
    const icimsFooter =
      "[Skip Branding](https://careers-example.icims.com/jobs/1/some-job/job)\n\n# Example Corporation\n\n" +
      "Example Corporation is an equal employment opportunity employer. We are dedicated to equal opportunity in employment without regard to race, religion, gender, sexual orientation, national origin, age, veteran or disabled status, or any other protected class.\n\n" +
      "ACCESSIBILITY NOTICE: If you need a reasonable accommodation for any part of the employment process due to a physical or mental disability, please call 1-855-266-8325.";
    expect(looksLikeErrorPage(icimsFooter)).toBe(false); // confirms this is NOT caught by the error-page patterns
    expect(looksLikeMissingJobContent(icimsFooter)).toBe(true);
  });

  it("does not flag a real, if terse, job description that mentions responsibilities", () => {
    const text = "Outside Plant Engineer responsible for fiber route design, make-ready engineering, and construction coordination across the Southeast region.";
    expect(looksLikeMissingJobContent(text)).toBe(false);
  });

  it("does not flag a real job description using 'qualifications' or 'experience' instead", () => {
    expect(looksLikeMissingJobContent("Minimum qualifications: associate degree and 2 years of relevant experience.")).toBe(false);
  });

  it("does not flag very long content regardless of keywords (the 3000-char ceiling exists so a real, lengthy posting is never rejected on this check alone)", () => {
    const longPadding = padTo("No job keywords here at all, just filler text.", 3500);
    expect(longPadding.length).toBeGreaterThan(3000);
    expect(looksLikeMissingJobContent(longPadding)).toBe(false);
  });
});

describe("isContentUseless", () => {
  it("rejects a long expired-application page (the exact bug: too long for the old login-wall check, not short enough to trip the length floor)", () => {
    const longErrorPage = padTo("This application has expired.", 9000);
    expect(isContentUseless(longErrorPage)).toBe(true);
  });

  it("still rejects short content, unrelated to the error-page check", () => {
    expect(isContentUseless("Too short")).toBe(true);
  });

  it("still rejects a login wall via the existing check", () => {
    expect(looksLikeLoginWall("Please sign in to continue viewing this job posting.")).toBe(true);
    expect(isContentUseless("Please sign in to continue viewing this job posting.")).toBe(true);
  });

  it("accepts a real, substantive job description", () => {
    const realDescription = padTo(
      "Outside Plant Engineer responsible for fiber route design, make-ready engineering, and construction coordination across the Southeast region.",
      500
    );
    expect(isContentUseless(realDescription)).toBe(false);
  });

  // Integration-level regression for the 2026-10-27 incident: isContentUseless
  // is the actual gate tryJinaFetch calls — these three sub-checks passing
  // individually (tested above) isn't the same guarantee as the composite
  // function rejecting all three real production payloads.
  it("rejects all three real garbage payloads found live via the recovery-retry feature", () => {
    const adpNotice = padTo("Please switch to a supported browser listed here, or some features may not work correctly.", 2094);
    const ultiProWidget = padTo("Post : : : : : : : : 0 --> 1 && showAllLocations() == false, text: $.t('Opportunity.Opportunities.MoreJobLocations'", 873);
    const icimsFooter =
      "[Skip Branding](https://careers-example.icims.com/jobs/1/some-job/job)\n\n# Example Corporation\n\n" +
      "Example Corporation is an equal employment opportunity employer, dedicated to equal opportunity without regard to race, religion, gender, or any other protected class.\n\n" +
      "ACCESSIBILITY NOTICE: If you need a reasonable accommodation, please call 1-855-266-8325.";
    expect(isContentUseless(adpNotice)).toBe(true);
    expect(isContentUseless(ultiProWidget)).toBe(true);
    expect(isContentUseless(icimsFooter)).toBe(true);
  });
});

describe("looksLikeLoginWall false-positive regression", () => {
  // Found live in production data while verifying this fix: every current real match of
  // the login-wall pattern turned out to be "Signing Bonus" (a $500 signing bonus line),
  // not an actual sign-in prompt — "sign" + "in" is a literal substring of "Signing".
  // Without a trailing \b, the pattern can't tell the two apart.
  it("does not flag a real job description mentioning a signing bonus", () => {
    const text = "$20.00 - $27.50 per hour depending on experience. $500 Signing Bonus paid at 60 days of employment. Apply today!";
    expect(looksLikeLoginWall(text)).toBe(false);
  });

  it("does not flag a real job description mentioning an accounting system", () => {
    const text = "This role will help create an accounting system for field service dispatch and job tracking across all regional offices.";
    expect(looksLikeLoginWall(text)).toBe(false);
  });

  it("still flags a genuine 'please sign in' login wall", () => {
    expect(looksLikeLoginWall("Please sign in to view this job posting and continue your application.")).toBe(true);
  });

  it("still flags a genuine 'log in to continue' wall", () => {
    expect(looksLikeLoginWall("You must log in to continue. Create an account to apply for this position.")).toBe(true);
  });
});

describe("normalizeJobDetailUrl", () => {
  // Reported live: jobs stuck at stage "no_description" (0 chars fetched) despite the
  // description being visible when a person opens the same link in a browser — because
  // OpenJobData's apply_url pointed at the application-FORM sub-page, not the job-detail
  // page. Both transforms below were verified by fetching the real URL before being added.

  it("strips Lever's trailing /apply segment to reach the job-detail page", () => {
    expect(normalizeJobDetailUrl("https://jobs.lever.co/waremalcomb/bc2847db-ba2b-4ee0-9c4c-9e77f7d0e831/apply")).toBe(
      "https://jobs.lever.co/waremalcomb/bc2847db-ba2b-4ee0-9c4c-9e77f7d0e831"
    );
  });

  it("is case-insensitive on Lever's /apply segment", () => {
    expect(normalizeJobDetailUrl("https://jobs.lever.co/acme/abc123/Apply")).toBe("https://jobs.lever.co/acme/abc123");
  });

  it("leaves a Lever job-detail url (no trailing /apply) unchanged", () => {
    const url = "https://jobs.lever.co/waremalcomb/bc2847db-ba2b-4ee0-9c4c-9e77f7d0e831";
    expect(normalizeJobDetailUrl(url)).toBe(url);
  });

  it("rewrites Paylocity's Apply path to Details to reach the job-detail page", () => {
    expect(normalizeJobDetailUrl("https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4403585")).toBe(
      "https://recruiting.paylocity.com/Recruiting/Jobs/Details/4403585"
    );
  });

  it("leaves urls from unrelated hosts completely unchanged, including ones ending in /apply", () => {
    const url = "https://example.com/careers/some-job/apply";
    expect(normalizeJobDetailUrl(url)).toBe(url);
  });

  it("leaves a malformed url unchanged rather than throwing", () => {
    expect(normalizeJobDetailUrl("not a url")).toBe("not a url");
  });
});
