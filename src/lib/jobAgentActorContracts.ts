// Pure actor-contract helpers for the Apify Job Agent.
// Keep actor-specific input/output field names here so changes can be tested
// without importing database-backed orchestration services.

export type ActorSource = "indeed" | "google" | "linkedin";

export interface ApifyDatasetItem {
  job_title?: string;
  title?: string;
  company_name?: string;
  company?: string;
  location?: string;
  salary_range?: string;
  salary?: string;
  date_posted?: string;
  posted_at?: string;
  via_platform?: string;
  platform?: string;
  source_url?: string;
  url?: string;
  apply_link?: string;
  apply_url?: string;
  is_remote?: boolean;
  remote?: boolean;
  employment_type?: string;
  search_query?: string;
  searchQueryUsed?: string;
  query?: string;
  description?: string;
  description_text?: string;
  _duplicate?: boolean;
  _actor_source?: ActorSource;
  [key: string]: unknown;
}

const INDEED_HOURS_BY_INTERVAL: Record<string, number> = {
  today: 24,
  "2 days": 48,
  "3days": 72,
  "3 days": 72,
  "7 days": 168,
  week: 168,
  "30 days": 720,
  month: 720,
};

const LINKEDIN_PERIOD_BY_INTERVAL: Record<string, string> = {
  today: "r86400",
  // The actor has no native 48-hour option. Fetch a week and apply the exact
  // immutable 48-hour window after normalization.
  "2 days": "r604800",
  "3days": "r604800",
  "3 days": "r604800",
  "7 days": "r604800",
  week: "r604800",
  "30 days": "r2592000",
  month: "r2592000",
  any: "r2592000",
};

export function toIndeedHoursOld(interval: string | undefined | null): number {
  const normalized = (interval ?? "today").toLowerCase().trim();
  return INDEED_HOURS_BY_INTERVAL[normalized] ?? 24;
}

export function toLinkedInPublishedAt(interval: string | undefined | null): string {
  const normalized = (interval ?? "today").toLowerCase().trim();
  return LINKEDIN_PERIOD_BY_INTERVAL[normalized] ?? "r86400";
}

