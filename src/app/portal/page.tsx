"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import PortalLogo from "./PortalLogo";

interface PortalApplication {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  applied_at: string | null;
  job: { id: string; title: string; company: string; location: string | null } | null;
  updates: { id: string; body: string; created_at: string }[];
}

interface PortalDashboard {
  name: string;
  stats: { totalApplications: number; interviews: number; offers: number; responseRate: number };
  applications: PortalApplication[];
}

interface GmailPrivacyStatus {
  email_sync_paused: boolean;
  email_consent_at: string | null;
  email_retention_days: number;
  gmail_account_id: string | null;
  gmail_email: string | null;
  gmail_status: "active" | "error" | "revoked" | null;
  gmail_scopes: string[] | null;
  gmail_last_synced_at: string | null;
  gmail_sync_error: string | null;
}

const STAGE_META: Record<string, { color: string; bg: string; icon: string }> = {
  submitted: { color: "#6b7280", bg: "#f1f2f5", icon: "●" },
  waiting: { color: "#122461", bg: "#eef0f8", icon: "↻" },
  interview: { color: "#b45309", bg: "#fef3e2", icon: "◆" },
  offer: { color: "#ff686b", bg: "#ffeced", icon: "★" },
  closed: { color: "#9ca3af", bg: "#f1f2f5", icon: "○" },
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
}

function StatCard({ icon, value, label, index }: { icon: string; value: string | number; label: string; index: number }) {
  return (
    <div className={`portal-stat portal-stagger-${index}`}>
      <span className="portal-stat-icon">{icon}</span>
      <span className="portal-stat-value">{value}</span>
      <span className="portal-stat-label">{label}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="portal-shell">
      <div className="portal-header">
        <div className="portal-header-left">
          <div className="portal-skeleton" style={{ width: 44, height: 44, borderRadius: "50%" }} />
          <div>
            <div className="portal-skeleton" style={{ width: 160, height: 18, marginBottom: 6 }} />
            <div className="portal-skeleton" style={{ width: 220, height: 12 }} />
          </div>
        </div>
      </div>
      <div className="portal-stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="portal-skeleton" style={{ height: 84 }} />
        ))}
      </div>
      <div className="portal-skeleton" style={{ height: 90 }} />
      <div className="portal-skeleton" style={{ height: 90 }} />
    </div>
  );
}

