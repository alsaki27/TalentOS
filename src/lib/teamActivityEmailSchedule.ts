import type { TeamActivityPeriod } from "@/lib/teamActivityEmailReport";

const EASTERN_TIME_ZONE = "America/New_York";

/**
 * Return the report periods due at a Cloudflare Cron scheduled instant.
 * Use scheduledTime rather than wall-clock execution time so minor platform
 * dispatch latency does not move or skip the requested Eastern schedule.
 */
export function getDueTeamActivityReportPeriods(scheduledAt: Date): TeamActivityPeriod[] {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(scheduledAt);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  if (values.minute !== "00") return [];
  if (values.hour === "17") return ["daily"];
  if (values.weekday === "Sun" && values.hour === "18") return ["weekly"];
  return [];
}