export function buildGoogleBooleanQuery(titles: string[]): string {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const rawTitle of titles) {
    const title = rawTitle.trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    unique.push(title);
  }

  return unique
    .map((title) => `"${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(" OR ");
}

export function buildIndeedInput(
  queries: string[],
  dateInterval: string | undefined,
  maxResults: number,
): Record<string, unknown> {
  if (queries.length === 0) throw new Error("Indeed requires at least one query.");
  const totalLimit = Math.max(1, Math.min(500, Math.floor(maxResults)));
  // Indeed limits per query, not per actor run. Flooring keeps the configured
  // shard ceiling intact for the current role bundles (all have <= 100 titles).
  const resultsPerQuery = Math.max(1, Math.floor(totalLimit / queries.length));
  return {
    queries,
    location: "United States",
    countryIndeed: "USA",
    resultsPerQuery,
    hoursOld: toIndeedHoursOld(dateInterval),
    enforceAnnual: true,
  };
}

export function buildLinkedInInput(
  queries: string[],
  dateInterval: string | undefined,
  maxResults: number,
): Record<string, unknown> {
  if (queries.length === 0) throw new Error("LinkedIn requires at least one query.");
  // This actor's current schema requires maxItems >= 150.
  const maxItems = Math.max(150, Math.min(1000, Math.floor(maxResults)));
  return {
    keyword: queries,
    locations: ["United States"],
    maxItems,
    publishedAt: toLinkedInPublishedAt(dateInterval),
    saveOnlyUniqueItems: true,
  };
}

export function buildGoogleInput(
  query: string,
  maxResults: number,
): Record<string, unknown> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Google Jobs requires a non-empty query.");
  const numResults = Math.max(10, Math.min(1000, Math.floor(maxResults)));
  return {
    query: normalizedQuery,
    location: "United States",
    country: "us",
    language: "en",
    num_results: numResults,
    max_pagination: Math.min(100, Math.max(0, Math.ceil(numResults / 10) - 1)),
  };
}

export interface BuildActorInputOptions {
  actorSource: ActorSource;
  queries: string[];
  dateInterval?: string;
  maxResults: number;
  explicitGoogleQuery?: string;
}

export function buildActorInput(options: BuildActorInputOptions): Record<string, unknown> {
  if (options.actorSource === "indeed") {
    return buildIndeedInput(options.queries, options.dateInterval, options.maxResults);
  }
  if (options.actorSource === "linkedin") {
    return buildLinkedInInput(options.queries, options.dateInterval, options.maxResults);
  }
  const query = options.explicitGoogleQuery?.trim() || buildGoogleBooleanQuery(options.queries);
  return buildGoogleInput(query, options.maxResults);
}

/** Translate one actor result into the Job Agent's canonical field shape. */
export function normalizeActorItem(
  source: ActorSource,
  raw: Record<string, unknown>,
): ApifyDatasetItem {
  if (source === "indeed") {
    const minAmount = raw.min_amount as number | undefined;
    const maxAmount = raw.max_amount as number | undefined;
    const currency = (raw.currency as string | undefined) ?? "USD";
    const salaryRange = minAmount != null && maxAmount != null
      ? `$${minAmount.toLocaleString()} - $${maxAmount.toLocaleString()} ${currency}/yr`
      : undefined;
    return {
      ...raw,
      _actor_source: "indeed",
      job_title: String(raw.title ?? "").trim(),
      company_name: String(raw.company ?? "").trim(),
      location: String(raw.location ?? "").trim(),
      source_url: String(raw.job_url ?? "").trim(),
      apply_link: String(raw.job_url ?? "").trim(),
      description: String(raw.description ?? "").trim(),
      date_posted: raw.date_posted ? String(raw.date_posted) : undefined,
      employment_type: raw.job_type ? String(raw.job_type) : undefined,
      is_remote: raw.is_remote === true,
      salary_range: salaryRange,
      via_platform: "Indeed",
      search_query: String(raw.query ?? raw.search_query ?? "").trim(),
    };
  }

  if (source === "google") {
    const applyOptions = Array.isArray(raw.apply_options)
      ? raw.apply_options as Array<{ title?: string; link?: string }>
      : [];
    const applyLink = applyOptions.find((option) => option?.link)?.link ?? "";
    const detectedExtensions = (raw.detected_extensions ?? {}) as Record<string, unknown>;
    return {
      ...raw,
      _actor_source: "google",
      job_title: String(raw.title ?? "").trim(),
      company_name: String(raw.company_name ?? "").trim(),
      location: String(raw.location ?? "").trim(),
      source_url: applyLink,
      apply_link: applyLink,
      description: String(raw.description ?? "").trim(),
      date_posted: detectedExtensions.posted_at
        ? String(detectedExtensions.posted_at)
        : undefined,
      employment_type: detectedExtensions.schedule_type
        ? String(detectedExtensions.schedule_type)
        : undefined,
      is_remote: String(raw.location ?? "").toLowerCase().includes("remote"),
      salary_range: undefined,
      via_platform: raw.via ? String(raw.via) : "Google Jobs",
      search_query: String(raw.query ?? "").trim(),
    };
  }

  const applyLink = String(raw.applyUrl ?? raw.jobUrl ?? "").trim();
  const salaryValues = Array.isArray(raw.salaryInfo) ? raw.salaryInfo.map(String) : [];
  return {
    ...raw,
    _actor_source: "linkedin",
    job_title: String(raw.jobTitle ?? raw.title ?? "").trim(),
    company_name: String(raw.companyName ?? raw.company ?? "").trim(),
    location: String(raw.location ?? "").trim(),
    source_url: String(raw.jobUrl ?? "").trim(),
    apply_link: applyLink,
    description: String(raw.jobDescription ?? raw.description ?? "").trim(),
    date_posted: raw.publishedAt
      ? String(raw.publishedAt)
      : raw.postedTime
        ? String(raw.postedTime)
        : undefined,
    employment_type: String(raw.contractType ?? "").trim() || undefined,
    is_remote: String(raw.location ?? "").toLowerCase().includes("remote"),
    salary_range: salaryValues.length ? salaryValues.join(" - ") : undefined,
    via_platform: "LinkedIn",
    search_query: String(raw.searchString ?? raw.query ?? "").trim(),
  };
}
