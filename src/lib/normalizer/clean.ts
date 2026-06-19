// src/lib/normalizer/clean.ts
// Normalizes a raw, field-mapped row into the shape jobs table inserts expect.
// Never guesses a wrong role_tier or date — null when not confidently recognized.
//
// Categorization is no longer inferred here with keyword heuristics (that approach
// mis-categorized almost everything that wasn't a clean keyword match — see
// src/lib/ai/jobCategorization.ts for why and what replaced it). Jobs are inserted
// with job_category left null and category_status defaulting to 'pending' at the DB
// level (supabase/migrations/20260618210000_ai_job_enrichment.sql); the AI pass fills
// job_category/category_tags/category_relevance_score in afterward. The only exception
// is when the *source data itself* already supplies an explicit category (e.g. a
// column-mapped import file) — that's trusted as-is and marked 'done' immediately,
// skipping an unnecessary AI call.

export interface CleanedJobRow {
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  posted_at: string | null;
  salary_range: string | null;
  role_tier: string | null;
  notes: string | null;
  external_job_id: string | null;
  tracking_id: string | null;
  ref_id: string | null;
  apply_url: string | null;
  description_html: string | null;
  description_text: string | null;
  benefits: unknown;
  seniority_level: string | null;
  employment_type: string | null;
  applicants_count: number | null;
  job_function: string | null;
  industries: string | null;
  input_url: string | null;
  company_linkedin_url: string | null;
  company_logo_url: string | null;
  company_employees_count: number | null;
  company_website: string | null;
  company_address: unknown;
  company_slogan: string | null;
  company_description: string | null;
  job_poster_name: string | null;
  job_poster_title: string | null;
  job_poster_profile_url: string | null;
  job_poster_photo_url: string | null;
  job_category: string | null;
  category_tags: string[];
  category_relevance_score: number | null;
  category_status?: string;
  raw_source_payload?: unknown;
}

const ROLE_TIER_SYNONYMS: Record<string, string> = {
  osp: "osp",
  "osp design": "osp",
  adjacent_1: "adjacent_1",
  "adjacent 1": "adjacent_1",
  civil: "adjacent_1",
  cad: "adjacent_1",
  adjacent_2: "adjacent_2",
  "adjacent 2": "adjacent_2",
  telecom: "adjacent_2",
};

function trimOrNull(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function parseDateLoose(v: string | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);

  const relMatch = t.match(/^(\d+)\s+day(s)?\s+ago$/i);
  if (relMatch) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(relMatch[1], 10));
    return d.toISOString().slice(0, 10);
  }

  const parsed = new Date(t);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function normalizeRoleTier(v: string | undefined): string | null {
  const t = v?.trim().toLowerCase();
  return t ? ROLE_TIER_SYNONYMS[t] ?? null : null;
}

function toInt(value: string | undefined): number | null {
  const t = value?.trim();
  if (!t) return null;
  const n = parseInt(t.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

function parseJsonLoose(value: string | undefined): unknown {
  const t = value?.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

function parseTags(value: string | undefined): string[] {
  const t = value?.trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed.map(String).map((tag) => tag.trim()).filter(Boolean);
  } catch {
    // Fall through to comma-separated parsing.
  }
  return t.split(",").map((tag) => tag.trim()).filter(Boolean);
}

export function cleanRow(raw: Record<string, string | undefined>): CleanedJobRow | null {
  const title = trimOrNull(raw.title);
  if (!title) return null;
  const descriptionText = trimOrNull(raw.description_text);
  const jobFunction = trimOrNull(raw.job_function);
  const industries = trimOrNull(raw.industries);
  const companyDescription = trimOrNull(raw.company_description);
  const explicitTags = parseTags(raw.category_tags);
  const explicitCategory = trimOrNull(raw.job_category);
  const explicitScore = toInt(raw.category_relevance_score);
  const category = {
    job_category: explicitCategory,
    category_tags: explicitTags,
    category_relevance_score: explicitScore,
    // Omitted (not 'pending') when there's no explicit category, so the DB default applies.
    ...(explicitCategory ? { category_status: "done" } : {}),
  };

  return {
    title,
    company: trimOrNull(raw.company),
    location: trimOrNull(raw.location),
    source_url: trimOrNull(raw.source_url),
    posted_at: parseDateLoose(raw.posted_at),
    salary_range: trimOrNull(raw.salary_range),
    role_tier: normalizeRoleTier(raw.role_tier),
    notes: trimOrNull(raw.notes),
    external_job_id: trimOrNull(raw.external_job_id),
    tracking_id: trimOrNull(raw.tracking_id),
    ref_id: trimOrNull(raw.ref_id),
    apply_url: trimOrNull(raw.apply_url),
    description_html: trimOrNull(raw.description_html),
    description_text: descriptionText,
    benefits: parseJsonLoose(raw.benefits),
    seniority_level: trimOrNull(raw.seniority_level),
    employment_type: trimOrNull(raw.employment_type),
    applicants_count: toInt(raw.applicants_count),
    job_function: jobFunction,
    industries,
    input_url: trimOrNull(raw.input_url),
    company_linkedin_url: trimOrNull(raw.company_linkedin_url),
    company_logo_url: trimOrNull(raw.company_logo_url),
    company_employees_count: toInt(raw.company_employees_count),
    company_website: trimOrNull(raw.company_website),
    company_address: parseJsonLoose(raw.company_address),
    company_slogan: trimOrNull(raw.company_slogan),
    company_description: companyDescription,
    job_poster_name: trimOrNull(raw.job_poster_name),
    job_poster_title: trimOrNull(raw.job_poster_title),
    job_poster_profile_url: trimOrNull(raw.job_poster_profile_url),
    job_poster_photo_url: trimOrNull(raw.job_poster_photo_url),
    ...category,
  };
}
