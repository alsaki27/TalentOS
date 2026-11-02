"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Scope = "recent" | "needs-reply" | "waiting-12h" | "overdue" | "replied" | "no-reply-needed" | "all";
type Tab = "matching" | "activity";
type Message = {
  id: string; candidate_id: string; candidate_name: string; candidate_email: string | null;
  from_email: string | null; subject: string | null; snippet: string | null;
  sent_at: string; ai_category: string; ai_summary: string | null;
  ai_matched_application_id: string | null; needs_reply: boolean; replied_at: string | null;
  manual_reply: boolean; response_due_at: string | null; job_id: string | null;
  job_title: string | null; company_name: string | null; received_in_window: boolean;
  replied_in_window: boolean; overdue_24h: boolean;
};
type CandidateActivity = { candidate_id: string; candidate_name: string; needs_reply: number; waiting_12h: number; overdue_24h: number; replied_12h: number };
type Snapshot = {
  summary: { needs_reply: number; waiting_12h: number; overdue_24h: number; replied_12h: number };
  candidates: CandidateActivity[]; candidateActivityTotal: number; candidateActivityPage: number;
  candidateActivityPageSize: number; messages: Message[]; messageTotal: number;
  messagePage: number; messagePageSize: number; focusMessage: Message | null;
  window: { start: string; end: string; timezone: string };
};

const scopes: Array<{ id: Scope; label: string }> = [
  { id: "needs-reply", label: "Needs reply" },
  { id: "waiting-12h", label: "Waiting · 12–24h" },
  { id: "overdue", label: "Overdue · 24h+" },
  { id: "replied", label: "Replied · last 12h" },
  { id: "recent", label: "Received · last 12h" },
  { id: "no-reply-needed", label: "No reply needed" },
  { id: "all", label: "All important · 15 days" },
];
const categories = ["interview_invite", "scheduling", "offer", "recruiter_reply", "application_invite", "application_confirmation"];
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const categoryLabel = (value: string) => value.replaceAll("_", " ");
const ageHours = (value: string) => Math.max(0, (Date.now() - new Date(value).getTime()) / 3_600_000);

async function readApiJson<T = any>(response: Response): Promise<T> {
  const body = await response.text();
  let data: any = {};
  if (body) {
    try { data = JSON.parse(body); }
    catch { throw new Error(`The server returned an invalid response (HTTP ${response.status}). Refresh and try again.`); }
  }
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  if (!body) throw new Error(`The server returned an empty response (HTTP ${response.status}).`);
  return data as T;
}

