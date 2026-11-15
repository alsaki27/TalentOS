import { zonedDateTimeToUtcIso } from "@/lib/easternTime";

const windowsZones: Record<string, string> = {
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
};

export interface InterviewCalendarInvite {
  key: string;
  sequence: number;
  versionAt: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  timeZone: string | null;
  cancelled: boolean;
}

interface CalendarProperty {
  value: string;
  params: string;
}

function calendarDate(property?: CalendarProperty) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(property?.value ?? "");
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  const tzid = /(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i.exec(property?.params ?? "");
  const zone = tzid?.[1] ?? tzid?.[2] ?? "";
  const timeZone = utc ? "UTC" : windowsZones[zone] ?? zone;
  if (!timeZone || Number(second) > 59) return null;
  const value = zonedDateTimeToUtcIso(`${year}-${month}-${day}`, `${hour}:${minute}`, timeZone);
  return value ? { time: new Date(Date.parse(value) + Number(second) * 1000).toISOString(), timeZone } : null;
}

/** Only a single event with explicit identity supplies evidence for an update. */
export function parseInterviewCalendarInvite(text: string): InterviewCalendarInvite | null {
  if (text.length > 256 * 1024) return null;
  const lines = text.replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const stack: string[] = [];
  const fields = new Map<string, CalendarProperty>();
  let method = "";
  let eventCount = 0;
  for (const line of lines) {
    const marker = /^(BEGIN|END):([A-Z-]+)$/i.exec(line.trim());
    if (marker) {
      const [, verb, component] = marker.map((value) => value.toUpperCase());
      if (verb === "BEGIN") {
        if (component === "VEVENT" && stack.at(-1) === "VCALENDAR") eventCount++;
        stack.push(component);
      } else if (stack.pop() !== component) return null;
      continue;
    }
    const property = /^([\w-]+)(;[^:]*)?:(.*)$/.exec(line);
    if (!property) continue;
    const [, name, params = "", value] = property;
    if (stack.length === 1 && stack[0] === "VCALENDAR" && name.toUpperCase() === "METHOD") method = value.trim().toUpperCase();
    if (stack.length === 2 && stack[0] === "VCALENDAR" && stack[1] === "VEVENT") {
      const key = name.toUpperCase();
      if (fields.has(key) && ["UID", "DTSTART", "RECURRENCE-ID", "SEQUENCE"].includes(key)) return null;
      fields.set(key, { value: value.trim(), params });
    }
  }
  const uid = fields.get("UID")?.value;
  if (stack.length || eventCount !== 1 || !uid || uid.length > 1024 || !["", "REQUEST", "PUBLISH", "CANCEL"].includes(method)) return null;
  const recurrence = fields.get("RECURRENCE-ID");
  const instance = calendarDate(recurrence)?.time;
  if (recurrence && !instance) return null;
  // A recurrence rule without a specific occurrence cannot identify one interview.
  if (fields.has("RRULE") && !instance) return null;
  const rawSequence = fields.get("SEQUENCE")?.value ?? "0";
  const sequence = Number(rawSequence);
  if (!/^\d+$/.test(rawSequence) || sequence > 2147483647) return null;
  const start = calendarDate(fields.get("DTSTART"));
  const end = calendarDate(fields.get("DTEND"));
  const minutes = start && end ? Math.round((Date.parse(end.time) - Date.parse(start.time)) / 60000) : 0;
  return {
    key: JSON.stringify([uid, instance ?? null]),
    sequence,
    versionAt: (calendarDate(fields.get("LAST-MODIFIED")) ?? calendarDate(fields.get("DTSTAMP")))?.time ?? null,
    scheduledAt: start?.time ?? null,
    durationMinutes: minutes > 0 && minutes <= 480 ? minutes : null,
    timeZone: start?.timeZone ?? null,
    cancelled: method === "CANCEL" || fields.get("STATUS")?.value.toUpperCase() === "CANCELLED",
  };
}

export function getSingleInterviewCalendarInvite(parts: string[]): InterviewCalendarInvite | null {
  const invites = parts.map(parseInterviewCalendarInvite);
  if (invites.some((invite) => !invite)) return null;
  const unique = new Map(invites.map((invite) => [JSON.stringify(invite), invite]));
  return unique.size === 1 ? unique.values().next().value ?? null : null;
}

/** Actalent's plain-text confirmations and revisions share a booking link. */
export async function getInterviewBookingIdentity(text: string): Promise<string | null> {
  const matches = text.matchAll(/https:\/\/talentassistant\.actalentservices\.com\/assistant\/bookings\/(?:reschedule|cancel)\/([A-Za-z0-9_-]{8,80})(?=[\s<>()[\]"'?,]|$)/gi);
  const ids = new Set(Array.from(matches, (match) => match[1]));
  if (ids.size !== 1) return null;
  const [id] = ids;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return "actalent-booking:" + fingerprint;
}
