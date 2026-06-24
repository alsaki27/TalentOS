// src/lib/jobPostingExtractor.ts
// Extracts schema.org JobPosting structured data (JSON-LD) from a company career
// page. Many ATS-less career pages embed this for Google for Jobs/SEO — reading
// what the page already publishes, no scraping/parsing of visual HTML needed.

import { JobRow } from "@/lib/linkedinMapper";

interface JsonLdPlace {
  address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
}

interface JsonLdJobPosting {
  "@type"?: string | string[];
  title?: string;
  datePosted?: string;
  employmentType?: string | string[];
  description?: string;
  url?: string;
  hiringOrganization?: { name?: string; sameAs?: string; logo?: string | { url?: string } };
  jobLocation?: JsonLdPlace | JsonLdPlace[];
  [key: string]: unknown;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed JSON-LD on the page — skip it, don't fail the whole import.
    }
  }
  return blocks;
}

function flattenJsonLd(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) return (obj["@graph"] as unknown[]).flatMap(flattenJsonLd);
    return [obj];
  }
  return [];
}

function isJobPosting(node: Record<string, unknown>): node is JsonLdJobPosting {
  const type = node["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

function formatLocation(loc: JsonLdPlace | JsonLdPlace[] | undefined): string | null {
  const place = Array.isArray(loc) ? loc[0] : loc;
  const addr = place?.address;
  if (!addr) return null;
  return [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ") || null;
}

export async function fetchCareerPageJobs(pageUrl: string): Promise<JobRow[]> {
  const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; SkarionBot/1.0)" } });
  if (!res.ok) throw new Error(`Could not fetch career page (${res.status})`);
  const html = await res.text();

  const postings = extractJsonLdBlocks(html)
    .flatMap(flattenJsonLd)
    .filter(isJobPosting);

  if (postings.length === 0) {
    throw new Error("No JobPosting structured data found on this page.");
  }

  return postings
    .filter((jp) => jp.title)
    .map((jp) => ({
      title: jp.title!,
      company: jp.hiringOrganization?.name ?? null,
      location: formatLocation(jp.jobLocation),
      source: "career_page",
      source_url: jp.url ?? pageUrl,
      seniority_level: null,
      employment_type: Array.isArray(jp.employmentType) ? jp.employmentType.join(", ") : jp.employmentType ?? null,
      applicants_count: null,
      company_employees_count: null,
      company_website: jp.hiringOrganization?.sameAs ?? null,
      posted_at: jp.datePosted ? jp.datePosted.slice(0, 10) : null,
      description_text: jp.description ? stripHtml(jp.description) : null,
      company_logo_url: typeof jp.hiringOrganization?.logo === "string"
        ? jp.hiringOrganization.logo
        : jp.hiringOrganization?.logo?.url ?? null,
    }));
}
