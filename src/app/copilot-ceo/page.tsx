"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AgentRow {
  id: string;
  label: string;
  description: string;
  is_active: boolean;
  config: { system_prompt: string | null; prompt_version: string | null; temperature: number | null } | null;
  config_status: string;
  today_calls: number;
  today_success_rate: number | null;
  today_cost: number | null;
  last_call_at: string | null;
}

interface LogRow {
  id: string;
  automation_id: string;
  provider: string;
  model: string | null;
  outcome: string;
  latency_ms: number | null;
  estimated_cost_usd: number | null;
  error_message: string | null;
  created_at: string;
}

const TABS = ["Agents", "Logs", "Proposals", "Tickets"] as const;
type Tab = (typeof TABS)[number];

export default function CopilotCeoPage() {
  const [tab, setTab] = useState<Tab>("Agents");
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/ai/agents");
        if (res.ok) {
          const data = await res.json();
          setAgents((data.agents ?? []).filter((a: AgentRow) => a.id.startsWith("copilot")));
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (tab !== "Logs") return;
    fetch("/api/copilot-ceo/logs")
      .then((r) => (r.ok ? r.json() : { logs: [] }))
      .then((d) => setLogs(d.logs ?? []));
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1>Copilot CEO</h1>
          <p className="page-kicker">
            The Application Copilot's agent team: Fill Planner, Compliance, Form Analyst, Question Answerer, and Correction Reviewer — supervised by Copilot CEO.
          </p>
        </div>
      </div>

      <div className="flex gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
        {TABS.map((t) => (
          <button
            key={t}
            className="btn-compact"
            style={{
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              borderRadius: 0,
              background: "none",
              fontWeight: tab === t ? 700 : 500,
            }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Agents" && (
        <div className="card">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : agents.length === 0 ? (
            <div className="empty">No copilot_* agents found — run migration 053 first.</div>
          ) : (
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Prompt</th>
                    <th>Calls today</th>
                    <th>Success rate</th>
                    <th>Cost today</th>
                    <th>Last call</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium text-ink">{a.label}<div className="muted" style={{ fontSize: 11 }}>{a.description}</div></td>
                      <td><span className="badge">{a.config_status}</span></td>
                      <td className="muted" style={{ fontSize: 11 }}>{a.config?.system_prompt ? "Customized (DB)" : "Default (hardcoded)"}</td>
                      <td>{a.today_calls}</td>
                      <td>{a.today_success_rate != null ? `${a.today_success_rate}%` : "—"}</td>
                      <td>{a.today_cost != null ? `$${Number(a.today_cost).toFixed(4)}` : "—"}</td>
                      <td className="muted">{a.last_call_at ? new Date(a.last_call_at).toLocaleString() : "Never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "Logs" && (
        <div className="card">
          {logs.length === 0 ? (
            <div className="empty">No copilot_* AI calls logged yet.</div>
          ) : (
            <div className="table-shell">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Outcome</th>
                    <th>Provider / Model</th>
                    <th>Latency</th>
                    <th>Cost</th>
                    <th>Error</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="font-medium text-ink">{l.automation_id}</td>
                      <td><span className={`badge ${l.outcome === "success" ? "badge-waiting" : ""}`}>{l.outcome}</span></td>
                      <td className="muted">{l.provider}{l.model ? ` / ${l.model}` : ""}</td>
                      <td className="muted">{l.latency_ms != null ? `${l.latency_ms}ms` : "—"}</td>
                      <td className="muted">{l.estimated_cost_usd != null ? `$${Number(l.estimated_cost_usd).toFixed(5)}` : "—"}</td>
                      <td className="muted" style={{ fontSize: 11, maxWidth: 240 }}>{l.error_message ?? "—"}</td>
                      <td className="muted">{new Date(l.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "Proposals" && (
        <div className="card">
          <p className="muted">
            Copilot CEO's prompt-upgrade proposals land in the same review queue as Job CEO's — nothing
            duplicated here. Proposals from Copilot CEO show <code>created_by: copilot_ceo</code>.
          </p>
          <Link className="btn-primary" href="/job-ceo/proposals" style={{ display: "inline-block", marginTop: 8 }}>
            Open Proposals Review →
          </Link>
        </div>
      )}

      {tab === "Tickets" && (
        <div className="card">
          <p className="muted">
            Copilot CEO files tickets for questions it can't resolve automatically as regular action
            items (<code>type: copilot_question</code>) in the same queue used everywhere else.
          </p>
          <Link className="btn-primary" href="/action-items" style={{ display: "inline-block", marginTop: 8 }}>
            Open Action Items →
          </Link>
        </div>
      )}
    </div>
  );
}
