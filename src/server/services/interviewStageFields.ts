import { INTERVIEW_STAGE_STATUS, safeMeetingUrl } from "@/lib/applicationInterviewPreparation";

export const INTERVIEW_STAGE_COLUMNS = `id, round_number, round_name, scheduled_at, time_zone, duration_minutes, status,
       interview_format, location, meeting_link, notes, preparation_notes, rescheduled_at, created_at,
       (to_jsonb(interview_schedules)->>'mock_interview_taken')::boolean AS mock_interview_taken,
       to_jsonb(interview_schedules)->>'previous_scheduled_at' AS previous_scheduled_at,
       to_jsonb(interview_schedules)->>'previous_time_zone' AS previous_time_zone`;

export const INTERVIEW_STAGE_COLUMNS_S = `s.id, s.round_number, s.round_name, s.scheduled_at, s.time_zone, s.duration_minutes, s.status,
       s.interview_format, s.location, s.meeting_link, s.notes, s.preparation_notes, s.rescheduled_at, s.created_at,
       (to_jsonb(s)->>'mock_interview_taken')::boolean AS mock_interview_taken,
       to_jsonb(s)->>'previous_scheduled_at' AS previous_scheduled_at,
       to_jsonb(s)->>'previous_time_zone' AS previous_time_zone`;

export function parsePreparationFields(body: Record<string, unknown>) {
  const fields: Record<string, string | number | null> = {};
  const textFields = [
    ["roundName", "round_name", 120],
    ["location", "location", 500],
    ["meetingLink", "meeting_link", 2000],
    ["preparationNotes", "preparation_notes", 10000],
  ] as const;
  for (const [input, column, limit] of textFields) {
    if (!(input in body)) continue;
    const value = body[input];
    if (value !== null && (typeof value !== "string" || value.trim().length > limit)) {
      throw new Error(`${input} must be at most ${limit} characters.`);
    }
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (input === "roundName" && !trimmed) throw new Error("Enter a round name.");
    if (input === "meetingLink" && trimmed && !safeMeetingUrl(trimmed)) throw new Error("Enter a valid HTTP or HTTPS meeting link.");
    fields[column] = trimmed || null;
  }
  if ("durationMinutes" in body) {
    const value = body.durationMinutes;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1440) {
      throw new Error("Duration must be between 1 and 1,440 minutes.");
    }
    fields.duration_minutes = value;
  }
  if ("status" in body) {
    if (typeof body.status !== "string" || !Object.hasOwn(INTERVIEW_STAGE_STATUS, body.status)) {
      throw new Error("Choose a valid interview status.");
    }
    fields.status = body.status;
  }
  return fields;
}
