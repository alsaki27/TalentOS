export const QUEUE_ACTIVITY_WINDOWS = [
  { value: "30m", label: "Past 30 minutes", minutes: 30 },
  { value: "1h", label: "Past 1 hour", minutes: 60 },
  { value: "2h", label: "Past 2 hours", minutes: 120 },
  { value: "3h", label: "Past 3 hours", minutes: 180 },
  { value: "12h", label: "Past 12 hours", minutes: 720 },
  { value: "24h", label: "Past 24 hours", minutes: 1440 },
  { value: "3d", label: "Past 3 days", minutes: 4320 },
  { value: "7d", label: "Past 7 days", minutes: 10080 },
] as const;

export const DEFAULT_QUEUE_SORT = "ae_review_pending_newest";
// Keep the existing API value for oldest-first ordering.
export type QueueSort = typeof DEFAULT_QUEUE_SORT | "ae_review_pending" | "due" | "final_score" | "average_score";

export function parseQueueSort(value: string | null | undefined): QueueSort {
  if (value === "ae_review_pending" || value === "due" || value === "final_score" || value === "average_score") return value;
  return DEFAULT_QUEUE_SORT;
}
