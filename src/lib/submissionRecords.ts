export const SUBMISSION_RECORD_SCOPE = "extension:submission-records:write";
export const SUBMISSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SENSITIVE_SUBMISSION_FIELD = /password|passwd|passcode|one.?time|\botp\b|\bcvv\b|\bcvc\b|credit.?card|card.?number|cc-number|cc-csc|cc-exp|social.?security|\bssn\b|bank.?account|routing.?number|api.?key|access.?token|secret|security.?answer|verification.?code/i;

export interface SubmissionRecordInput {
  id: string; candidate_id: string; instance_id: string; instance_name: string;
  question: string; answer: string; page_url: string; page_title: string;
  field_key: string; field_type: string; event_type: string; recorded_at: string;
}
export interface SubmissionRecord extends Omit<SubmissionRecordInput, "id"> {
  id: string; event_id: string; received_at: string; recorded_by_name: string | null;
}

export function parseSubmissionRecord(value: unknown): SubmissionRecordInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid record.");
  const raw = value as Record<string, unknown>;
  const limits = { id: 36, candidate_id: 36, instance_id: 36, instance_name: 120, question: 1000,
    answer: 100000, page_url: 4096, page_title: 1000, field_key: 1000, field_type: 80, event_type: 20, recorded_at: 40 };
  const out: Record<string, string> = {};
  for (const [field, limit] of Object.entries(limits)) {
    const v = raw[field];
    if (typeof v !== "string" || v.length > limit || v.includes("\u0000")) throw new Error(`Invalid ${field}.`);
    out[field] = v;
  }
  if (![out.id, out.candidate_id, out.instance_id].every(id => SUBMISSION_UUID.test(id))) throw new Error("Invalid record identity.");
  for (const field of ["id", "candidate_id", "instance_id"]) out[field] = out[field].toLowerCase();
  if (!out.question.trim() || !out.instance_name.trim()) throw new Error("Question and browser name are required.");
  if (!["input", "change", "focusout", "submit"].includes(out.event_type)) throw new Error("Invalid record action.");
  if (!Number.isFinite(Date.parse(out.recorded_at)) || !/^\d{4}-\d{2}-\d{2}T/.test(out.recorded_at)) throw new Error("Invalid recording time.");
  if (Date.parse(out.recorded_at) > Date.now() + 86400000) throw new Error("The recording time is in the future. Check the device clock.");
  const url = new URL(out.page_url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("An HTTPS source page is required.");
  out.page_url = url.origin + url.pathname;
  out.recorded_at = new Date(out.recorded_at).toISOString();
  if (SENSITIVE_SUBMISSION_FIELD.test(`${out.question} ${out.field_key} ${out.field_type}`) || ["hidden", "password", "file"].includes(out.field_type)) return null;
  return out as unknown as SubmissionRecordInput;
}

export async function submissionRecordHash(record: SubmissionRecordInput): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(record)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
