"use client";

import { useEffect, useState } from "react";
import { sendChatMessage } from "@/lib/chatClient";

type Summary = { candidate: string; applied: number; reviewed: number; interviews: number; offers: number };

const QUICK_PROMPTS = [
  "Rank today's newest applications by interview likelihood for each active candidate. Include application IDs and explain the top matches.",
  "Give me today's AE workload by person in Bangladesh time. Separate reviewed, AE applied, pending review, and pending application.",
  "Find the highest-priority applications that have a tailored resume but are not yet AE Applied. Do not include weak matches.",
];

export default function MpcCommandCenterPage() {
  const [summary, setSummary] = useState<Summary[]>([]);
  const [prompt, setPrompt] = useState(QUICK_PROMPTS[0]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/mcp/daily-summary", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Could not load daily summary")))
      .then((data) => setSummary(data.people ?? []))
      .catch((e) => setError(e.message));
  }, []);

  async function run() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError(""); setAnswer("");
    const result = await sendChatMessage({ message: `${prompt}\n\nUse application_stage as the canonical stage. Return IDs and cite the database fields used.`, conversationId: null });
    setBusy(false);
    if (result.error) setError(result.error); else setAnswer(result.reply ?? "No result returned.");
  }

  return <main className="page-shell">
    <div className="page-header">
      <div><p className="eyebrow">MCP / CODEX COMMAND CENTER</p><h1>Operations command center</h1><p className="muted">Search, prioritize, summarize, and open controlled workflow actions from one place.</p></div>
      <div style={{ display: "flex", gap: 8 }}><a className="btn" href="/chat">Full assistant</a><a className="btn-primary" href="/application-queue">Open queue</a></div>
    </div>

    <section className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>Daily AE summary</h2><span className="muted">Today · operational counts</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, marginTop: 14 }}>
        {summary.map((person) => <div className="card" key={person.candidate} style={{ padding: 14 }}><strong>{person.candidate}</strong><div className="muted" style={{ marginTop: 8 }}>{person.applied} applied · {person.reviewed} reviewed</div><div className="muted">{person.interviews} interviews · {person.offers} offers</div></div>)}
        {summary.length === 0 && <p className="muted">No AE activity recorded today.</p>}
      </div>
    </section>

    <section className="card">
      <h2>Ask Codex about TalentOS</h2><p className="muted">Codex uses the existing parameterized tools and returns application IDs so the team can act on verified records.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>{QUICK_PROMPTS.map((q) => <button className="btn" key={q} onClick={() => setPrompt(q)}>{q.slice(0, 42)}…</button>)}</div>
      <textarea className="input" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => void run()} disabled={busy}>{busy ? "Working…" : "Run with Codex"}</button>
      {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      {answer && <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, padding: 14, background: "var(--bg)", borderRadius: "var(--radius)", overflowX: "auto" }}>{answer}</pre>}
    </section>
  </main>;
}
