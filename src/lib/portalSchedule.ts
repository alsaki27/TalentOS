// Candidate-portal schedule model and pure layout helpers.
//
// Every calendar item - a job interview, a mock interview, or a meeting type
// added later - is normalised into a ScheduleEvent here, so the week grid, the
// agenda and the stats never need to know which source an item came from.
// To add a new source, write one mapper that returns a ScheduleEvent.
//
// Client-safe: no database or server imports, so the rules can be unit tested.

import {
  EASTERN_TIME_ZONE,
  INTERVIEW_TIME_ZONES,
  isInterviewTimeZone,
  zonedDateKey,
} from "@/lib/easternTime";

export type ScheduleKind = "interview" | "mock" | "meeting";
export type ScheduleBucket = "upcoming" | "past" | "cancelled" | "unscheduled";
export type DisplayZone = (typeof INTERVIEW_TIME_ZONES)[number]["value"];

export const DEFAULT_EVENT_MINUTES = 60;
const DEFAULT_DISPLAY_ZONE: DisplayZone = "America/New_York";

export interface ScheduleEvent {
  key: string;
  kind: ScheduleKind;
  bucket: ScheduleBucket;
  title: string;
  subtitle: string;
  /** UTC instant for timed events; null until a time is set. */
  startsAt: string | null;
  /** YYYY-MM-DD for all-day items, such as mock sessions that store a date only. */
  dateKey: string | null;
  /** The zone the item was scheduled in. Used for labels, not for grid placement. */
  timeZone: string | null;
  durationMinutes: number | null;
  format: "online" | "onsite" | null;
  location: string | null;
  meetingLink: string | null;
  panel: string[];
  href: string;
}

/** One row of GET /api/portal/me/interviews. */
export interface PortalInterview {
  id: string | null;
  application_id: string;
  job_id: string | null;
  job_title: string;
  company_name: string | null;
  location: string | null;
  job_location: string | null;
  job_posting_url: string | null;
  round_name: string;
  round_number: number;
  scheduled_at: string | null;
  time_zone: string;
  duration_minutes: number | null;
  status: "upcoming" | "completed" | "cancelled" | "not_scheduled";
  interview_status: string | null;
  interview_format: "online" | "onsite" | null;
  meeting_link: string | null;
  panel: string[];
  visible_updates: { id: string; body: string; author: string; created_at: string | null }[];
}

/** One mock interview in the candidate's training audit list. No transcript or report text. */
export interface PortalMockSessionSummary {
  id: string;
  session_date: string;
  target_role: string | null;
  round_type: string | null;
  evaluator: string | null;
  overall_score: number | null;
  overall_score_max: number | null;
  feedback_summary: string | null;
  strengths_noted: string | null;
  areas_for_improvement: string | null;
  has_audit_report: boolean;
  has_transcript: boolean;
}

/** One mock interview with its audit report and transcript. */
export interface PortalMockSessionDetail extends PortalMockSessionSummary {
  raw_analysis_text: string | null;
  transcript_raw_text: string | null;
}

/** Response of GET /api/portal/me/training-audit. */
export interface PortalTrainingAudit {
  linked: boolean;
  student: {
    domain: string | null;
    target_role: string | null;
    progress: number;
    synced_at: string | null;
    placement: { company: string | null; role: string | null; date: string | null } | null;
  } | null;
  mockInterviewCount: number;
  mockSessions: PortalMockSessionSummary[];
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Normalises a stored date or timestamp to a YYYY-MM-DD key, or null when it is not a date. */
export function dateKeyOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  return DATE_KEY.test(key) ? key : null;
}

/** Today's calendar date in the candidate's own browser zone. Call only after mount. */
export function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function interviewBucket(interview: PortalInterview, now: Date): ScheduleBucket {
  const status = String(interview.interview_status || "scheduled").toLowerCase();
  if (status === "cancelled" || interview.status === "cancelled") return "cancelled";
  const time = interview.scheduled_at ? Date.parse(interview.scheduled_at) : Number.NaN;
  if (Number.isNaN(time)) return "unscheduled";
  if (status === "completed" || interview.status === "completed" || time <= now.getTime()) return "past";
  return "upcoming";
}

