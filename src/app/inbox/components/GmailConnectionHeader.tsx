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
  can_manage?: boolean;
}

export function GmailConnectionHeader() {
  const [account, setAccount] = useState<SharedAccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/integrations/gmail/status")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: any[]) => {
        const shared = Array.isArray(rows) ? rows.find((r) => r.owner_type === "shared_application_mailbox") : null;
        setAccount(shared || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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

  return (
    <div style={{
      background: "var(--surface-2, #1a1a2e)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap",
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
            {account.can_manage && <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 14px", fontSize: 12, color: "var(--muted)", cursor: "pointer" }}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>}
          </>
        ) : account && account.status === "error" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
              <span style={{ color: "#ef4444", fontWeight: 600 }}>{account.email} — needs reconnecting</span>
            </div>
            <a href="/api/integrations/gmail/start?owner=shared&redirect=/inbox" className="btn primary sm" style={{ textDecoration: "none" }}>
              Reconnect
            </a>
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
