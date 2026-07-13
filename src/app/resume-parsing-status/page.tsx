"use client";

import { useEffect, useState, useRef, useCallback, memo } from "react";
import Link from "next/link";
import { APPLICATION_AGENT_METAS } from "@/lib/ai/application-agents/types";

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
}

const STAGE_LABELS = ["Queued", "Job Lens", "Resume Forge", "Hiring Panel", "Final Polish", "Complete"];
const STAGE_COUNT = 6;

function StatusBadge({ status }: { status: string }) {
  const cls = status === "completed" ? "badge-success" : status === "failed" ? "badge-danger" : status === "running" ? "badge-info" : "badge-warning";
  return <span className={`badge ${cls}`} style={{ fontSize: 11 }}>{status}</span>;
}

export default function ResumeParsingStatusPage() {
  const [workflows, setWorkflows] = useState<WorkflowCard[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [findingsOpen, setFindingsOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
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
      const incoming: WorkflowCard[] = data.workflows ?? [];
      setWorkflows((prev) => {
        // Diff by id+updated_at — only update changed rows
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
        // Check if any changed
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].updated_at !== prev[i]?.updated_at) return updated;
        }
        return prev;
      });
      setLoading(false);
    } catch { /* poll quietly fails */ }
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

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 16px" }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>AI Resume Parsing Status</h1>
        <span className="muted" style={{ fontSize: 13 }}>Live pipeline tracker — auto-refreshes every 6s</span>
      </div>

      {loading && <p className="muted">Loading...</p>}

      {!loading && workflows.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">No active or recent workflows. Log an application with a base resume to start one.</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {workflows.map((wf) => (
          <WorkflowCardView
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
}

/** Memoized so a poll tick that only changes one workflow's `updated_at`
 *  (see fetchActive's diff-by-id above) only re-renders that one card —
 *  props are unchanged for every other card, so React.memo skips them. */