export function interviewToScheduleEvent(interview: PortalInterview, now: Date): ScheduleEvent {
  const bucket = interviewBucket(interview, now);
  const hasTime = bucket !== "unscheduled";
  return {
    key: `interview:${interview.application_id}:${interview.id ?? "unscheduled"}`,
    kind: "interview",
    bucket,
    title: `${interview.round_name || "Interview"}${interview.round_number > 1 ? ` · Round ${interview.round_number}` : ""}`,
    subtitle: `${interview.job_title} · ${interview.company_name || "Company unavailable"}`,
    startsAt: hasTime ? interview.scheduled_at : null,
    dateKey: null,
    timeZone: hasTime ? interview.time_zone : null,
    durationMinutes: interview.duration_minutes,
    format: interview.interview_format,
    location: interview.location,
    meetingLink: interview.meeting_link,
    panel: interview.panel,
    // Opens the application details page, scrolled to this interview's card.
    href: `/portal/applications/${interview.application_id}${interview.id ? `#interview-${interview.id}` : ""}`,
  };
}

export function mockToScheduleEvent(session: PortalMockSessionSummary, dateKey: string, todayKey: string): ScheduleEvent {
  return {
    key: `mock:${session.id}`,
    kind: "mock",
    bucket: dateKey < todayKey ? "past" : "upcoming",
    title: `Mock · ${session.round_type || "Mock interview"}`,
    subtitle: [session.target_role, session.evaluator].filter(Boolean).join(" · ") || "Training audit",
    startsAt: null,
    dateKey,
    timeZone: null,
    durationMinutes: null,
    format: null,
    location: null,
    meetingLink: null,
    panel: session.evaluator ? [session.evaluator] : [],
    href: `/portal/interviews/mock/${session.id}`,
  };
}

/**
 * Builds every schedule item. `zone` decides what "today" means for date-only
 * items (mock sessions), so the calendar uses one reference zone throughout.
 */
export function buildScheduleEvents(
  interviews: PortalInterview[],
  mocks: PortalMockSessionSummary[],
  now: Date,
  zone: string = DEFAULT_DISPLAY_ZONE,
): ScheduleEvent[] {
  const todayKey = zonedDateKey(now.toISOString(), zone) ?? localDateKey(now);
  const events: ScheduleEvent[] = interviews.map((interview) => interviewToScheduleEvent(interview, now));
  for (const session of mocks) {
    const dateKey = dateKeyOf(session.session_date);
    if (dateKey) events.push(mockToScheduleEvent(session, dateKey, todayKey));
  }
  return events;
}

/** Numeric sort key: timed items by instant, all-day items by date, unscheduled last. */
export function eventSortValue(event: ScheduleEvent): number {
  if (event.startsAt) return Date.parse(event.startsAt);
  if (event.dateKey) return Date.parse(`${event.dateKey}T12:00:00Z`);
  return Number.POSITIVE_INFINITY;
}

/** The calendar day an event falls on in the given display zone. */
export function eventDayKey(event: ScheduleEvent, zone: string): string | null {
  if (event.dateKey) return event.dateKey;
  return event.startsAt ? zonedDateKey(event.startsAt, zone) : null;
}

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();

/** Minutes after local midnight for an instant, as seen in the given zone (0-1439). */
export function zonedMinuteOfDay(isoUtc: string, timeZone: string): number | null {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.getTime())) return null;
  let formatter = minuteFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
    minuteFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

export function isDisplayZone(value: unknown): value is DisplayZone {
  return INTERVIEW_TIME_ZONES.some((zone) => zone.value === value);
}

/** The zone the week grid opens in: the next upcoming timed interview's zone, else Eastern. */
export function defaultDisplayZone(events: ScheduleEvent[]): DisplayZone {
  const next = events
    .filter((event) => event.bucket === "upcoming" && event.startsAt && isDisplayZone(event.timeZone))
    .sort((left, right) => eventSortValue(left) - eventSortValue(right))[0];
  return next && isDisplayZone(next.timeZone) ? next.timeZone : DEFAULT_DISPLAY_ZONE;
}

