// src/app/portal/[token]/page.tsx
// Public, read-only candidate portal — no login, accessed via a magic-link token.
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ApplicationsPerDayChart from "@/components/portal/ApplicationsPerDayChart";

interface Update {
  id: string;
  body: string;
  created_at: string;
}

interface TimelineEntry {
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

interface Interview {
  id: string;
  round_number: number | null;
  round_name: string | null;
  scheduled_at: string;
  status: string | null;
  location: string | null;
  meeting_link: string | null;
}

interface PortalApplication {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  applied_at: string;
  job: { id: string; title: string; company: string | null; location: string | null } | null;
  updates: Update[];
  timeline: TimelineEntry[];
  interviews: Interview[];
  resumeVersionId: string | null;
}

interface PortalStats {
  totalApplications: number;
  interviews: number;
  offers: number;
  responseRate: number;
}

interface PortalData {
  name: string;
  stats: PortalStats;
  appsPerDay: { d: string; count: number }[];
  applications: PortalApplication[];
}

interface PortalGmailAccount {
  id: string;
  email: string | null;
  status: string;
  updated_at: string;
}

export default function CandidatePortalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<PortalData | null>(null);
  const [gmailAccounts, setGmailAccounts] = useState<PortalGmailAccount[]>([]);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showMessages, setShowMessages] = useState(false);
  const [threads, setThreads] = useState<any[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [compose, setCompose] = useState("");
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftSubmitted, setDraftSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/${token}`).then(async (res) => {
      if (!res.ok) { setNotFound(true); setLoading(false); return; }
      setData(await res.json());
      setLoading(false);
    });

    fetch(`/api/portal/${token}/gmail/status`).then(async (res) => {
      if (res.ok) {
        const account = await res.json();
        setGmailAccounts(account ? [account] : []);
      }
      setGmailLoading(false);
    }).catch(() => setGmailLoading(false));
  }, [token]);

  async function loadMessages() {
    setThreadsLoading(true);
    setShowMessages(true);
    const res = await fetch(`/api/portal/${token}/messages`);
    if (res.ok) {
      const data = await res.json();
      setThreads(data.threads ?? []);
    }
    setThreadsLoading(false);
  }

  async function submitDraft() {
    if (!compose.trim()) return;
    setSubmitting(true);
    try {
      const body: any = { body: compose.trim() };
      if (replyToId) body.inReplyToMessageId = replyToId;
      const res = await fetch(`/api/portal/${token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCompose("");
        setReplyToId(null);
        setDraftSubmitted(true);
        setTimeout(() => setDraftSubmitted(false), 3000);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to submit draft");
      }
    } catch {
      alert("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (notFound || !data) {
    return <div className="empty">This link isn't valid. Please ask your recruiter for an updated link.</div>;
  }

  return (
    <>
      <div className="page-header">
        <h1>Welcome, {data.name}</h1>
      </div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Here's a live look at the jobs we've applied to on your behalf and any updates.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h2 className="section-title">Application Gmail</h2>
            <p className="muted" style={{ margin: 0 }}>
              Connect the Gmail inbox where employers may send replies, interview requests, or status updates.
            </p>
          </div>
          <button type="button" className="btn-primary" onClick={() => { window.location.href = `/api/portal/${token}/gmail/start`; }}>
            Connect Gmail
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {gmailLoading ? (
            <span className="muted">Checking Gmail connection...</span>
          ) : gmailAccounts.length === 0 ? (
            <span className="muted">No Gmail account connected.</span>
          ) : (
            gmailAccounts.map((account) => (
              <div key={account.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{account.email || "Connected Gmail account"}</span>
                <span className="badge">{account.status}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  Updated {new Date(account.updated_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {data.stats.totalApplications > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <StatCard label="Applications" value={data.stats.totalApplications} />
          <StatCard label="Interviews" value={data.stats.interviews} />
          <StatCard label="Offers" value={data.stats.offers} />
          <StatCard label="Response rate" value={`${data.stats.responseRate}%`} />
        </div>
      )}

      {data.appsPerDay && data.appsPerDay.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 className="section-title">Applications per day</h2>
          <ApplicationsPerDayChart data={data.appsPerDay} />
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Email Threads</h2>
          <button onClick={() => { if (showMessages) { setShowMessages(false); } else loadMessages(); }}>
            {showMessages ? "Hide threads" : "View threads"}
          </button>
        </div>
        {showMessages && (
          <div style={{ marginTop: 12 }}>
            {threadsLoading ? (
              <div className="empty">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="empty">No email threads yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {threads.map((thread: any) => (
                  <div key={thread.threadId} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>{thread.subject || "(no subject)"}</div>
                    {thread.messages.slice(0, 5).map((msg: any) => (
                      <div key={msg.id} style={{ marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid var(--border)", fontSize: 13 }}>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {msg.sender_name || msg.from_address || "Unknown"} — {new Date(msg.created_at).toLocaleString()}
                        </div>
                        <p style={{ margin: "2px 0", whiteSpace: "pre-wrap" }}>{msg.body}</p>
                        {msg.direction === "inbound" && (
                          <button
                            style={{ fontSize: 11, marginTop: 4 }}
                            onClick={() => { setReplyToId(replyToId === msg.id ? null : msg.id); setCompose(""); }}
                          >
                            {replyToId === msg.id ? "Cancel reply" : "Reply"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}

                {replyToId && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    <label>Reply draft (requires staff approval before sending)</label>
                    <textarea
                      value={compose}
                      onChange={(e) => setCompose(e.target.value)}
                      placeholder="Write your reply draft…"
                      style={{ minHeight: 80, marginTop: 6 }}
                    />
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                      <button className="btn-primary" onClick={submitDraft} disabled={submitting || !compose.trim()}>
                        {submitting ? "Submitting…" : "Submit for review"}
                      </button>
                      {draftSubmitted && <span style={{ color: "var(--success)", fontSize: 13 }}>Draft submitted!</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {data.applications.length === 0 ? (
        <div className="empty">No applications submitted yet — check back soon.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.applications.map((app) => (
            <div key={app.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{app.job?.title ?? "Job no longer listed"}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {app.job?.company || "—"} {app.job?.location ? `• ${app.job.location}` : ""}
                  </div>
                </div>
                <span className={`badge badge-${app.public_status.stage}`}>{app.public_status.label}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Applied {new Date(app.applied_at).toLocaleDateString()}
                {app.resumeVersionId && (
                  <>{" "}—{" "}
                    <a href={`/api/portal/${token}/resume?applicationId=${app.id}`} style={{ fontSize: 12 }}>
                      Download resume
                    </a>
                  </>
                )}
              </div>

              {app.timeline && app.timeline.length > 0 && (
                <div style={{ marginBottom: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <label>Application Timeline</label>
                  <div style={{ marginTop: 6 }}>
                    {app.timeline.map((e, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, marginBottom: 4, fontSize: 12 }}>
                        <span className="muted" style={{ minWidth: 100 }}>
                          {new Date(e.createdAt).toLocaleDateString()}
                        </span>
                        <span className="badge" style={{ fontSize: 10 }}>
                          {e.toStatus}
                        </span>
                        {e.note && <span className="muted">{e.note}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {app.interviews && app.interviews.length > 0 && (
                <div style={{ marginBottom: 12, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <label>Upcoming / Recent Interviews</label>
                  <div style={{ marginTop: 6 }}>
                    {app.interviews.map((iv) => (
                      <div key={iv.id} className="card" style={{ padding: "8px 12px", marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {iv.round_name || `Round ${iv.round_number ?? "—"}`}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {new Date(iv.scheduled_at).toLocaleString()}
                          {iv.location ? ` — ${iv.location}` : ""}
                        </div>
                        {iv.meeting_link && (
                          <a href={iv.meeting_link} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                            Join meeting
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {app.updates.length > 0 && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                  <label>Updates</label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    {app.updates.map((u) => (
                      <div key={u.id}>
                        <div className="muted" style={{ fontSize: 11 }}>{new Date(u.created_at).toLocaleString()}</div>
                        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{u.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <label>{label}</label>
      <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 0" }}>{value}</p>
    </div>
  );
}
