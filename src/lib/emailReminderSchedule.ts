const TIME_ZONE = "Asia/Dhaka";

export interface DueEmailReminderSlot {
  key: string;
  scheduledAt: Date;
  windowStart: Date;
  windowEnd: Date;
}

/** Digest slots are 08:00 and 20:00 Bangladesh time; retries reuse the same
 * slot key during the first 15 minutes. */
export function getDueEmailReminderSlot(scheduledAt: Date): DueEmailReminderSlot | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(scheduledAt);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (!values.minute || Number(values.minute) > 14 || !["08", "20"].includes(values.hour || "")) return null;

  const key = `${values.year}-${values.month}-${values.day}T${values.hour}:00+06:00`;
  const windowEnd = new Date(scheduledAt.getTime() - Number(values.minute) * 60_000);
  return {
    key,
    scheduledAt: windowEnd,
    windowStart: new Date(windowEnd.getTime() - 12 * 60 * 60_000),
    windowEnd,
  };
}
