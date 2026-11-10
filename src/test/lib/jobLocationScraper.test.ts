import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractJobLocationFromHtml,
  extractJobLocationFromText,
  scrapeJobLocationFromPosting,
} from "@/lib/jobLocationScraper";

const input = {
  title: "Software Engineer, Evals",
  company: "SpaceXS",
  sourceUrl: "https://careers.example.com/jobs/1",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("job location extraction", () => {
  it("uses the matching JobPosting address and expands explicit US codes deterministically", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "SpaceXS" },
        {
          "@type": "JobPosting",
          title: "Software Engineer, Evals",
          hiringOrganization: { name: "SpaceXS" },
          jobLocation: { "@type": "Place", address: { addressLocality: "Newark", addressRegion: "NJ", addressCountry: "US" } },
        },
      ],
    })}</script>`;

    expect(extractJobLocationFromHtml(html, input, input.sourceUrl!)).toEqual({
      location: "Newark, New Jersey, United States",
      method: "schema_jobposting",
    });
  });

  it("selects the exact job from a page with multiple structured postings", () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { "@type": "JobPosting", title: "Another role", jobLocation: { address: { addressLocality: "Austin", addressRegion: "TX" } } },
      { "@type": "JobPosting", title: input.title, jobLocation: { address: { addressLocality: "Newark", addressRegion: "NJ", addressCountry: "US" } } },
    ])}</script>`;

    expect(extractJobLocationFromHtml(html, input, input.sourceUrl!)).toMatchObject({ location: "Newark, New Jersey, United States" });
  });

  it("does not take an unrelated listing location when the page title does not match", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "Another role",
      jobLocation: { address: { addressLocality: "Austin", addressRegion: "TX" } },
    })}</script><h1>Another role</h1>`;
    expect(extractJobLocationFromHtml(html, input, input.sourceUrl!)).toBeNull();
  });

  it("accepts only an explicit labeled location when structured data is absent", () => {
    const html = `<h1>${input.title}</h1><div>Job location</div><div>Boston, Massachusetts, United States</div>`;
    expect(extractJobLocationFromHtml(html, input, input.sourceUrl!)).toEqual({
      location: "Boston, Massachusetts, United States",
      method: "labeled_posting_field",
    });
  });

  it("uses Remote only when the structured posting explicitly marks telecommuting", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: input.title,
      jobLocationType: "TELECOMMUTE",
    })}</script>`;
    expect(extractJobLocationFromHtml(html, input, input.sourceUrl!)).toMatchObject({ location: "Remote", method: "schema_jobposting" });
  });

  it("requires the expected title before accepting a labeled text location", () => {
    expect(extractJobLocationFromText("Location: Boston, MA", input.title)).toBeNull();
    expect(extractJobLocationFromText("Featured roles\nLocation\nAustin, TX\n\n" + input.title + "\nJob description", input.title)).toBeNull();
    expect(extractJobLocationFromText(`${input.title}\nLocation: Boston, MA`, input.title)).toBe("Boston, MA");
    expect(extractJobLocationFromText(`${input.title}\nLocation information is available in the description`, input.title)).toBeNull();
  });

  it("does not mistake the company value after an empty location field for a location", () => {
    const html = `<h1>${input.title}</h1><div>Location</div><div>Company</div><div>Example Co</div>`;
    expect(extractJobLocationFromHtml(html, input, input.sourceUrl!)).toBeNull();
  });
});

describe("job posting fetch safety", () => {
  it("tries the verified Lever detail URL before its apply form URL", async () => {
    const fetchMock = vi.fn(async () => new Response(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: input.title,
        jobLocation: { address: { addressLocality: "Boston", addressRegion: "MA", addressCountry: "US" } },
      })}</script>`,
      { status: 200, headers: { "content-type": "text/html" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobLocationFromPosting({
      ...input,
      sourceUrl: "https://jobs.lever.co/acme/role/apply",
    });

    expect(result).toMatchObject({ ok: true, location: "Boston, Massachusetts, United States", method: "schema_jobposting" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://jobs.lever.co/acme/role");
  });

  it("uses the Job CEO rendered-page fallback and still requires an explicit location label", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(`<h1>${input.title}</h1><p>Posting content loaded by the page.</p>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }))
      .mockResolvedValueOnce(new Response(`${input.title}\n\nJob Location\nNewark, NJ, United States`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobLocationFromPosting(input);

    expect(result).toMatchObject({ ok: true, location: "Newark, NJ, United States", method: "labeled_posting_field" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("https://r.jina.ai/");
  });

  it("does not use the rendered-page fallback when the posting site denies access", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobLocationFromPosting(input);

    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe links without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await scrapeJobLocationFromPosting({ ...input, sourceUrl: "http://127.0.0.1/admin" });

    expect(result).toMatchObject({ ok: false, reason: "unsafe_link" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revalidates redirects and stops if the posting points to a private host", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapeJobLocationFromPosting(input);
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
