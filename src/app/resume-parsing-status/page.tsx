"use client";

import { useEffect, useState, useRef, useCallback, memo } from "react";
import Link from "next/link";
import { APPLICATION_AGENT_METAS } from "@/lib/ai/application-agents/types";
import { openFaloodStudio } from "@/lib/falood/openStudio";

interface WorkflowCard {
  id: string;
  application_id: string;
  base_resume_id: string | null;
  status: string;
  current_stage: number;
  last_error: string | null;
  updated_at: string;
  match_score: number | null;
  match_reason: string | null;
  candidate_name: string | null;
  job_title: string | null;
  job_company: string | null;
  tailored_resume_version_id: string | null;
  ats_score: number | null;
  role_fit_score: number | null;
}

interface ColumnDef {
  id: string;
  label: string;
  color: string;
  getStage: (wf: WorkflowCard) => boolean;
}

// current_stage is 0-indexed into APPLICATION_AGENT_IDS (job_lens=0,
// resume_forge=1, hiring_panel=2, final_polish=3) - it names the stage
// currently running/about to run. Confirmed live: this board previously
// shifted every column by one (a workflow whose stage_run was already
// application_resume_forge still showed in the "Job Lens" column), making
// an entire in-progress batch look stuck a step earlier than it really was.
// "Queued" means status === "queued", regardless of which stage it's queued
// for - not "stage 0", which is also what a *running* Job Lens looks like.
const COLUMNS: ColumnDef[] = [
  { id: "queued", label: "Queued", color: "var(--muted)", getStage: (w) => w.status === "queued" && (w.current_stage === 0 || w.current_stage == null) },
  { id: "job_lens", label: "Job Lens", color: "var(--info)", getStage: (w) => (w.current_stage === 0 && w.status !== "queued") && w.status !== "completed" && w.status !== "failed" },
  { id: "resume_forge", label: "Resume Forge", color: "#7c5cff", getStage: (w) => w.current_stage === 1 && w.status !== "completed" && w.status !== "failed" },
  { id: "hiring_panel", label: "Hiring Panel", color: "#e09f3e", getStage: (w) => w.current_stage === 2 && w.status !== "completed" && w.status !== "failed" },
  { id: "final_polish", label: "Final Polish", color: "#2a9d8f", getStage: (w) => w.current_stage === 3 && w.status !== "completed" && w.status !== "failed" },
  { id: "completed", label: "Completed", color: "var(--success)", getStage: (w) => w.status === "completed" },
  { id: "failed", label: "Failed", color: "var(--danger)", getStage: (w) => w.status === "failed" },
];

const STAGE_TO_COLUMN: Record<number, string> = { 0: "queued", 1: "job_lens", 2: "resume_forge", 3: "hiring_panel", 4: "final_polish", 5: "completed" };
const COLUMN_TO_STAGE: Record<string, number> = { queued: 0, job_lens: 1, resume_forge: 2, hiring_panel: 3, final_polish: 4, completed: 5 };

// updateWorkflowStatus() sets `updated_at = NOW()` on every status/stage
// transition (queued->running, stage advance, ->completed, ->failed) - so
// it doubles as "entered current bucket" without a separate per-stage
// timestamp fetch. Uses the viewer's own browser locale/timezone (not a
// fixed one) since this board has international users - each person sees
// their own local time, not a hardcoded zone.
const cardTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
function formatCardTime(iso: string): string {
  try {
    return cardTimeFormatter.format(new Date(iso));
  } catch {
    return iso;
  }
}

function scoreBadgeColor(score: number): "success" | "warning" | "danger" {
  if (score >= 7) return "success";
  if (score >= 4) return "warning";
  return "danger";
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "completed" ? "badge-success" : status === "failed" ? "badge-danger" : status === "running" ? "badge-info" : "badge-warning";
  return <span className={`badge ${cls}`} style={{ fontSize: 10 }}>{status}</span>;
}

