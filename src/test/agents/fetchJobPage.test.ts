// Regression coverage for the description-quality bug: OpenJobData sometimes supplies
// an application-FORM url rather than a job-detail url. Scraping one can return a
// browser/application error page instead of real content, and because these pages are
// often LONGER than the Description Enricher's 500-char "too thin to trust" cutoff, a
// long garbage description looked "complete" and was saved verbatim, never revisited.
// looksLikeErrorPage()/isContentUseless() close that gap — see fetchJobPage.ts.

import { describe, it, expect } from "vitest";
import { isContentUseless, looksLikeErrorPage, looksLikeLoginWall, normalizeJobDetailUrl } from "@/lib/ai/job-agents/fetchJobPage";

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
