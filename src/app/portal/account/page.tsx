"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { ShieldCheck } from "lucide-react";
import { PortalShell } from "../PortalShell";

// ARCHIVED 2026-09-07 — the "Email privacy controls" card is hidden pending
// a future redesign of this section. Fully working code, just not
// rendered. To restore: uncomment this type, the matching state/handlers/
// effect below, and the JSX card at the bottom of this file.
// interface GmailPrivacyStatus {
//   email_sync_paused: boolean;
//   email_consent_at: string | null;
//   email_retention_days: number;
//   gmail_account_id: string | null;
//   gmail_email: string | null;
//   gmail_status: "active" | "error" | "revoked" | null;
//   gmail_scopes: string[] | null;
//   gmail_last_synced_at: string | null;
//   gmail_sync_error: string | null;
// }

export default function PortalAccountPage() {
  const router = useRouter();
  const [candidateName, setCandidateName] = useState("");
  const [mfaAvailable, setMfaAvailable] = useState(false);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  // ARCHIVED 2026-09-07 — see the matching JSX/type note above.
  // const [emailPaused, setEmailPaused] = useState(false);
  // const [retentionDays, setRetentionDays] = useState(365);
  // const [gmailStatus, setGmailStatus] = useState<GmailPrivacyStatus | null>(null);

  useEffect(() => {
    fetch("/api/portal/me", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) { router.push("/portal/login"); return null; }
        return response.ok ? response.json() : null;
      })
      .then((result) => { if (result) setCandidateName(result.name || ""); })
      .catch(() => undefined);

    // Bug fix: this card used to render unconditionally even when
    // CANDIDATE_MFA_ENABLED is off server-side, so "Set up Google
    // Authenticator" always failed with a raw "MFA_DISABLED" error. Now the
    // whole card only renders once we've confirmed the feature is on.
    fetch("/api/portal/auth/mfa")
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (result) {
          setMfaAvailable(true);
          setMfaEnrolled(Boolean(result.enrolled));
        }
      })
      .catch(() => undefined);

    // ARCHIVED 2026-09-07 — see the matching JSX/type note above.
    // fetch("/api/portal/me/gmail/privacy")
    //   .then((response) => response.ok ? response.json() : null)
    //   .then((result) => {
    //     if (result) {
    //       setGmailStatus(result);
    //       setEmailPaused(Boolean(result.email_sync_paused));
    //       setRetentionDays(Number(result.email_retention_days || 365));
    //     }
    //   })
    //   .catch(() => undefined);
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
    setMfaEnrolled(true);
    setMfaSetup(null);
    setRecoveryCodes(result.recoveryCodes || []);
    setMfaMessage("Google Authenticator is enabled. Save these one-time recovery codes.");
  }

  // ARCHIVED 2026-09-07 — email privacy controls handlers. To restore:
  // uncomment this block, the state/type/effect above, and the JSX card
  // below.
  // async function updateEmailPrivacy(nextPaused: boolean) {
  //   await fetch("/api/portal/me/gmail/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: nextPaused }) });
  //   setEmailPaused(nextPaused);
  // }
  // async function deleteEmailHistory() {
  //   if (!window.confirm("Delete imported recruiting email history? This cannot be undone.")) return;
  //   await fetch("/api/portal/me/gmail/privacy", { method: "DELETE" });
  //   setMfaMessage("Imported email history deleted.");
  // }

  return (
    <PortalShell candidateName={candidateName} pageTitle="Account" onSignOut={logout}>
      <div className="portal-section">
        <div className="portal-section-heading">
          <div>
            <div className="portal-eyebrow">Your account</div>
            <h2 className="portal-section-heading-title">Account &amp; security</h2>
          </div>
        </div>

        {mfaAvailable && (
          <div className="portal-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: mfaEnrolled || mfaSetup ? 8 : 4 }}>
              <span className="portal-icon-badge portal-icon-badge-navy"><ShieldCheck size={16} /></span>
              <strong>Two-factor authentication</strong>
            </div>
            {mfaEnrolled ? (
              <p className="portal-greeting-sub">Google Authenticator is enabled for your next sign-in.</p>
            ) : !mfaSetup ? (
              <>
                <p className="portal-greeting-sub">Protect your candidate dashboard with Google Authenticator.</p>
                <button className="portal-btn portal-btn-primary" onClick={setupMfa}>Set up Google Authenticator</button>
              </>
            ) : (
              <div style={{ marginTop: 10 }}>
                <p className="portal-greeting-sub">Scan this QR code in Google Authenticator, then enter the six-digit code.</p>
                <div style={{ background: "white", padding: 16, display: "inline-block", borderRadius: 8, marginBottom: 12 }}>
                  <QRCode value={mfaSetup.otpauthUri} size={150} />
                </div>
                <p style={{ fontSize: 12 }}>Manual key: <strong>{mfaSetup.secret}</strong></p>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input inputMode="numeric" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" />
                  <button className="portal-btn portal-btn-primary" onClick={confirmMfa}>Enable MFA</button>
                </div>
              </div>
            )}
            {recoveryCodes.length > 0 && <code style={{ display: "block", marginTop: 8, wordBreak: "break-word" }}>{recoveryCodes.join(" · ")}</code>}
            {mfaMessage && <p className="portal-greeting-sub">{mfaMessage}</p>}
          </div>
        )}

        {!mfaAvailable && (
          <div className="portal-empty">
            <strong>No account settings need your attention.</strong>
            <span>More account options will appear here as they become available.</span>
          </div>
        )}

        {/* ARCHIVED 2026-09-07 — "Email privacy controls" card, hidden pending
            a future redesign of this section. Fully working code (pause/resume
            review, retention period, delete imported history), just not
            rendered. To restore: uncomment this block plus its supporting
            state/type (emailPaused, retentionDays, gmailStatus,
            GmailPrivacyStatus), handlers (updateEmailPrivacy,
            deleteEmailHistory) and the gmail/privacy fetch effect, all
            marked ARCHIVED above in this same file.

        <div className="portal-card" style={{ padding: 16 }}>
          <strong>Email privacy controls</strong>
          <p className="portal-greeting-sub">{gmailStatus?.gmail_status === "active" ? `Your application messages are arriving through Skarion's shared mailbox (${gmailStatus.gmail_email || "connected"}). You can pause review or delete your imported history at any time.` : "Application messages are forwarded to Skarion's shared mailbox. The mailbox connection is managed by Skarion staff."}</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {gmailStatus?.gmail_status === "active" && <button className="portal-btn portal-btn-primary" onClick={() => updateEmailPrivacy(!emailPaused)}>{emailPaused ? "Resume email review" : "Pause email review"}</button>}
            <label style={{ fontSize: 12 }}>Retention <select value={retentionDays} onChange={async (event) => { const value = Number(event.target.value); setRetentionDays(value); await fetch("/api/portal/me/gmail/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retentionDays: value }) }); }}><option value={90}>90 days</option><option value={365}>1 year</option><option value={730}>2 years</option><option value={3650}>10 years</option></select></label>
            <button className="portal-btn" onClick={deleteEmailHistory}>Delete imported history</button>
          </div>
          {gmailStatus?.gmail_status === "error" && <p className="portal-error">Gmail needs to be reconnected before synchronization can continue.</p>}
        </div>
        */}
      </div>
    </PortalShell>
  );
}