export default function ResumeParsingStatusPage() {
  const [workflows, setWorkflows] = useState<WorkflowCard[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [findingsOpen, setFindingsOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    fetchActive();
    pollRef.current = setInterval(fetchActive, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function fetchActive() {
    try {
      const res = await fetch("/api/application-ai-workflows/active", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();

      // The server's own self-fetch dispatch (a Worker calling its own URL
      // from within this same GET request) is unreliable in production -
      // confirmed live, workflows sat queued for 5+ minutes with this page
      // open and polling the whole time. A real client-initiated POST
      // never failed once in the same testing, so fire it directly instead
      // of hoping the server-side one landed. Fire-and-forget: the next
      // 6s poll picks up whatever it advanced.
      if (data.needsDispatch) {
        fetch("/api/application-ai-workflows/dispatch", { method: "POST" }).catch(() => {});
      }

      const incoming: WorkflowCard[] = data.workflows ?? [];
      setWorkflows((prev) => {
        const prevMap = new Map(prev.map((w) => [w.id, w]));
        const updated: WorkflowCard[] = [];
        for (const w of incoming) {
          const existing = prevMap.get(w.id);
          if (!existing || existing.updated_at !== w.updated_at) {
            updated.push({ ...w });
          } else {
            updated.push(existing);
          }
        }
        if (updated.length !== prev.length) return updated;
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].updated_at !== prev[i]?.updated_at) return updated;
        }
        return prev;
      });
      setLoading(false);
    } catch { /* */ }
  }

  const ensureDetails = useCallback((id: string) => {
    if (fetchedIds.current.has(id)) return;
    fetchedIds.current.add(id);
    fetch(`/api/application-ai-workflows/${id}?action=status`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setDetails((cur) => ({ ...cur, [id]: data })); })
      .catch(() => { fetchedIds.current.delete(id); });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((cur) => (cur === id ? null : id));
    ensureDetails(id);
  }, [ensureDetails]);

  const toggleFindings = useCallback((id: string) => {
    setFindingsOpen((cur) => (cur === id ? null : id));
    ensureDetails(id);
  }, [ensureDetails]);

  // Manual override — drag-drop a card to a new column
  async function handleDrop(targetColumnId: string) {
    const wfId = draggingId;
    setDragOverCol(null);
    setDraggingId(null);
    if (!wfId) return;

    const wf = workflows.find((w) => w.id === wfId);
    if (!wf) return;

    // No-op if dropping back on same column
    const currentColId = wf.status === "failed" ? "failed"
      : wf.status === "completed" ? "completed"
      : STAGE_TO_COLUMN[wf.current_stage ?? 0] ?? "queued";
    if (currentColId === targetColumnId) return;

    // "failed" is a terminal state — can't move INTO it manually
    if (targetColumnId === "failed") return;

    const targetStage = COLUMN_TO_STAGE[targetColumnId] ?? 0;
    setMoving(wfId);

    // Optimistic update
    setWorkflows((prev) => prev.map((w) =>
      w.id === wfId
        ? { ...w, current_stage: targetStage, status: targetStage === 5 ? "completed" : "waiting" }
        : w
    ));

    try {
      const res = await fetch(`/api/application-ai-workflows/${wfId}?action=move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: targetStage }),
      });
      if (!res.ok) {
        await res.json().catch(() => ({}));
        // Rollback
        setWorkflows((prev) => prev.map((w) => w.id === wfId ? { ...w, current_stage: wf.current_stage, status: wf.status } : w));
      }
    } catch {
      // Rollback
      setWorkflows((prev) => prev.map((w) => w.id === wfId ? { ...w, current_stage: wf.current_stage, status: wf.status } : w));
    } finally {
      setMoving(null);
    }
  }

  return (
    <div className="resume-parsing-status-page" style={{ padding: "12px", width: "100%" }}>
      <div className="page-header" style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0, fontWeight: 700 }}>AI Resume Parsing Status</h1>
          <span className="muted" style={{ fontSize: 14, display: "inline-block", marginTop: 4 }}>Kanban board — drag cards to manually override stage · auto-refresh every 6s</span>
        </div>
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && workflows.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">No active or recent workflows. Log an application with a base resume to start one.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {COLUMNS.map((col) => {
          const colCards = workflows.filter(col.getStage);
          return (
            <div
              key={col.id}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOverCol(null); }}
              onDrop={() => handleDrop(col.id)}
              style={{
                flex: "0 0 280px",
                minHeight: 200,
                background: "var(--surface-1)",
                borderRadius: 12,
                border: `1px solid ${dragOverCol === col.id ? col.color : "var(--border)"}`,
                boxShadow: dragOverCol === col.id ? `0 0 0 2px ${col.color}33` : "none",
                display: "flex",
                flexDirection: "column",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
            >
              <div style={{
                padding: "10px 12px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderRadius: "12px 12px 0 0",
              }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: col.color }}>{col.label}</span>
                <span className="badge" style={{ fontSize: 12, background: "var(--surface-3)", padding: "2px 8px" }}>{colCards.length}</span>
              </div>
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1, maxHeight: "calc(100vh - 220px)" }}>
                {colCards.length === 0 && (
                  <div className="muted" style={{ fontSize: 13, textAlign: "center", padding: "30px 0" }}>Empty</div>
                )}
                {colCards.map((wf) => (
                  <BoardCard
                    key={wf.id}
                    wf={wf}
                    isExpanded={expanded === wf.id}
                    isFindingsOpen={findingsOpen === wf.id}
                    detail={details[wf.id]}
                    isDragging={draggingId === wf.id}
                    isMoving={moving === wf.id}
                    onToggleExpand={toggleExpand}
                    onToggleFindings={toggleFindings}
                    onDragStart={() => setDraggingId(wf.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BoardCard = memo(function BoardCard({
  wf, isExpanded, isFindingsOpen, detail, isDragging, isMoving, onToggleExpand, onToggleFindings, onDragStart, onDragEnd,
}: {
  wf: WorkflowCard;
  isExpanded: boolean;
  isFindingsOpen: boolean;
  detail: any;
  isDragging: boolean;
  isMoving: boolean;
  onToggleExpand: (id: string) => void;
  onToggleFindings: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable={!isMoving}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", wf.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      style={{
        padding: 14,
        borderRadius: 8,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        cursor: isMoving ? "wait" : "grab",
        opacity: isDragging ? 0.4 : isMoving ? 0.6 : 1,
        borderLeft: wf.status === "failed" ? "4px solid var(--danger)" : wf.status === "completed" ? "4px solid var(--success)" : wf.status === "running" ? "4px solid var(--info)" : "4px solid transparent",
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>
            {wf.candidate_name ?? `WF ${wf.id.slice(0, 8)}`}
          </div>
          <div className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {wf.job_title ?? "—"} {wf.job_company ? ` · ${wf.job_company}` : ""}
          </div>
        </div>
        <StatusBadge status={wf.status} />
      </div>

      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }} title={new Date(wf.updated_at).toISOString()}>
        {wf.status === "completed" ? "Completed" : wf.status === "failed" ? "Failed" : "Entered stage"} {formatCardTime(wf.updated_at)}
      </div>

      {wf.match_reason && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {wf.match_score != null ? `Score ${wf.match_score}: ` : ""}{wf.match_reason}
        </div>
      )}

      {(wf.ats_score != null || wf.role_fit_score != null) && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {wf.ats_score != null && (
            <span className={`badge badge-${scoreBadgeColor(wf.ats_score)}`} style={{ fontSize: 11, padding: "2px 6px" }}>
              ATS {wf.ats_score}/10
            </span>
          )}
          {wf.role_fit_score != null && (
            <span className={`badge badge-${scoreBadgeColor(wf.role_fit_score)}`} style={{ fontSize: 11, padding: "2px 6px" }}>
              Fit {wf.role_fit_score}/10
            </span>
          )}
        </div>
      )}

      {wf.last_error && (
        <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(211, 38, 30, 0.08)", color: "var(--danger)", fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>
          {wf.last_error}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn" style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }} onClick={() => onToggleExpand(wf.id)}>
          {isExpanded ? "▼ Details" : "▶ Details"}
        </button>
        {(wf.current_stage ?? 0) >= 3 && (
          <button className="btn" style={{ fontSize: 12, padding: "4px 10px", minHeight: 28 }} onClick={() => onToggleFindings(wf.id)}>
            Findings
          </button>
        )}
        {wf.status === "completed" && wf.tailored_resume_version_id && (
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: "4px 12px", minHeight: 28 }}
            onClick={() => openFaloodStudio("application_resume_version", wf.tailored_resume_version_id!)}
          >
            Studio
          </button>
        )}
      </div>

      {isFindingsOpen && <FindingsPanel details={detail} />}

      {isExpanded && detail && (
        <div style={{ marginTop: 12, padding: 10, background: "var(--surface-3)", borderRadius: 6, fontSize: 12 }}>
          {(detail.stages || []).length === 0 && <div className="muted">No stage runs yet.</div>}
          {(() => {
            const stages = detail.stages || [];
            const deduped = new Map<number, any>();
            for (const s of stages) {
              const existing = deduped.get(s.sequence_number);
              if (!existing || s.attempt_number > existing.attempt_number) {
                deduped.set(s.sequence_number, s);
              }
            }
            return Array.from(deduped.values()).map((s: any, i: number) => {
              const meta = APPLICATION_AGENT_METAS[s.automation_id as keyof typeof APPLICATION_AGENT_METAS];
              const label = meta?.displayName ?? `Stage ${s.sequence_number}`;
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: i < deduped.size - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontWeight: 500 }}>{label}{s.attempt_number > 1 ? ` (${s.attempt_number})` : ""}</span>
                  <span style={{ fontWeight: 600, color: s.status === "success" ? "var(--success)" : s.status === "failed" ? "var(--danger)" : "var(--muted)" }}>{s.status}</span>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
});

function FindingsPanel({ details }: { details: any }) {
  const artifacts: any[] = details?.artifacts ?? [];
  const hiringPanel = artifacts.find((a) => a.automation_id === "application_hiring_panel")?.data;
  const finalPolish = artifacts.find((a) => a.automation_id === "application_final_polish")?.data;

  return (
    <div style={{ marginTop: 10, padding: 12, background: "var(--surface-3)", borderRadius: 6, fontSize: 12, display: "grid", gap: 10 }}>
      {!details ? (
        <div className="muted">Loading…</div>
      ) : !hiringPanel ? (
        <div className="muted">Hiring Panel hasn't run yet.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            <div style={{ textAlign: "center", background: "var(--surface-2)", padding: "6px 0", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>ATS</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{hiringPanel.atsScore}/10</div>
            </div>
            <div style={{ textAlign: "center", background: "var(--surface-2)", padding: "6px 0", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Recruiter</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{hiringPanel.recruiterScore}/10</div>
            </div>
            <div style={{ textAlign: "center", background: "var(--surface-2)", padding: "6px 0", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Role fit</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{hiringPanel.roleFitScore}/10</div>
            </div>
            <div style={{ textAlign: "center", background: "var(--surface-2)", padding: "6px 0", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Truth</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{typeof hiringPanel.truthfulnessRisk === "number" ? Math.max(0, 10 - hiringPanel.truthfulnessRisk) : 0}/10</div>
            </div>
          </div>
          {hiringPanel.overallComment && (
            <div style={{ fontStyle: "italic", color: "var(--muted)", padding: "8px", background: "var(--surface-1)", borderRadius: 6, borderLeft: "3px solid var(--border)" }}>"{hiringPanel.overallComment}"</div>
          )}
          {hiringPanel.requiredEdits?.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Required edits</div>
              {hiringPanel.requiredEdits.map((e: any, i: number) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "4px 0", borderBottom: "1px dashed var(--border)" }}>
                  <span className={`badge badge-${e.severity === "critical" ? "danger" : e.severity === "major" ? "warning" : "info"}`} style={{ fontSize: 9, padding: "2px 6px" }}>{e.severity}</span>
                  <span style={{ lineHeight: 1.4 }}>{e.description}</span>
                </div>
              ))}
            </div>
          )}
          {finalPolish && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                Final Polish
                <span className={`badge badge-${finalPolish.exportReady ? "success" : "warning"}`} style={{ fontSize: 10, padding: "2px 8px" }}>
                  {finalPolish.exportReady ? "ready" : "not ready"}
                </span>
              </div>
              {finalPolish.unresolvedWarnings?.length > 0 && (
                <div style={{ color: "var(--muted)", background: "rgba(245, 158, 11, 0.1)", padding: "6px 8px", borderRadius: 4, borderLeft: "3px solid var(--warning)" }}>Unresolved: {finalPolish.unresolvedWarnings.join(", ")}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}