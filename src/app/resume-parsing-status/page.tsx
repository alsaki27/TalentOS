"use client";

import { useEffect, useState, useRef, useCallback, memo } from "react";
import Link from "next/link";
import { APPLICATION_AGENT_METAS } from "@/lib/ai/application-agents/types";
import { openFaloodStudio } from "@/lib/falood/openStudio";
import { classifyWorkflowFailure } from "@/lib/ai/application-agents/workflowFailureClassifier";

interface WorkflowCard {
  id: string;
  application_id: string;
  base_resume_id: string | null;
  status: string;
  health: string;
  heartbeat_at: string | null;
  next_retry_at: string | null;
  recovery_reason: string | null;
  stage_name: string | null;
  attempt_count: number;
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

// current_stage is 0-indexed into APPLICATION_AGENT_IDS (resume_forge=0,
// hiring_panel=1, final_polish=2) - it names the stage currently
// running/about to run. Job Lens's work (extract requirements, classify
// against the candidate) is now done inside Resume Forge's own stage
// instead of a separate one - see resumeForge.ts's analyzeJob() - so there
// is no dedicated "Job Lens" column anymore; Resume Forge's card simply
// covers that work too. Confirmed live (pre-merge): this board previously
// shifted every column by one (a workflow whose stage_run was already
// application_resume_forge still showed in the "Job Lens" column), making
// an entire in-progress batch look stuck a step earlier than it really was -
// keep the getStage checks matched exactly to current_stage, not to any
// assumption about column order.
// "Queued" means status === "queued", regardless of which stage it's queued
// for - not "stage 0", which is also what a *running* Resume Forge looks like.
const COLUMNS: ColumnDef[] = [
  { id: "queued", label: "Queued", color: "var(--muted)", getStage: (w) => w.status === "queued" && (w.current_stage === 0 || w.current_stage == null) },
  { id: "resume_forge", label: "Resume Forge", color: "#7c5cff", getStage: (w) => (w.current_stage === 0 && w.status !== "queued") && w.status !== "completed" && w.status !== "failed" },
  { id: "hiring_panel", label: "Hiring Panel", color: "#e09f3e", getStage: (w) => w.current_stage === 1 && w.status !== "completed" && w.status !== "failed" },
  { id: "final_polish", label: "Final Polish", color: "#2a9d8f", getStage: (w) => w.current_stage === 2 && w.status !== "completed" && w.status !== "failed" },
  { id: "opportunities", label: "Opportunity Reviewer", color: "var(--info)", getStage: (w) => w.stage_name === "Opportunity Reviewer" && w.status !== "completed" && w.status !== "failed" },
  { id: "release", label: "Release Editor", color: "var(--info)", getStage: (w) => w.stage_name === "Release Editor" && w.status !== "completed" && w.status !== "failed" },
  { id: "completed", label: "Completed", color: "var(--success)", getStage: (w) => w.status === "completed" },
  { id: "failed", label: "Failed", color: "var(--danger)", getStage: (w) => w.status === "failed" },
];

const WORKFLOW_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

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

function StatusBadge({ status, label }: { status: string; label: string }) {
  const cls = status === "completed" ? "badge-success" : status === "failed" ? "badge-danger" : status === "running" ? "badge-info" : "badge-warning";
  return <span className={`badge ${cls}`} style={{ fontSize: 10 }}>{label}</span>;
}

export default function ResumeParsingStatusPage() {
  const [workflows, setWorkflows] = useState<WorkflowCard[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [findingsOpen, setFindingsOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(3);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchedRevisions = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    fetchActive();
    pollRef.current = setInterval(fetchActive, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [days]);

  async function fetchActive() {
    try {
      const res = await fetch(`/api/application-ai-workflows/active?days=${days}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();

      setWorkflows(data.workflows ?? []);
      setLoading(false);
    } catch { /* */ }
  }

  const ensureDetails = useCallback((id: string, revision: string) => {
    if (fetchedRevisions.current.get(id) === revision) return;
    fetchedRevisions.current.set(id, revision);
    fetch(`/api/application-ai-workflows/${id}?action=status`, { cache: "no-store" })
      .then(async res => {
        if (!res.ok) throw new Error("Workflow details unavailable");
        const data = await res.json();
        if (fetchedRevisions.current.get(id) === revision) setDetails(cur => ({ ...cur, [id]: data }));
      })
      .catch(() => {
        if (fetchedRevisions.current.get(id) === revision) fetchedRevisions.current.delete(id);
      });
  }, []);

  useEffect(() => {
    for (const card of workflows) {
      if (card.id === expanded || card.id === findingsOpen) ensureDetails(card.id, card.updated_at);
    }
  }, [workflows, expanded, findingsOpen, ensureDetails]);

  const toggleExpand = useCallback((id: string) => setExpanded(cur => cur === id ? null : id), []);
  const toggleFindings = useCallback((id: string) => setFindingsOpen(cur => cur === id ? null : id), []);

  return (
    <div className="resume-parsing-status-page" style={{ padding: "12px", width: "100%" }}>
      <div className="page-header" style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0 }}>
          <h1 style={{ fontSize: 24, margin: 0, fontWeight: 700 }}>AI Resume Parsing Status</h1>
          <span className="muted" style={{ fontSize: 14, display: "inline-block", marginTop: 4 }}>Workflow progress and recent attempts</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: "auto", paddingTop: 1 }}>
          <label htmlFor="workflow-days-filter" style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap" }}>Show last</label>
          <select
            id="workflow-days-filter"
            aria-label="Workflow time range"
            value={days}
            onChange={(e) => { setLoading(true); setDays(Number(e.target.value)); }}
            style={{
              minWidth: 136,
              minHeight: 42,
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-2)",
              color: "inherit",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {WORKFLOW_DAY_OPTIONS.map((option) => (
              <option key={option} value={option}>Last {option} day{option === 1 ? "" : "s"}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && workflows.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">No workflows updated in the last {days} day{days === 1 ? "" : "s"}. Log an application with a base resume to start one.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
        {COLUMNS.map((col) => {
          const colCards = workflows.filter(col.getStage);
          return (
            <div
              key={col.id}
              style={{
                flex: "0 0 280px",
                minHeight: 200,
                background: "var(--surface-1)",
                borderRadius: 12,
                border: "1px solid var(--border)",
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
                    onToggleExpand={toggleExpand}
                    onToggleFindings={toggleFindings}
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
  wf, isExpanded, isFindingsOpen, detail, onToggleExpand, onToggleFindings,
}: {
  wf: WorkflowCard;
  isExpanded: boolean;
  isFindingsOpen: boolean;
  detail: any;
  onToggleExpand: (id: string) => void;
  onToggleFindings: (id: string) => void;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 8,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
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
        <StatusBadge status={wf.status} label={wf.health} />
      </div>

      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }} title={new Date(wf.updated_at).toISOString()}>
        {wf.status === "completed" ? "Completed" : wf.status === "failed" ? "Failed" : "Entered stage"} {formatCardTime(wf.updated_at)}
      </div>

      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {wf.stage_name && <div>{wf.stage_name} · {wf.attempt_count} {wf.attempt_count === 1 ? "attempt" : "attempts"}</div>}
        {wf.heartbeat_at && <div>Last heartbeat {formatCardTime(wf.heartbeat_at)}</div>}
        {wf.next_retry_at && <div>Next retry {formatCardTime(wf.next_retry_at)}</div>}
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

      {wf.last_error && (() => {
        const classification = classifyWorkflowFailure(wf.last_error);
        return (
          <div style={{ padding: "6px 8px", borderRadius: 6, background: "rgba(211, 38, 30, 0.08)", color: "var(--danger)", fontSize: 11, marginBottom: 8, lineHeight: 1.4 }}>
            <div><strong>Why:</strong> {classification?.reason ?? wf.last_error}</div>
            {classification && classification.category !== "other" && (
              <div style={{ marginTop: 4, opacity: 0.75, fontSize: 10 }}>{wf.last_error}</div>
            )}
          </div>
        );
      })()}

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
  const finalPolish = artifacts.find((a) => a.automation_id === "application_release_editor")?.data ?? artifacts.find((a) => a.automation_id === "application_final_polish")?.data;

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