function Pagination({ page, total, pageSize, busy, onPage }: { page: number; total: number; pageSize: number; busy: boolean; onPage: (value: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= 0) return null;
  const pages: Array<number | string> = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : page <= 4 ? [1, 2, 3, 4, 5, "…", totalPages]
      : page >= totalPages - 3 ? [1, "…", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
        : [1, "…", page - 1, page, page + 1, "…", totalPages];
  return <div className="filter-bar" style={{ justifyContent: "center", alignItems: "center", gap: 6, margin: "16px 0", flexWrap: "wrap" }}>
    <button className="btn-compact" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
    {pages.map((item, index) => <button key={`${item}-${index}`} className={`btn-compact ${item === page ? "btn-primary" : ""}`} disabled={busy || item === "…"} onClick={() => typeof item === "number" && item !== page && onPage(item)} style={{ minWidth: 36, padding: "6px 12px", border: item === "…" ? "none" : undefined, background: item === "…" ? "transparent" : undefined, cursor: item === "…" || item === page ? "default" : "pointer" }}>{item}</button>)}
    <button className="btn-compact" disabled={busy || page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    <span className="text-muted" style={{ fontSize: 12 }}>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
  </div>;
}

export default function EmailRemindersPage() {
  const [tab, setTab] = useState<Tab>("matching");
  const [scope, setScope] = useState<Scope>("needs-reply");
  const [category, setCategory] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [search, setSearch] = useState("");
  const [messagePage, setMessagePage] = useState(1);
  const [candidatePage, setCandidatePage] = useState(1);
  const [focusEmailId, setFocusEmailId] = useState("");
  const [initialised, setInitialised] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [candidateOptions, setCandidateOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [canEditRecipients, setCanEditRecipients] = useState(false);
  const [recipientStatus, setRecipientStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkedScope = params.get("scope") as Scope | null;
    if (linkedScope && scopes.some((item) => item.id === linkedScope)) setScope(linkedScope);
    const linkedCandidate = params.get("candidateId");
    if (linkedCandidate) setCandidateId(linkedCandidate);
    const linkedEmail = params.get("emailId");
    if (linkedEmail) setFocusEmailId(linkedEmail);
    setInitialised(true);
  }, []);

  const load = useCallback(async (options?: { focusEmailId?: string }) => {
    if (!initialised) return;
    const requestId = ++requestSequence.current;
    setLoading(true); setError("");
    const params = new URLSearchParams({ scope, page: String(messagePage), pageSize: "20", candidatePage: String(candidatePage), candidatePageSize: "20" });
    if (category) params.set("category", category);
    if (candidateId) params.set("candidateId", candidateId);
    if (search.trim()) params.set("search", search.trim());
    const linkedEmailId = options?.focusEmailId ?? focusEmailId;
    if (linkedEmailId) params.set("emailId", linkedEmailId);
    try {
      const response = await fetch(`/api/inbox/reminders?${params}`, { cache: "no-store" });
      const data = await readApiJson<Snapshot>(response);
      if (requestId === requestSequence.current) setSnapshot(data);
    } catch (cause) {
      if (requestId === requestSequence.current) setError(cause instanceof Error ? cause.message : "Could not load email reminders.");
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [initialised, scope, messagePage, candidatePage, category, candidateId, search, focusEmailId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/candidates?compact=1&pageSize=200", { cache: "no-store" }).then((response) => readApiJson<any>(response)).then((data) => {
      if (cancelled) return;
      setCandidateOptions(Array.isArray(data) ? data : (data.items || []));
    }).catch(() => {});
    void fetch("/api/inbox/reminders/recipients", { cache: "no-store" }).then((response) => readApiJson<any>(response)).then((data) => {
      if (cancelled || !data) return;
      const values = Array.isArray(data.recipients) ? data.recipients : [];
      setRecipients(values); setRecipientDraft(values.join("\n")); setCanEditRecipients(Boolean(data.canEdit));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setFilter = (update: () => void) => {
    update();
    setMessagePage(1);
    setCandidatePage(1);
    setFocusEmailId("");
  };
  const markReplied = async (message: Message) => {
    setBusyId(message.id);
    try {
      const response = await fetch(`/api/gmail-communications/${message.id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "mark_replied" }) });
      await readApiJson(response);
      setFocusEmailId("");
      await load({ focusEmailId: "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not mark replied."); }
    finally { setBusyId(""); }
  };
  const markNoReplyNeeded = async (message: Message) => {
    setBusyId(message.id);
    try {
      const response = await fetch(`/api/gmail-communications/${message.id}/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "no_reply_needed" }) });
      await readApiJson(response);
      setFocusEmailId("");
      await load({ focusEmailId: "" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not mark no reply needed."); }
    finally { setBusyId(""); }
  };
  const saveRecipients = async () => {
    const values = [...new Set(recipientDraft.split(/[\n,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
    setSaving(true); setRecipientStatus("");
    try {
      const response = await fetch("/api/inbox/reminders/recipients", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipients: values }) });
      const data = await readApiJson<{ recipients: string[] }>(response);
      setRecipients(data.recipients); setRecipientDraft(data.recipients.join("\n")); setRecipientStatus("Recipients saved.");
    } catch (cause) { setRecipientStatus(cause instanceof Error ? cause.message : "Could not save recipients."); }
    finally { setSaving(false); }
  };

  const messageTotal = snapshot?.messageTotal || 0;
  const candidateTotal = snapshot?.candidateActivityTotal || 0;
  const visibleMessages = snapshot?.messages || [];
  const focusMessage = snapshot?.focusMessage && !visibleMessages.some((item) => item.id === snapshot.focusMessage?.id) ? snapshot.focusMessage : null;
  const allMessages = focusMessage ? [focusMessage, ...visibleMessages] : visibleMessages;
  const metricCards: Array<{ label: string; value: number; note: string; id: Scope; danger?: boolean }> = snapshot ? [
    { label: "Needs reply", value: snapshot.summary.needs_reply, note: "Open · last 15 days", id: "needs-reply" },
    { label: "Waiting 12–24h", value: snapshot.summary.waiting_12h, note: "Reply not detected", id: "waiting-12h" },
    { label: "Overdue · 24h+", value: snapshot.summary.overdue_24h, note: "Retained · last 7 days", id: "overdue", danger: true },
    { label: "Replied · last 12h", value: snapshot.summary.replied_12h, note: "Detected or marked replied", id: "replied" },
  ] : [];

  return <div className="page email-reminders-page" style={{ width: "100%", maxWidth: "100%", margin: "0 auto", padding: "20px 20px 40px" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
      <div><div style={{ color: "var(--accent)", fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}>Candidate communications</div>
        <h1 style={{ margin: "6px 0 4px" }}>Important email reminders</h1>
        <p className="page-kicker" style={{ margin: 0 }}>Important candidate emails from the last 15 days, grouped by reply status.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn outline" href="/inbox">Candidate Inbox</Link></div>
    </header>

    {snapshot && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 14 }}>
      {metricCards.map((metric) => <button key={metric.id} type="button" className="card" onClick={() => setFilter(() => setScope(metric.id))} style={{ cursor: "pointer", textAlign: "left", padding: 14, border: metric.danger && metric.value ? "1px solid #ef4444" : undefined, background: metric.danger && metric.value ? "#351619" : undefined }}>
        <span style={{ fontSize: 12, color: metric.danger && metric.value ? "#fecaca" : "var(--muted)" }}>{metric.label}</span><strong style={{ display: "block", fontSize: 25, marginTop: 3, color: metric.danger && metric.value ? "#fca5a5" : undefined }}>{metric.value.toLocaleString()}</strong><span style={{ fontSize: 11, color: metric.danger && metric.value ? "#fecaca" : "var(--muted)" }}>{metric.note}</span>
      </button>)}
    </div>}

    <section className="card" style={{ padding: 14, marginBottom: 14 }}>
      <nav aria-label="Email reminder sections" style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--border)", paddingBottom: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <button className={tab === "matching" ? "btn-primary" : "btn outline"} onClick={() => setTab("matching")}>Matching emails</button>
        <button className={tab === "activity" ? "btn-primary" : "btn outline"} onClick={() => setTab("activity")}>Mail activity by candidate</button>
      </nav>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {scopes.map((item) => <button key={item.id} className={scope === item.id ? "btn-primary" : "btn outline"} type="button" onClick={() => setFilter(() => setScope(item.id))}>{item.label}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9 }}>
        <input className="input" value={search} onChange={(event) => setFilter(() => setSearch(event.target.value))} placeholder="Search candidate, sender, subject, job…" />
        <select className="input" value={candidateId} onChange={(event) => setFilter(() => setCandidateId(event.target.value))}><option value="">All candidates</option>{candidateOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>
        <select className="input" value={category} onChange={(event) => setFilter(() => setCategory(event.target.value))}><option value="">All important categories</option>{categories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}</select>
      </div>
      {snapshot?.window && <div style={{ marginTop: 9, fontSize: 12, color: "var(--muted)" }}>Counts refresh when this page loads · window ends {dateLabel(snapshot.window.end)} Bangladesh time · overdue items drop from the overdue view after 7 days.</div>}
    </section>

    {error && <div className="alert error" style={{ marginBottom: 12 }}>{error}</div>}

    {tab === "activity" ? <section className="card email-reminder-table-wrap" style={{ padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}><div><h2 style={{ fontSize: 17, margin: "0 0 3px" }}>Mail activity by candidate</h2><p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Open reply tasks, waiting 12–24 hours, overdue 24+ hours, and replies in the last 12 hours.</p></div><button className="btn outline sm" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 680 }}><thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}><th style={{ padding: 9 }}>Candidate</th><th style={{ padding: 9 }}>Needs reply</th><th style={{ padding: 9 }}>Waiting · 12–24h</th><th style={{ padding: 9 }}>Overdue · 24h+</th><th style={{ padding: 9 }}>Replied · last 12h</th></tr></thead><tbody>
        {snapshot?.candidates.length ? snapshot.candidates.map((candidate) => <tr key={candidate.candidate_id} style={{ borderBottom: "1px solid var(--border)" }}><td style={{ padding: 9 }}><button className="btn text sm" onClick={() => { setFilter(() => setCandidateId(candidate.candidate_id)); setTab("matching"); }}>{candidate.candidate_name}</button></td><td style={{ padding: 9 }}>{candidate.needs_reply}</td><td style={{ padding: 9 }}>{candidate.waiting_12h}</td><td style={{ padding: 9, color: candidate.overdue_24h ? "#fca5a5" : undefined, fontWeight: candidate.overdue_24h ? 700 : 400 }}>{candidate.overdue_24h}</td><td style={{ padding: 9 }}>{candidate.replied_12h}</td></tr>) : <tr><td colSpan={5} style={{ padding: 14, color: "var(--muted)" }}>{loading ? "Loading candidate activity…" : "No candidate activity matches these filters."}</td></tr>}
      </tbody></table></div>
      {snapshot && <Pagination page={snapshot.candidateActivityPage} total={candidateTotal} pageSize={snapshot.candidateActivityPageSize} busy={loading} onPage={(value) => { setFocusEmailId(""); setCandidatePage(value); }} />}
    </section> : <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 9 }}><div><h2 style={{ fontSize: 18, margin: 0 }}>Matching emails</h2><span style={{ color: "var(--muted)", fontSize: 12 }}>{messageTotal.toLocaleString()} messages · sorted by overdue and reply status</span></div><button className="btn outline sm" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></div>
      {loading && !snapshot ? <div className="card" style={{ padding: 32, textAlign: "center" }}>Loading reminders…</div> : allMessages.length === 0 ? <div className="card" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>No messages match these filters.</div> : <div style={{ display: "grid", gap: 9 }}>
        {allMessages.map((item) => {
          const age = ageHours(item.sent_at);
          const open = item.needs_reply && !item.replied_at;
          const status = item.replied_at ? (item.manual_reply ? "MARKED REPLIED" : "TEAM REPLIED") : item.overdue_24h ? "OVERDUE · 24+ HOURS" : open && age >= 12 ? "WAITING · 12–24 HOURS" : open ? "NEEDS REPLY" : "NO REPLY NEEDED";
          const color = item.replied_at ? "#86efac" : item.overdue_24h ? "#fca5a5" : open ? "#c4b5fd" : "var(--muted)";
          const background = item.replied_at ? "#12231a" : item.overdue_24h ? "#351619" : open ? "#1a1930" : undefined;
          return <article id={`email-${item.id}`} key={item.id} className="card email-reminder-card" style={{ padding: 14, borderLeft: `4px solid ${item.replied_at ? "#16a34a" : item.overdue_24h ? "#dc2626" : open ? "#7c3aed" : "var(--border)"}`, background }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}><div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 6 }}><span className="badge">{categoryLabel(item.ai_category)}</span><strong style={{ color, fontSize: 12 }}>{status}</strong></div>
              <Link href={`/inbox?emailId=${encodeURIComponent(item.id)}`} style={{ fontSize: 16, fontWeight: 700 }}>{item.subject || "(no subject)"}</Link>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{item.candidate_name} · {item.from_email || "Unknown sender"} · {dateLabel(item.sent_at)}</div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.45 }}>{item.ai_summary || item.snippet || "Open the message to read the full email."}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, marginTop: 9 }}><Link href={`/candidates/${item.candidate_id}`}>Candidate & resume</Link>{item.ai_matched_application_id && <Link href={`/applications/${item.ai_matched_application_id}`}>Application</Link>}{item.job_id && <Link href={`/jobs/${item.job_id}`}>{item.company_name ? `${item.company_name} · ` : ""}{item.job_title || "Related job"}</Link>}{open && <span style={{ color }}>{age < 1 ? `${Math.round(age * 60)}m` : `${age.toFixed(1)}h`} waiting · due {dateLabel(item.response_due_at)}</span>}{item.replied_at && <span style={{ color: "#86efac" }}>{item.manual_reply ? "Marked replied" : "Reply detected"} · {dateLabel(item.replied_at)}</span>}</div>
            </div><div className="email-reminder-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Link className="btn outline sm" href={`/inbox?emailId=${encodeURIComponent(item.id)}`}>Open email</Link>
              {open && <button type="button" className="btn-primary sm" disabled={busyId === item.id} onClick={() => void markReplied(item)}>{busyId === item.id ? "Saving…" : "Mark replied"}</button>}
              {open && <button type="button" className="btn outline sm" disabled={busyId === item.id} onClick={() => void markNoReplyNeeded(item)}>{busyId === item.id ? "Saving…" : "No reply needed"}</button>}
            </div></div>
          </article>;
        })}
      </div>}
      {snapshot && <Pagination page={snapshot.messagePage} total={messageTotal} pageSize={snapshot.messagePageSize} busy={loading} onPage={(value) => { setFocusEmailId(""); setMessagePage(value); }} />}
    </>}

    <section className="card" style={{ padding: 15, marginTop: 18 }}><h2 style={{ fontSize: 16, margin: "0 0 5px" }}>12-hour email digest</h2><p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>Scheduled for 08:00 and 20:00 Bangladesh time. The digest has four reply metrics and links to the matching reminder.</p>
      {canEditRecipients ? <><textarea className="input" value={recipientDraft} onChange={(event) => setRecipientDraft(event.target.value)} rows={3} style={{ width: "100%", resize: "vertical" }} placeholder="shohanhyder@gmail.com" /><div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}><button className="btn-primary" disabled={saving} onClick={() => void saveRecipients()}>{saving ? "Saving…" : "Save recipients"}</button><span style={{ fontSize: 12, color: recipientStatus.includes("saved") ? "#15803d" : "#b91c1c" }}>{recipientStatus}</span></div></> : <div style={{ fontSize: 13 }}>{recipients.join(" · ") || "Loading recipients…"}</div>}
    </section>
  </div>;
}