const WorkflowCardView = memo(function WorkflowCardView({
  wf, isExpanded, isFindingsOpen, detail, onToggleExpand, onToggleFindings,
}: {
  wf: WorkflowCard;
  isExpanded: boolean;
  isFindingsOpen: boolean;
  detail: any;
  onToggleExpand: (id: string) => void;
  onToggleFindings: (id: string) => void;
}) {
  const active = wf.status === "completed" ? 5 : wf.current_stage ?? 0;
  const failed = wf.status === "failed";

  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{wf.candidate_name ?? `Workflow ${wf.id.slice(0, 8)}`}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {wf.job_title ?? "—"} {wf.job_company ? `· ${wf.job_company}` : ""}
          </div>
        </div>
        <StatusBadge status={wf.status} />
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {Array.from({ length: STAGE_COUNT }).map((_, i) => {
          let bg = "var(--surface-3)";
          if (failed && i === active) bg = "var(--danger)";
          else if (wf.status === "completed" || i < active || (wf.status === "waiting" && i < active)) bg = "var(--success)";
          else if (i === active && wf.status === "running") bg = "var(--info)";
          return <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: bg, transition: "background 0.3s" }} title={STAGE_LABELS[i]} />;
        })}
      </div>

      {wf.match_reason && (
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Match: {wf.match_reason} {wf.match_score != null && `(score: ${wf.match_score})`}
        </div>
      )}

      {wf.last_error && (
        <div style={{ padding: 6, borderRadius: 4, background: "rgba(211, 38, 30, 0.08)", color: "var(--danger)", fontSize: 11, marginBottom: 6 }}>
          {wf.last_error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-compact btn-sm" onClick={() => onToggleExpand(wf.id)}>
          {isExpanded ? "Hide details" : "Details"}
        </button>
        {(wf.current_stage ?? 0) >= 3 && (
          <button className="btn-compact btn-sm" onClick={() => onToggleFindings(wf.id)}>
            📋 AI findings
          </button>
        )}
        {wf.status === "completed" && wf.tailored_resume_version_id && (
          <button
            className="btn-compact btn-sm"
            onClick={() => window.open(`/falood/studio/application/${wf.tailored_resume_version_id}`, "_blank")}
          >
            Open in Studio
          </button>
        )}
        {wf.application_id && (
          <Link href={`/application-queue`} className="btn-compact btn-sm" style={{ textDecoration: "none" }}>
            Queue
          </Link>
        )}
      </div>

      {isFindingsOpen && <FindingsPanel details={detail} />}

      {isExpanded && detail && (
        <div className="workflow-detail" style={{ marginTop: 10, padding: 8, background: "var(--surface-2)", borderRadius: 6, fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Pipeline Stages</div>
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
              const retried = s.attempt_number > 1 ? ` (retry ${s.attempt_number - 1})` : "";
              return (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <span>{label}{retried}</span>
                  <span className={`badge badge-${s.status === "success" ? "success" : s.status === "failed" ? "danger" : "warning"}`}>{s.status}</span>
                </div>
              );
            });
          })()}
          {(detail.stages || []).filter((s: any) => s.status === "failed" && s.error_message).length > 0 && (
            <div style={{ marginTop: 6 }}>
              {(detail.stages || []).filter((s: any) => s.status === "failed" && s.error_message).map((s: any, i: number) => (
                <div key={`err-${i}`} style={{ padding: "4px 6px", background: "rgba(211, 38, 30, 0.08)", borderRadius: 4, fontSize: 11, marginTop: 2 }}>
                  <strong>Stage {s.sequence_number}:</strong> {s.error_message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/** Hiring Panel score breakdown + Final Polish outcome — the canonical place
 *  for AI pipeline findings (previously duplicated as a modal on the
 *  Application Queue page; that page now links here instead). */
function FindingsPanel({ details }: { details: any }) {
  const artifacts: any[] = details?.artifacts ?? [];
  const hiringPanel = artifacts.find((a) => a.automation_id === "application_hiring_panel")?.data;
  const finalPolish = artifacts.find((a) => a.automation_id === "application_final_polish")?.data;

  return (
    <div style={{ marginTop: 10, padding: 10, background: "var(--surface-2)", borderRadius: 6, fontSize: 12, display: "grid", gap: 12 }}>
      {!details ? (
        <div className="muted">Loading…</div>
      ) : !hiringPanel ? (
        <div className="muted">Hiring Panel hasn't run for this workflow yet.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>ATS</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.atsScore}/10</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Recruiter</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.recruiterScore}/10</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Role fit</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.roleFitScore}/10</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Truth risk</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{hiringPanel.truthfulnessRisk}/10</div>
            </div>
          </div>

          {hiringPanel.overallComment && (
            <div style={{ fontSize: 13, fontStyle: "italic", color: "var(--muted)" }}>
              "{hiringPanel.overallComment}"
            </div>
          )}

          {hiringPanel.requiredEdits?.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Required edits</div>
              {hiringPanel.requiredEdits.map((e: any, i: number) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 13 }}>
                  <span className={`badge badge-${e.severity === "critical" ? "danger" : e.severity === "major" ? "warning" : "info"}`} style={{ fontSize: 10 }}>
                    {e.severity}
                  </span>
                  <span>{e.description}</span>
                </div>
              ))}
            </div>
          )}

          {hiringPanel.optionalEdits?.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Optional edits</div>
              {hiringPanel.optionalEdits.map((e: any, i: number) => (
                <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{e.description}</div>
              ))}
            </div>
          )}

          {hiringPanel.formattingIssues?.length > 0 && (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Formatting issues</div>
              {hiringPanel.formattingIssues.map((f: string, i: number) => (
                <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{f}</div>
              ))}
            </div>
          )}

          {finalPolish && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
                What Final Polish fixed
                <span className={`badge badge-${finalPolish.exportReady ? "success" : "warning"}`} style={{ marginLeft: 8, fontSize: 10 }}>
                  {finalPolish.exportReady ? "export ready" : "not export ready"}
                </span>
              </div>
              {finalPolish.appliedIssueIds?.length > 0 && (
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  Applied: {finalPolish.appliedIssueIds.join(", ")}
                </div>
              )}
              {finalPolish.rejectedIssueIds?.length > 0 && (
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  {finalPolish.rejectedIssueIds.map((r: any, i: number) => (
                    <div key={i}>Rejected {r.issueId}: {r.reason}</div>
                  ))}
                </div>
              )}
              {finalPolish.unresolvedWarnings?.length > 0 && (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  Unresolved: {finalPolish.unresolvedWarnings.join(", ")}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
