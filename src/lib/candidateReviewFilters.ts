export interface CandidateReviewFilters {
  status: "pending" | "approved" | "rejected" | "all";
  source: "all" | "scheduled_logging" | "extension";
  tier: "all" | "strong" | "adjacent" | "stretch" | "unscored";
  candidateId: string;
  staffId: string;
  start: string;
  end: string;
  page: number;
}
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function parseCandidateReviewFilters(params: URLSearchParams): CandidateReviewFilters {
  function choice<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
    const value = params.get(name) || fallback;
    if (!allowed.includes(value as T)) throw new Error(`Invalid ${name} filter.`);
    return value as T;
  }
  const candidateId = params.get("candidate_id") || "";
  const staffId = params.get("staff_id") || "";
  if (candidateId && !UUID.test(candidateId)) throw new Error("Invalid candidate filter.");
  if (staffId && staffId !== "unassigned" && !UUID.test(staffId)) throw new Error("Invalid staff filter.");
  function date(name: string) {
    const value = params.get(name) || "";
    if (!value) return "";
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error(`Invalid ${name} time. Include a timezone.`);
    }
    const calendarDate=new Date(`${value.slice(0,10)}T00:00:00Z`);
    if (calendarDate.toISOString().slice(0,10)!==value.slice(0,10)) throw new Error(`Invalid ${name} calendar date.`);
    return new Date(value).toISOString();
  }
  const start = date("start"), end = date("end");
  if (start && end && start > end) throw new Error("Start time must be before or equal to end time.");
  const page = Number(params.get("page") || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("Invalid page.");
  return {
    status: choice("status", ["pending", "approved", "rejected", "all"], "pending"),
    source: choice("source", ["all", "scheduled_logging", "extension"], "all"),
    tier: choice("tier", ["all", "strong", "adjacent", "stretch", "unscored"], "all"),
    candidateId, staffId, start, end, page,
  };
}

/** Only static SQL fragments are built; every user value is a bound parameter. */
export function candidateReviewFilterSql(filters: CandidateReviewFilters, firstParameter = 1) {
  const clauses: string[] = [], values: unknown[] = [];
  function bind(clause: string, value: unknown) {
    clauses.push(clause.replace("?", `$${firstParameter + values.length}`)); values.push(value);
  }
  if (filters.candidateId) bind("q.candidate_id = ?::uuid", filters.candidateId);
  if (filters.staffId === "unassigned") clauses.push("q.assigned_to_user_id IS NULL");
  else if (filters.staffId) bind("q.assigned_to_user_id = ?::uuid", filters.staffId);
  if (filters.source !== "all") bind("q.source = ?", filters.source);
  if (filters.tier === "unscored") clauses.push("q.ai_status <> 'scored'");
  else if (filters.tier !== "all") bind("q.ai_tier = ?", filters.tier);
  if (filters.start) bind("q.created_at >= ?::timestamptz", filters.start);
  if (filters.end) bind("q.created_at <= ?::timestamptz", filters.end);
  return { where: clauses.length ? clauses.join(" AND ") : "true", values };
}
