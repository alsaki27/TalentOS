"use client";

// Single shared Gmail inbox redesign: the one and only Gmail-connect entry
// point going forward. Surfaced directly on /inbox (previously this lived
// tucked away on /account) since it's now central to the whole page.

import { useEffect, useState } from "react";

interface SharedAccountStatus {
  id: string;
  email: string | null;
  status: "active" | "revoked" | "error";
  last_synced_at: string | null;
  gmail_backfill_complete?: boolean;
  has_backfill_page?: boolean;
  gmail_watch_expiration?: string | null;
  sync_locked_until?: string | null;
  sync_error?: string | null;
  can_manage?: boolean;
}

export function GmailConnectionHeader() {
  const [account, setAccount] = useState<SharedAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusCheckFailed, setStatusCheckFailed] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = async () => {
    setLoading(true);
    setStatusCheckFailed(false);
    try {
      const response = await fetch("/api/integrations/gmail/status", { cache: "no-store" });
      if (!response.ok) throw new Error("Gmail status request failed");
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("Gmail status response was invalid");
      const shared = rows.find((row: any) => row?.owner_type === "shared_application_mailbox");
      setAccount(shared || null);
    } catch {
      // Keep the last known account state. A temporary status API failure must
      // never turn a connected mailbox into a Connect Gmail prompt.
      setStatusCheckFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDisconnect = async () => {
    if (!account) return;
    if (!confirm(`Disconnect ${account.email || "the shared mailbox"}? Gmail sync will stop until it's reconnected.`)) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/integrations/gmail/${account.id}`, { method: "DELETE" });
      if (res.ok) setAccount(null);
      else alert("Failed to disconnect the shared Gmail mailbox.");
    } catch {
      alert("Failed to disconnect the shared Gmail mailbox.");
    } finally {
      setDisconnecting(false);
    }
  };

  const isActive = account?.status === "active";
  const reconnectRequired = account?.status === "error" && (
    account.sync_error?.startsWith("reauth_required:") === true
    || account.sync_error?.startsWith("Gmail access was revoked or expired") === true
  );

  return (
    <div style={{
      background: "var(--surface-2, #1a1a2e)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Shared application Gmail</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Every candidate's forwarded mail lands in this one mailbox, then is matched to a candidate automatically.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {loading ? (
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Checking…</span>
        ) : account && isActive ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e", display: "inline-block" }} />
              <span style={{ color: "#22c55e", fontWeight: 600 }}>{account.email || "Connected"}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>
              {account.sync_error
                ? "Sync issue — retrying automatically"
                : statusCheckFailed
                  ? "Status check unavailable — showing last known state"
                : account.sync_locked_until
                ? "Sync in progress"
                : account.gmail_backfill_complete === false
                  ? "Initial sync continuing"
                  : account.last_synced_at
                    ? `Last sync ${new Date(account.last_synced_at).toLocaleString()}`
                    : "Not synced yet"}
            </div>
            {account.can_manage && <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "var(--muted)", cursor: "pointer" }}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>}
            {statusCheckFailed && <button onClick={load} className="btn sm" style={{ cursor: "pointer" }}>Retry</button>}
          </>
        ) : statusCheckFailed && !account ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>Could not check Gmail connection</span>
            </div>
            <button onClick={load} className="btn sm" style={{ cursor: "pointer" }}>Retry</button>
          </>
        ) : account && account.status === "error" && reconnectRequired ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
              <span style={{ color: "#ef4444", fontWeight: 600 }}>{account.email} — Google authorization expired</span>
            </div>
            {account.sync_error === "reauth_required:invalid_grant" && (
              <span style={{ maxWidth: 270, color: "var(--muted)", fontSize: 11 }}>
                If this repeats weekly, check whether the Google OAuth consent screen is still in Testing.
              </span>
            )}
            <a href="/api/integrations/gmail/start?owner=shared&redirect=/inbox" className="btn primary sm" style={{ textDecoration: "none" }}>
              Reconnect
            </a>
          </>
        ) : account && account.status === "error" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>{account.email} — sync retrying</span>
            </div>
            <button onClick={load} className="btn sm" style={{ cursor: "pointer" }}>Refresh status</button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#6b7280", display: "inline-block" }} />
              <span style={{ color: "var(--muted)" }}>Not connected</span>
            </div>
            <a href="/api/integrations/gmail/start?owner=shared&redirect=/inbox" className="btn primary sm" style={{ textDecoration: "none" }}>
              Connect Gmail
            </a>
          </>
        )}
      </div>
    </div>
  );
}
