// src/app/portal/[token]/page.tsx
// Public, read-only candidate portal — no login, accessed via a magic-link token.
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import CandidatePortalDashboard from "@/components/portal/CandidatePortalDashboard";

interface Update {
  id: string;
  body: string;
  created_at: string;
}

interface PortalApplication {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  applied_at: string;
  job: { id: string; title: string; company: string | null; location: string | null } | null;
  updates: Update[];
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
  applications: PortalApplication[];
  skarionEnrolledAt: string | null;
}

function formatAppliedDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return "—";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthIdx = parseInt(m[2], 10) - 1;
  var day = parseInt(m[3], 10);
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return "—";
  return months[monthIdx] + " " + day + ", " + m[1];
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
  const [activeView, setActiveView] = useState<"overview" | "dashboard">("overview");
  const [enrolledAt, setEnrolledAt] = useState("");
  const [enrollmentSaving, setEnrollmentSaving] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/${token}`).then(async (res) => {
      if (!res.ok) { setNotFound(true); setLoading(false); return; }
      const portalData = await res.json();
      setData(portalData);
      setEnrolledAt(portalData.skarionEnrolledAt || "");
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

      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        <button
          onClick={function () { setActiveView("overview"); }}
          style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            border: activeView === "overview" ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: activeView === "overview" ? "var(--accent)" : "var(--surface)",
            color: activeView === "overview" ? "#fff" : "var(--ink-soft)",
            cursor: "pointer",
          }}
        >
          Applications
        </button>
        <button
          onClick={function () { setActiveView("dashboard"); }}
          style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            border: activeView === "dashboard" ? "1px solid var(--accent)" : "1px solid var(--border)",
            background: activeView === "dashboard" ? "var(--accent)" : "var(--surface)",
            color: activeView === "dashboard" ? "#fff" : "var(--ink-soft)",
            cursor: "pointer",
          }}
        >
          Dashboard
        </button>
      </div>

      {activeView === "dashboard" ? (
        <CandidatePortalDashboard token={token || ""} />
      ) : (
      <>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <div>
            <h2 className="section-title">Application Gmail</h2>
            <p className="muted" style={{ margin: 0 }}>
              Connect the Gmail inbox where employers may send replies, interview requests, or status updates.
            </p>
          </div>
          <button type="button" className="btn-primary" disabled={!enrolledAt || enrollmentSaving} onClick={() => { window.location.href = `/api/portal/${token}/gmail/start`; }}>
            Connect Gmail
          </button>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <label htmlFor="skarion-enrolled-at" style={{ display: "block", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>When did you enroll with Skarion?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input id="skarion-enrolled-at" type="date" value={enrolledAt} onChange={(e) => setEnrolledAt(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            <button type="button" className="btn-secondary" disabled={!enrolledAt || enrollmentSaving} onClick={async () => {
              setEnrollmentSaving(true); setEnrollmentError(null);
              const response = await fetch(`/api/portal/${token}/enrollment-date`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolledAt }) });
              if (!response.ok) { const payload = await response.json().catch(() => ({})); setEnrollmentError(payload.error || "Could not save date."); }
              setEnrollmentSaving(false);
            }}>{enrollmentSaving ? "Saving..." : "Save date"}</button>
          </div>
          {enrollmentError && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{enrollmentError}</div>}
          {!enrolledAt && <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>We use this date to safely determine how far back to review recruiting email.</p>}
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
              <div className="muted" style={{ fontSize: 12, marginBottom: app.updates.length ? 12 : 0 }}>
                Applied {formatAppliedDate(app.applied_at)}
              </div>

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