/** Formats an instant's clock time in a zone, e.g. "3:30 PM". Falls back to Eastern for unknown zones. */
export function formatClock(isoUtc: string, timeZone: string | null | undefined): string {
  const zone = isInterviewTimeZone(timeZone) ? timeZone : EASTERN_TIME_ZONE;
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(isoUtc));
}

/** The zone's abbreviation at the given moment, e.g. "EDT" or "CST". */
export function zoneShortName(timeZone: string, at: Date): string {
  const zone = isInterviewTimeZone(timeZone) ? timeZone : EASTERN_TIME_ZONE;
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(at)
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? zone;
}

export function addDaysToKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The seven dates of the Monday-first week that contains the anchor date. */
export function weekKeys(anchorKey: string): string[] {
  const [year, month, day] = anchorKey.split("-").map(Number);
  const sundayBased = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const monday = addDaysToKey(anchorKey, -((sundayBased + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(monday, index));
}

/** UTC-midnight Date for a date-only key, or null for anything that is not a real date. */
function utcDateOf(key: string): Date | null {
  if (!DATE_KEY.test(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Aug 12, 2026" for a date-only key. Parsed at UTC midnight so no zone can shift the day. */
export function formatDateOnly(key: string): string {
  const date = utcDateOf(key);
  if (!date) return key;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatWeekday(key: string): string {
  const date = utcDateOf(key);
  return date ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date) : "";
}

export function dayOfMonth(key: string): number {
  return Number(key.slice(8, 10));
}

export function formatDayHeading(key: string): string {
  const date = utcDateOf(key);
  if (!date) return key;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

export function formatWeekRange(keys: string[]): string {
  const first = new Date(`${keys[0]}T00:00:00Z`);
  const last = new Date(`${keys[keys.length - 1]}T00:00:00Z`);
  const month = (date: Date) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  const year = last.getUTCFullYear();
  if (first.getUTCMonth() === last.getUTCMonth()) {
    return `${month(first)} ${first.getUTCDate()} – ${last.getUTCDate()}, ${year}`;
  }
  return `${month(first)} ${first.getUTCDate()} – ${month(last)} ${last.getUTCDate()}, ${year}`;
}

export interface TimedPlacement<T> {
  item: T;
  startMinute: number;
  endMinute: number;
}

export interface LaidOutPlacement<T> extends TimedPlacement<T> {
  /** Zero-based lane within the overlapping cluster. */
  column: number;
  /** Number of lanes in the cluster, so each block takes 1/columns of the day width. */
  columns: number;
}

/**
 * Places overlapping items side by side, the way Teams and Outlook do: items
 * that overlap form a cluster, and each cluster is split into the fewest lanes
 * that keep overlapping items apart.
 */
export function layoutDayColumns<T>(placements: TimedPlacement<T>[]): LaidOutPlacement<T>[] {
  const sorted = [...placements].sort((left, right) => left.startMinute - right.startMinute || right.endMinute - left.endMinute);
  const result: LaidOutPlacement<T>[] = [];
  let cluster: TimedPlacement<T>[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const placed = cluster.map((placement) => {
      let lane = laneEnds.findIndex((end) => end <= placement.startMinute);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(placement.endMinute);
      } else {
        laneEnds[lane] = placement.endMinute;
      }
      return { ...placement, column: lane };
    });
    for (const item of placed) result.push({ ...item, columns: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const placement of sorted) {
    if (cluster.length > 0 && placement.startMinute >= clusterEnd) flush();
    cluster.push(placement);
    clusterEnd = Math.max(clusterEnd, placement.endMinute);
  }
  flush();
  return result;
}

/** Whole-hour window for the week grid: at least 8 AM to 6 PM, widened to include every event. */
export function gridHourRange(placements: { startMinute: number; endMinute: number }[]): { startHour: number; endHour: number } {
  let startHour = 8;
  let endHour = 18;
  for (const placement of placements) {
    startHour = Math.min(startHour, Math.floor(placement.startMinute / 60));
    endHour = Math.max(endHour, Math.ceil(placement.endMinute / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}

export function clampEndMinute(startMinute: number, durationMinutes: number | null): number {
  return Math.min(startMinute + (durationMinutes ?? DEFAULT_EVENT_MINUTES), 24 * 60);
}
