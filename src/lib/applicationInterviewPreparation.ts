export const MAX_PREPARATION_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_INTERVIEW_AUDIO_MB = 300;
export const AUDIO_SIZE_ERROR = `Recordings must be ${MAX_INTERVIEW_AUDIO_MB} MB or smaller.`;
export const MAX_INTERVIEW_AUDIO_BYTES = MAX_INTERVIEW_AUDIO_MB * 1024 * 1024;
// Microsoft Graph requires non-final fragments to be multiples of 320 KiB.
export const INTERVIEW_AUDIO_CHUNK_BYTES = 16 * 320 * 1024;

export const INTERVIEW_STAGE_STATUS: Record<string, string> = {
  planned: "Planned",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

export interface InterviewPreparationFile {
  id: string;
  schedule_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  visible_to_candidate: boolean;
}

export interface ApplicationInterviewStage {
  id: string;
  round_number: number;
  round_name: string;
  scheduled_at: string | null;
  time_zone: string | null;
  duration_minutes: number | null;
  status: string | null;
  interview_format: "online" | "onsite" | null;
  location: string | null;
  meeting_link: string | null;
  notes: string | null;
  preparation_notes: string | null;
  rescheduled_at: string | null;
  previous_scheduled_at: string | null;
  previous_time_zone: string | null;
  mock_interview_taken: boolean | null;
}

export function isInterviewAudio(file: InterviewPreparationFile) {
  return file.content_type.startsWith("audio/");
}

export function safeMeetingUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
