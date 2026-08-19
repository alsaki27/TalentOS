"use client";

import React, { useState, useEffect } from "react";

export interface CandidateGmailSelectorProps {
  candidates: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}

export function CandidateGmailSelector({ candidates, value, onChange }: CandidateGmailSelectorProps) {
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const loadConnectedStatus = () => {
    setLoading(true);
    fetch("/api/integrations/gmail/candidate-status")
      .then((res) => res.json())
      .then((data) => {
        if (data.connected_candidates) {
          setConnectedIds(new Set(data.connected_candidates));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadConnectedStatus();
  }, []);

  const isConnected = value ? connectedIds.has(value) : false;

  const handleDisconnect = async () => {
    if (!confirm("Disconnect this candidate's Gmail? They will need to reconnect to resume email sync.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/integrations/gmail/disconnect?candidateId=${encodeURIComponent(value)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setConnectedIds((prev) => {
          const next = new Set(prev);
          next.delete(value);
          return next;
        });
      } else {
        alert("Failed to disconnect Gmail.");
      }
    } catch {
      alert("Failed to disconnect Gmail.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleConnect = () => {
    if (!value) return;
    window.location.href = `/api/integrations/gmail/start?owner=candidate&candidateId=${encodeURIComponent(value)}&redirect=${encodeURIComponent("/inbox")}`;
  };

  return (
    <div
      style={{
        background: "var(--surface-2, #1a1a2e)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
        minWidth: 320,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Connect a client Gmail</div>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.4 }}>
        Admins and managers can start OAuth for a selected candidate. The client signs into Google and grants mailbox access.
      </div>

      <select
        style={{
          width: "100%",
          marginBottom: 10,
          background: "var(--bg, #111)",
          color: "var(--ink)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: 13,
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
      >
        <option value="">Select client candidate…</option>
        {[...candidates].sort((a, b) => {
          const aConn = connectedIds.has(a.id);
          const bConn = connectedIds.has(b.id);
          if (aConn && !bConn) return -1;
          if (!aConn && bConn) return 1;
          return a.name.localeCompare(b.name);
        }).map((c) => {
          const connected = connectedIds.has(c.id);
          return (
            <option key={c.id} value={c.id}>
              {connected ? "🟢 " : ""}{c.name}{connected ? " (Connected)" : ""}
            </option>
          );
        })}
      </select>

      {value ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isConnected ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "#22c55e",
                    boxShadow: "0 0 6px #22c55e",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "#22c55e", fontWeight: 600 }}>Connected</span>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "5px 12px",
                  fontSize: 12,
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "#6b7280",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "var(--muted)" }}>Not connected</span>
              </div>
              <button
                onClick={handleConnect}
                style={{
                  marginLeft: "auto",
                  background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 16px",
                  fontSize: 12,
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Connect client Gmail
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          disabled
          style={{
            width: "100%",
            background: "var(--accent-muted, #4f46e5)",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            color: "#fff",
            cursor: "not-allowed",
            opacity: 0.5,
            fontWeight: 600,
          }}
        >
          Connect client Gmail
        </button>
      )}
    </div>
  );
}
