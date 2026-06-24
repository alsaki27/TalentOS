// src/lib/normalizer/fieldMap.ts
// Heuristic-only field mapping (synonym dictionary + fuzzy string matching).
// Deliberately no AI/LLM call here — see README "On AI" for why. The FieldMapper
// interface exists so a future AI-backed mapper could implement the same contract
// without callers changing, but it is NOT wired up by default.

import { FieldMapper, FieldMapping, MappingResult, SchemaField } from "./types";

const SYNONYMS: Record<SchemaField, string[]> = {
  title: ["title", "job title", "position", "role", "job_title", "posting title"],
  company: ["company", "employer", "company name", "organization", "companyname"],
  location: ["location", "city", "job location", "joblocation"],
  source_url: ["url", "link", "job url", "posting url", "source_url", "linkedin url"],
  posted_at: ["posted", "date posted", "posted_at", "publish date", "postedat"],
  salary_range: ["salary", "salary range", "comp", "compensation"],
  role_tier: ["tier", "role tier", "category"],
  notes: ["notes", "comment", "comments", "description"],
  external_job_id: ["id", "job id", "external id", "external_job_id", "linkedin id"],
  tracking_id: ["trackingid", "tracking id", "tracking_id"],
  ref_id: ["refid", "ref id", "ref_id"],
  apply_url: ["applyurl", "apply url", "apply_url"],
  description_html: ["descriptionhtml", "description html", "description_html", "job description html"],
  description_text: ["descriptiontext", "description text", "description_text", "job description", "qualifications"],
  benefits: ["benefits", "perks"],
  seniority_level: ["senioritylevel", "seniority level", "seniority_level"],
  employment_type: ["employmenttype", "employment type", "employment_type"],
  applicants_count: ["applicantscount", "applicants count", "applicants_count"],
  job_function: ["jobfunction", "job function", "job_function", "function"],
  industries: ["industries", "industry"],
  input_url: ["inputurl", "input url", "input_url", "search url"],
  company_linkedin_url: ["companylinkedinurl", "company linkedin url", "company_linkedin_url"],
  company_logo_url: ["companylogo", "company logo", "company_logo_url", "company logo url"],
  company_employees_count: ["companyemployeescount", "company employees count", "company_employees_count", "company size"],
  company_website: ["companywebsite", "company website", "company_website", "website"],
  company_address: ["companyaddress", "company address", "company_address"],
  company_slogan: ["companyslogan", "company slogan", "company_slogan"],
  company_description: ["companydescription", "company description", "company_description"],
  job_poster_name: ["jobpostername", "job poster name", "job_poster_name", "poster name"],
  job_poster_title: ["jobpostertitle", "job poster title", "job_poster_title", "poster title"],
  job_poster_profile_url: ["jobposterprofileurl", "job poster profile url", "job_poster_profile_url"],
  job_poster_photo_url: ["jobposterphoto", "job poster photo", "job_poster_photo_url"],
  job_category: ["category", "job category", "job_category", "primary category"],
  category_tags: ["categories", "category tags", "category_tags", "tags"],
  category_relevance_score: ["category score", "relevance score", "category_relevance_score"],
};

const FUZZY_THRESHOLD = 0.75;

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export const heuristicFieldMapper: FieldMapper = {
  mapFields(headers: string[]): MappingResult {
    const mapping: FieldMapping = {};
    const usedHeaders = new Set<string>();
    const normalizedHeaders = headers.map((h) => ({ original: h, normalized: normalizeHeader(h) }));

    for (const field of Object.keys(SYNONYMS) as SchemaField[]) {
      const synonyms = SYNONYMS[field].map(normalizeHeader);

      let best = normalizedHeaders.find(
        (h) => !usedHeaders.has(h.original) && synonyms.includes(h.normalized)
      );

      if (!best) {
        let bestScore = 0;
        for (const h of normalizedHeaders) {
          if (usedHeaders.has(h.original)) continue;
          for (const syn of synonyms) {
            const score = similarity(h.normalized, syn);
            if (score > bestScore) { bestScore = score; best = h; }
          }
        }
        if (bestScore < FUZZY_THRESHOLD) best = undefined;
      }

      if (best) {
        mapping[field] = best.original;
        usedHeaders.add(best.original);
      }
    }

    const unmappedHeaders = headers.filter((h) => !usedHeaders.has(h));
    const confident = !!mapping.title;

    return { mapping, unmappedHeaders, confident };
  },
};
