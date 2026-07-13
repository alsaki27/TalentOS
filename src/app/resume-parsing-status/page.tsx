"use client";

import { useEffect, useState, useRef } from "react";
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
  // Expanded on demand
  application?: { candidates?: { name?: string } | null; jobs?: { title?: string; company?: string } | null };
  stages?: any[];
  resume_version_id?: string | null;
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
  const [details, setDetails] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (details[id]) return;
    try {
      const res = await fetch(`/api/application-ai-workflows/${id}?action=status`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setDetails((p) => ({ ...p, [id]: data }));
      }
    } catch { /* */ }
  }

  function stageTracker(wf: WorkflowCard) {
    const active = wf.status === "completed" ? 5 : wf.current_stage ?? 0;
    const failed = wf.status === "failed";
    return (
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {Array.from({ length: STAGE_COUNT }).map((_, i) => {
          let bg = "var(--surface-3)";
          if (failed && i === active) bg = "var(--danger)";
          else if (wf.status === "completed" || i < active || (wf.status === "waiting" && i < active)) bg = "var(--success)";
          else if (i === active && wf.status === "running") bg = "var(--info)";
          return <div key={i} style={{ flex: 1, height: 6, borderRadius: 3, background: bg, transition: "background 0.3s" }} title={STAGE_LABELS[i]} />;
        })}
      </div>
    );
  }

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
          <div key={wf.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>Workflow {wf.id.slice(0, 8)}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {details[wf.id]?.workflow?.config_snapshot?.job?.title ?? "—"} · {
                    details[wf.id]?.workflow?.config_snapshot?.job?.company ?? "—"}
                </div>
              </div>
              <StatusBadge status={wf.status} />
            </div>

            {stageTracker(wf)}

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
              <button className="btn-compact btn-sm" onClick={() => toggleExpand(wf.id)}>
                {expanded === wf.id ? "Hide details" : "Details"}
              </button>
              {wf.application_id && (
                <Link href={`/application-queue`} className="btn-compact btn-sm" style={{ textDecoration: "none" }}>
                  Queue
                </Link>
              )}
            </div>

            {expanded === wf.id && details[wf.id] && (
              <div className="workflow-detail" style={{ marginTop: 10, padding: 8, background: "var(--surface-2)", borderRadius: 6, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Pipeline Stages</div>
                {(() => {
                  const stages = details[wf.id].stages || [];
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
                {(details[wf.id].stages || []).filter((s: any) => s.status === "failed" && s.error_message).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {(details[wf.id].stages || []).filter((s: any) => s.status === "failed" && s.error_message).map((s: any, i: number) => (
                      <div key={`err-${i}`} style={{ padding: "4px 6px", background: "rgba(211, 38, 30, 0.08)", borderRadius: 4, fontSize: 11, marginTop: 2 }}>
                        <strong>Stage {s.sequence_number}:</strong> {s.error_message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
