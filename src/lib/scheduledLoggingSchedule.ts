/** UTC+6 has no daylight saving changes. All daily keys use Bangladesh dates. */
export function scheduledLoggingDay(date = new Date()) {
  const local = new Date(date.getTime() + 6 * 60 * 60_000);
  return { day:local.toISOString().slice(0,10),due:local.getUTCHours() >= 5 };
}
