import type { CandidateCustomActivity } from "@/lib/candidateCustomActivity";
export const CANDIDATE_ACTIVITY_TYPES = ["interview", "mock", "training", "opt", "status", "follow_up", "custom"] as const;
export type CandidateActivityType = typeof CANDIDATE_ACTIVITY_TYPES[number];
export const CANDIDATE_CARD_UPCOMING_LIMIT = 1;
export const CANDIDATE_ACTIVITY_REFRESH_MS = 15_000;
export interface CandidateActivityDateRange { dateStart?: string; dateEnd?: string }
export interface CandidateActivityItem {
  id: string;
  candidateId: string;
  type: CandidateActivityType;
  title: string;
  summary: string;
  at: string;
  dateOnly: boolean;
  timeZone: string | null;
  status?: string | null;
  endAt?: string | null;
  customActivity?: CandidateCustomActivity;
  details: { label: string; value: string }[];
  currentDetails?: { label: string; value: string }[];
  currentDetailsTitle?: string;
  links: { label: string; href: string }[];
}
export interface CandidateActivityData {
  candidate: { id: string; name: string; timezone?: string | null };
  canManageCustom?: boolean;
  canEditCustom?: boolean;
  items: CandidateActivityItem[];
  upcoming: CandidateActivityItem[];
  current: { label: string; value: string; href: string }[];
  nextCursor: string | null;
  total: number;
  warnings: string[];
}

export function safeActivityUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u0020\u007f]/.test(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Text dates remain date-only; invalid dates never become synthetic events. */
export function activityDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !activityDate(value.slice(0, 10))) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function activityDateLabel(value: string, dateOnly = false, timeZone?: string | null) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { dateStyle: "medium", timeZone: "UTC" }
    : { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", ...(timeZone ? { timeZone } : {}) };
  try { return new Intl.DateTimeFormat("en-US", options).format(date); }
  catch { return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date); }
}

export function readActivityDateRange(search: URLSearchParams): CandidateActivityDateRange {
  const dateStart = search.get("dateStart") || undefined;
  const dateEnd = search.get("dateEnd") || undefined;
  for (const date of [dateStart, dateEnd]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || activityDate(date) !== date)) throw new Error("Invalid activity date range.");
  }
  if (dateStart && dateEnd && dateStart > dateEnd) throw new Error("The end date must be on or after the start date.");
  return { ...(dateStart ? { dateStart } : {}), ...(dateEnd ? { dateEnd } : {}) };
}

/** Compare the calendar dates shown in the timeline, including both boundary days. */
export function activityInDateRange(item: Pick<CandidateActivityItem, "at" | "dateOnly" | "timeZone">, range: CandidateActivityDateRange): boolean {
  if (!range.dateStart && !range.dateEnd) return true;
  let day = item.at.slice(0, 10);
  if (!item.dateOnly) {
    const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", timeZone: item.timeZone || "UTC" };
    let parts: Intl.DateTimeFormatPart[];
    try { parts = new Intl.DateTimeFormat("en-US", options).formatToParts(new Date(item.at)); }
    catch { parts = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).formatToParts(new Date(item.at)); }
    day = ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
  }
  return (!range.dateStart || day >= range.dateStart) && (!range.dateEnd || day <= range.dateEnd);
}

export function readActivityCursor(value: string | null): { at: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[1] !== "string" || !parsed[1] || parsed[1].length > 300) throw Error();
    const at = activityDate(parsed[0]);
    if (!at) throw Error();
    return { at, id: parsed[1] };
  } catch { throw new Error("Invalid activity cursor."); }
}

export function activityPage(items: CandidateActivityItem[], limit: number, cursor: { at: string; id: string } | null, pageNumber?: number) {
  const sorted = [...new Map(items.map((item) => [item.id, item])).values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  const filtered = cursor ? sorted.filter((item) => Date.parse(item.at) < Date.parse(cursor.at) ||
    (Date.parse(item.at) === Date.parse(cursor.at) && item.id.localeCompare(cursor.id) < 0)) : sorted;
  const offset = pageNumber ? (pageNumber - 1) * limit : 0;
  const page = filtered.slice(offset, offset + limit);
  const last = page[page.length - 1];
  return { items: page, total: sorted.length, nextCursor: filtered.length > offset + limit && last ? JSON.stringify([last.at, last.id]) : null };
}

export function activityScheduleLabel(item: CandidateActivityItem) {
  return activityDateLabel(item.at, item.dateOnly, item.timeZone) + (item.endAt ? ` – ${activityDateLabel(item.endAt, item.dateOnly, item.timeZone)}` : "");
}
