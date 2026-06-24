"use client";

import { FormEvent, useEffect, useState } from "react";

interface MeResponse {
  profile: {
    display_name: string;
    email: string | null;
    role: string;
  };
}

interface GmailAccount {
  id: string;
  owner_type: "profile" | "candidate" | "shared_application_mailbox";
  email: string | null;
  scopes: string[] | null;
  status: string;
  token_expires_at: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

export default function AccountPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccount[]>([]);
  const [gmailLoading, setGmailLoading] = useState(true);
  const [gmailActionId, setGmailActionId] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
    loadGmailAccounts();
  }, []);

  async function loadGmailAccounts() {
    setGmailLoading(true);
    const res = await fetch("/api/integrations/gmail/status");
    if (res.ok) {
      setGmailAccounts(await res.json());
    }
    setGmailLoading(false);
  }

  function connectGmail(owner: "profile" | "shared") {
    window.location.href = `/api/integrations/gmail/start?owner=${owner}&redirect=/account`;
  }

  async function disconnectGmail(id: string) {
    setGmailActionId(id);
    await fetch(`/api/integrations/gmail/${id}`, { method: "DELETE" });
    setGmailActionId("");
    loadGmailAccounts();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/auth/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setSaving(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not update password.");
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setSuccess("Password updated.");
  }

  return (
    <>
      <div className="page-header">
        <h1>Account</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Profile</h2>
        <p style={{ margin: 0 }}>{me?.profile.display_name || "Signed-in user"}</p>
        <p className="muted" style={{ margin: "4px 0 0" }}>{me?.profile.email}</p>
        {me?.profile.role && <span className="badge">{me.profile.role.replaceAll("_", " ")}</span>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h2 className="section-title">Gmail integrations</h2>
            <p className="muted" style={{ margin: 0 }}>
              Connect the mailbox used for application replies. Admins and managers can also connect the shared application inbox.
            </p>
          </div>
          <div className="action-group" style={{ justifyContent: "flex-end" }}>
            <button type="button" onClick={() => connectGmail("profile")}>Connect my Gmail</button>
            {(me?.profile.role === "admin" || me?.profile.role === "manager") && (
              <button type="button" className="btn-primary" onClick={() => connectGmail("shared")}>Connect shared Gmail</button>
            )}
          </div>
        </div>

        {gmailLoading ? (
          <p className="muted" style={{ margin: 0 }}>Loading Gmail status...</p>
        ) : gmailAccounts.length === 0 ? (
          <div className="empty" style={{ padding: "22px 12px" }}>No Gmail accounts connected yet.</div>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Mailbox</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {gmailAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.email || "Unknown Gmail account"}</td>
                    <td>{account.owner_type === "shared_application_mailbox" ? "Shared application inbox" : "My Gmail"}</td>
                    <td><span className="badge">{account.status}</span></td>
                    <td className="muted">{new Date(account.updated_at).toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn-danger btn-compact"
                        onClick={() => disconnectGmail(account.id)}
                        disabled={gmailActionId === account.id}
                      >
                        {gmailActionId === account.id ? "Disconnecting..." : "Disconnect"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form className="card" onSubmit={submit}>
        <h2 className="section-title">Change password</h2>
        <div className="field-group">
          <label>New password</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>
        <div className="field-group">
          <label>Confirm password</label>
          <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
        </div>
        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}
        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save password"}
        </button>
      </form>
    </>
  );
}
