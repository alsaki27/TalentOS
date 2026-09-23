// Client for the spare-PC audit-db HTTP bridge (see audit-db-service/src/main.py).
// Cloudflare Workers can only fetch(), never open a raw TCP Postgres socket,
// so the audit database — migrated off the old skarion-student-audit tool's
// Neon project — is fronted by a small FastAPI service reached over the
// existing Cloudflare Tunnel, the same way @neondatabase/serverless reaches
// Talentos' own Neon DB over HTTP.

function getBaseUrl(): string {
  const url = process.env.AUDIT_DB_URL;
  if (!url) throw new Error("AUDIT_DB_URL is not configured");
  return url.replace(/\/$/, "");
}

function getToken(): string {
  const token = process.env.AUDIT_DB_TOKEN;
  if (!token) throw new Error("AUDIT_DB_TOKEN is not configured");
  return token;
}

async function bridgeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`audit-db bridge ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface AuditStudent {
  id: string;
  talentos_candidate_id: string | null;
  name: string;
  joining_date: string | null;
  progress: number;
  mock_interviews: number;
  rating: string;
  placement_company: string;
  placement_role: string;
  placement_date: string;
  domain: string | null;
  target_role: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditStickyNote {
  id: string;
  student_id: string;
  date: string;
  content: string;
  category: string;
  author: string;
  accent: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuditMockSession {
  id: string;
  student_id: string;
  session_date: string;
  target_role: string | null;
  overall_score: number | null;
  overall_score_max: number | null;
  summary: string | null;
  raw_analysis_text: string | null;
  created_by: string;
  created_at: string;
}

export interface AuditTranscriptLine {
  id: string;
  seq: number;
  speaker: string;
  is_candidate: boolean;
  timestamp_ms: number | null;
  text: string;
}

export interface AuditTranscript {
  id: string;
  session_id: string;
  source: "teams" | "zoom" | "meet" | "other";
  raw_text: string;
  created_at: string;
  lines: AuditTranscriptLine[];
}

export interface AuditReport {
  session_id: string;
  metrics: unknown[];
  strengths: string[];
  weaknesses: string[];
  action_items: string[];
  parsed_at: string;
}

export interface AuditMockSessionDetail extends AuditMockSession {
  transcripts: AuditTranscript[];
  report: AuditReport | null;
}

export interface AuditCalendarEvent {
  id: string;
  student_id: string;
  event_date: string;
  duration_min: number | null;
  title: string;
  description: string | null;
  event_type: string;
  linked_session_id: string | null;
  created_by: string;
  created_at: string;
}

export async function findAuditStudentByCandidateId(candidateId: string): Promise<AuditStudent | null> {
  const students = await bridgeFetch<AuditStudent[]>(
    `/students?talentos_candidate_id=${encodeURIComponent(candidateId)}`
  );
  return students[0] ?? null;
}

export async function linkAuditStudent(studentId: string, candidateId: string): Promise<AuditStudent> {
  return bridgeFetch<AuditStudent>(
    `/candidate-map/${encodeURIComponent(studentId)}?talentos_candidate_id=${encodeURIComponent(candidateId)}`,
    { method: "POST" }
  );
}

export async function patchAuditStudent(
  studentId: string,
  patch: Partial<Pick<AuditStudent, "progress" | "rating" | "placement_company" | "placement_role" | "placement_date" | "domain" | "target_role">>
): Promise<AuditStudent> {
  return bridgeFetch<AuditStudent>(`/students/${encodeURIComponent(studentId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function listStickyNotes(studentId: string): Promise<AuditStickyNote[]> {
  return bridgeFetch<AuditStickyNote[]>(`/sticky-notes?student_id=${encodeURIComponent(studentId)}`);
}

export async function createStickyNote(body: {
  student_id: string;
  date: string;
  content: string;
  category?: string;
  author?: string;
  accent?: string;
  pinned?: boolean;
}): Promise<AuditStickyNote> {
  return bridgeFetch<AuditStickyNote>("/sticky-notes", { method: "POST", body: JSON.stringify(body) });
}

export async function patchStickyNote(
  noteId: string,
  body: Partial<Pick<AuditStickyNote, "content" | "category" | "accent" | "pinned">>
): Promise<AuditStickyNote> {
  return bridgeFetch<AuditStickyNote>(`/sticky-notes/${encodeURIComponent(noteId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteStickyNote(noteId: string): Promise<void> {
  await bridgeFetch(`/sticky-notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
}

export async function listMockSessions(studentId: string): Promise<AuditMockSession[]> {
  return bridgeFetch<AuditMockSession[]>(`/mock-sessions?student_id=${encodeURIComponent(studentId)}`);
}

export async function getMockSession(sessionId: string): Promise<AuditMockSessionDetail> {
  return bridgeFetch<AuditMockSessionDetail>(`/mock-sessions/${encodeURIComponent(sessionId)}`);
}

export async function listCalendarEvents(studentId: string): Promise<AuditCalendarEvent[]> {
  return bridgeFetch<AuditCalendarEvent[]>(`/calendar-events?student_id=${encodeURIComponent(studentId)}`);
}

export async function createCalendarEvent(body: {
  student_id: string;
  event_date: string;
  duration_min?: number | null;
  title: string;
  description?: string | null;
  event_type?: string;
  linked_session_id?: string | null;
  created_by: string;
}): Promise<AuditCalendarEvent> {
  return bridgeFetch<AuditCalendarEvent>("/calendar-events", { method: "POST", body: JSON.stringify(body) });
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await bridgeFetch(`/calendar-events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
}

export interface AuditAnalyticsSession {
  id: string;
  session_date: string;
  overall_score: number | null;
  created_by: string;
  student_id: string;
  student_name: string;
}

export interface AuditAnalyticsWeakness {
  theme: string | null;
  student_id: string;
}

export async function getAuditAnalyticsSummary(
  days = 90
): Promise<{ sessions: AuditAnalyticsSession[]; weaknesses: AuditAnalyticsWeakness[] }> {
  return bridgeFetch(`/analytics/audit-summary?days=${days}`);
}

export interface AuditLowScoreStudent {
  student_id: string;
  name: string;
  talentos_candidate_id: string | null;
  overall_score: number;
  session_date: string;
}

export async function getLowScoreStudents(threshold = 6, limit = 25): Promise<AuditLowScoreStudent[]> {
  return bridgeFetch(`/analytics/low-scores?threshold=${threshold}&limit=${limit}`);
}

export async function createAuditStudent(body: {
  talentos_candidate_id: string;
  name: string;
  domain?: string | null;
  target_role?: string | null;
}): Promise<AuditStudent> {
  return bridgeFetch<AuditStudent>("/students", { method: "POST", body: JSON.stringify(body) });
}

export async function createMockSession(body: {
  student_id: string;
  session_date: string;
  target_role?: string | null;
  overall_score?: number | null;
  overall_score_max?: number | null;
  summary?: string | null;
  raw_analysis_text?: string | null;
  created_by: string;
}): Promise<AuditMockSession> {
  return bridgeFetch<AuditMockSession>("/mock-sessions", { method: "POST", body: JSON.stringify(body) });
}

export async function addTranscript(
  sessionId: string,
  body: {
    source: "teams" | "zoom" | "meet" | "other";
    raw_text: string;
    lines: Array<{ seq: number; speaker: string; is_candidate: boolean; timestamp_ms: number | null; text: string }>;
  }
): Promise<AuditTranscript> {
  return bridgeFetch<AuditTranscript>(`/mock-sessions/${encodeURIComponent(sessionId)}/transcripts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function upsertAuditReport(
  sessionId: string,
  body: { metrics: unknown[]; strengths: unknown[]; weaknesses: unknown[]; action_items: unknown[] }
): Promise<AuditReport> {
  return bridgeFetch<AuditReport>(`/mock-sessions/${encodeURIComponent(sessionId)}/report`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