export default function PortalDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState("");
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [emailPaused, setEmailPaused] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [gmailStatus, setGmailStatus] = useState<GmailPrivacyStatus | null>(null);

  useEffect(() => {
    fetch("/api/portal/me/dashboard")
      .then((r) => {
        if (r.status === 401) {
          router.push("/portal/login");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => setError("Could not load your dashboard."));
    fetch("/api/portal/auth/mfa").then((r) => r.ok ? r.json() : null).then((d) => { if (d) setMfaEnrolled(Boolean(d.enrolled)); }).catch(() => undefined);
    fetch("/api/portal/me/gmail/privacy").then((r) => r.ok ? r.json() : null).then((d) => { if (d) { setGmailStatus(d); setEmailPaused(Boolean(d.email_sync_paused)); setRetentionDays(Number(d.email_retention_days || 365)); } }).catch(() => undefined);
  }, [router]);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  async function setupMfa() {
    setMfaMessage("");
    const response = await fetch("/api/portal/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMfaMessage(result.error || "Could not start MFA setup."); return; }
    if (result.enrolled) setMfaEnrolled(true); else setMfaSetup({ secret: result.secret, otpauthUri: result.otpauthUri });
  }

  async function confirmMfa() {
    const response = await fetch("/api/portal/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: mfaCode }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMfaMessage(result.error || "Could not verify code."); return; }
    setMfaEnrolled(true); setMfaSetup(null); setRecoveryCodes(result.recoveryCodes || []); setMfaMessage("Google Authenticator is enabled. Save these one-time recovery codes.");
  }

  async function updateEmailPrivacy(nextPaused: boolean) {
    await fetch("/api/portal/me/gmail/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: nextPaused }) });
    setEmailPaused(nextPaused);
  }

  async function deleteEmailHistory() {
    if (!window.confirm("Delete imported recruiting email history and AI drafts? This cannot be undone.")) return;
    await fetch("/api/portal/me/gmail/privacy", { method: "DELETE" });
    setMfaMessage("Imported email history deleted.");
  }

  async function disconnectGmail() {
    if (!window.confirm("Disconnect Gmail and stop all future synchronization?")) return;
    const response = await fetch("/api/portal/integrations/gmail/disconnect", { method: "POST" });
    if (!response.ok) { setMfaMessage("Gmail could not be disconnected. Please try again."); return; }
    setEmailPaused(true);
    setGmailStatus((current) => current ? { ...current, gmail_status: "revoked" } : current);
    setMfaMessage("Gmail was disconnected.");
  }

  if (error) {
    return (
      <div className="portal-shell">
        <p className="portal-error">{error}</p>
      </div>
    );
  }
  if (!data) return <DashboardSkeleton />;

  return (
    <div className="portal-shell">
      <div className="portal-logo">
        <PortalLogo size={22} />
        <span className="portal-logo-text">Skarion</span>
      </div>

      <div className="portal-header">
        <div className="portal-header-left">
          <div className="portal-avatar">{initials(data.name)}</div>
          <div>
            <h1 className="portal-greeting">Welcome back, {data.name.split(" ")[0]}</h1>
            <p className="portal-greeting-sub">Here&apos;s where things stand with your applications.</p>
          </div>
        </div>
        <button className="portal-signout" onClick={logout}>Sign out</button>
      </div>

      <div className="portal-stats">
        <StatCard icon="📄" value={data.stats.totalApplications} label="Applications" index={1} />
        <StatCard icon="🎯" value={data.stats.interviews} label="Interviews" index={2} />
        <StatCard icon="🏆" value={data.stats.offers} label="Offers" index={3} />
        <StatCard icon="📈" value={`${data.stats.responseRate}%`} label="Response rate" index={4} />
      </div>

      <div className="portal-card" style={{ marginBottom: 24, padding: 16 }}>
        <strong>Account security</strong>
        {mfaEnrolled ? <p className="portal-greeting-sub">Google Authenticator is enabled for your next sign-in.</p> : !mfaSetup ? <><p className="portal-greeting-sub">Protect your candidate dashboard with Google Authenticator.</p><button className="portal-btn portal-btn-primary" onClick={setupMfa}>Set up Google Authenticator</button></> : <div style={{ marginTop: 10 }}><p className="portal-greeting-sub">Scan this QR code in Google Authenticator, then enter the six-digit code.</p><div style={{ background: "white", padding: 16, display: "inline-block", borderRadius: 8, marginBottom: 12 }}><QRCode value={mfaSetup.otpauthUri} size={150} /></div><p style={{ fontSize: 12 }}>Manual key: <strong>{mfaSetup.secret}</strong></p><div style={{ display: "flex", gap: 8, marginTop: 8 }}><input inputMode="numeric" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" /><button className="portal-btn portal-btn-primary" onClick={confirmMfa}>Enable MFA</button></div></div>}
        {recoveryCodes.length > 0 && <code style={{ display: "block", marginTop: 8, wordBreak: "break-word" }}>{recoveryCodes.join(" · ")}</code>}
        {mfaMessage && <p className="portal-greeting-sub">{mfaMessage}</p>}
      </div>

      <div className="portal-card" style={{ marginBottom: 24, padding: 16 }}>
        <strong>Email privacy controls</strong>
        <p className="portal-greeting-sub">
          {gmailStatus?.gmail_status === "active"
            ? `Connected to ${gmailStatus.gmail_email || "Gmail"}. You can pause inbox review or delete imported history at any time.`
            : "Gmail is not connected. Connecting is optional and requires separate Gmail consent."}
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {gmailStatus?.gmail_status === "active"
            ? <button className="portal-btn portal-btn-primary" onClick={() => updateEmailPrivacy(!emailPaused)}>{emailPaused ? "Resume email review" : "Pause email review"}</button>
            : <a className="portal-btn portal-btn-primary" href="/api/portal/me/gmail/start">Connect Gmail</a>}
          <label style={{ fontSize: 12 }}>Retention <select value={retentionDays} onChange={async (e) => { const value = Number(e.target.value); setRetentionDays(value); await fetch("/api/portal/me/gmail/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retentionDays: value }) }); }}><option value={90}>90 days</option><option value={365}>1 year</option><option value={730}>2 years</option><option value={3650}>10 years</option></select></label>
          <button className="portal-btn" onClick={deleteEmailHistory}>Delete imported history</button>
          {gmailStatus?.gmail_account_id && gmailStatus.gmail_status !== "revoked" && <button className="portal-btn" onClick={disconnectGmail}>Disconnect Gmail</button>}
        </div>
        {gmailStatus?.gmail_status === "error" && <p className="portal-error">Gmail needs to be reconnected before synchronization can continue.</p>}
      </div>

      <div className="portal-section-title">Applications</div>

      {data.applications.length === 0 ? (
        <div className="portal-empty">
          <div className="portal-empty-icon">📭</div>
          No applications submitted yet — check back soon.
        </div>
      ) : (
        <div className="portal-list">
          {data.applications.map((app, i) => {
            const meta = STAGE_META[app.public_status.stage] ?? STAGE_META.submitted;
            return (
              <div key={app.id} className={`portal-app-card portal-stagger-${Math.min(i + 1, 4)}`}>
                <div className="portal-app-top">
                  <div>
                    <div className="portal-app-title">{app.job?.title ?? "Unknown role"}</div>
                    <div className="portal-app-company">
                      {app.job?.company ?? "Unknown company"}{app.job?.location ? ` · ${app.job.location}` : ""}
                    </div>
                  </div>
                  <span className="portal-pill" style={{ color: meta.color, background: meta.bg }}>
                    <span>{meta.icon}</span>
                    {app.public_status.label}
                  </span>
                </div>
                {app.applied_at && (
                  <div className="portal-app-date">Applied {new Date(app.applied_at).toLocaleDateString()}</div>
                )}
                {app.updates.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {app.updates.map((u) => (
                      <div key={u.id} className="portal-update">{u.body}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
