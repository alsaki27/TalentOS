import { getTeamRoleKey, isTeamRoleKey } from "@/lib/auth-edge";
import { activityDate, safeActivityUrl } from "@/lib/candidateActivity";
import { zonedDateTimeToUtcIso } from "@/lib/easternTime";

export type CustomActivitySchedule = "none" | "date" | "date_range" | "time_range";
export interface CandidateCustomActivity {
  id: string; candidate_id: string; title: string; body: string; link: string | null;
  schedule_mode: CustomActivitySchedule; start_date: string | null; end_date: string | null;
  starts_at: string | null; ends_at: string | null; time_zone: string | null;
  version: number; created_at: string; updated_at: string;
}
export function canManageCustomActivity(profile: { role?: string; role_variant?: string | null } | null | undefined) {
  return Boolean(profile?.role && isTeamRoleKey(profile.role) && profile.role !== "application_engineer_grunter"
    && getTeamRoleKey(profile.role, profile.role_variant) !== "application_engineer_grunter");
}
export function customActivityState(activity: CandidateCustomActivity, now = new Date()) {
  if (activity.schedule_mode === "none") return null;
  if (activity.schedule_mode === "time_range") return now < new Date(activity.starts_at!) ? "upcoming" : now > new Date(activity.ends_at!) ? "completed" : "in_progress";
  const parts = new Intl.DateTimeFormat("en", { timeZone: activity.time_zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)?.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return today < activity.start_date! ? "upcoming" : today > (activity.end_date || activity.start_date!) ? "completed" : "in_progress";
}
export function parseCustomActivity(input: unknown) {
  const value = input as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter activity details.");
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!title || title.length > 160) throw new Error("A title of up to 160 characters is required.");
  if (!body || body.length > 20000) throw new Error("A reason or description of up to 20,000 characters is required.");
  const rawLink = typeof value.link === "string" ? value.link.trim() : "";
  const link = rawLink ? safeActivityUrl(rawLink) : null;
  if (rawLink && (rawLink.length > 2000 || !link || !/^https?:\/\//i.test(link))) throw new Error("Enter a complete http or https link.");
  const mode = value.schedule_mode ?? "none";
  if (!["none", "date", "date_range", "time_range"].includes(String(mode))) throw new Error("Choose a valid date option.");
  let start: string | null = null, end: string | null = null, startsAt: string | null = null, endsAt: string | null = null, zone: string | null = null;
  if (mode !== "none") {
    zone = typeof value.time_zone === "string" ? value.time_zone : "";
    try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { throw new Error("Choose a valid time zone."); }
    start = activityDate(value.start_date);
    if (!start || start.length !== 10 || start.startsWith("0000-")) throw new Error("Enter a valid start date.");
    if (mode === "date_range" || mode === "time_range") {
      end = activityDate(value.end_date);
      if (!end || end.length !== 10 || end < start) throw new Error("The end date must be on or after the start date.");
    }
    if (mode === "time_range") {
      startsAt = zonedDateTimeToUtcIso(start, String(value.start_time || ""), zone);
      endsAt = zonedDateTimeToUtcIso(end!, String(value.end_time || ""), zone);
      if (!startsAt || !endsAt || endsAt <= startsAt) throw new Error("Enter an end time after the start time. Choose an unambiguous time if clocks change that day.");
      start = null; end = null;
    }
  }
  return { title, body, link, schedule_mode: mode as CustomActivitySchedule, start_date: start, end_date: end, starts_at: startsAt, ends_at: endsAt, time_zone: zone };
}
