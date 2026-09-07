"use client";

// "Unassigned" tab: messages the shared mailbox received that
// candidateEmailMatcher.ts could not deterministically resolve. Assigning
// one here back-fills every other still-unassigned message already in the
// same Gmail thread in the same write (see /api/inbox/unassigned's POST).

import { useCallback, useEffect, useState } from "react";

interface UnassignedMessage {
  id: string;
  gmail_thread_id: string;
  from_email: string | null;
  to_emails: string[] | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string;
  attachment_metadata: { filename?: string }[];
}

export function UnassignedPanel({ candidates, onAssigned }: { candidates: { id: string; name: string }[]; onAssigned: () => void }) {
  const [messages, setMessages] = useState<UnassignedMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/inbox/unassigned?pageSize=50", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setMessages(data.messages || []);
        setTotal(Number(data.total || 0));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assign = async (id: string) => {
    const candidateId = selection[id];
    if (!candidateId) return;
    setAssigningId(id);
    setError("");
    try {
      const res = await fetch("/api/inbox/unassigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, candidateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign.");
      await load();
      onAssigned();
    } catch (e: any) {
      setError(e?.message || "Failed to assign.");
    } finally {
      setAssigningId(null);
    }
  };

  if (loading && messages.length === 0) {
    return <div style={{ padding: 40, textAlign: "center" }} className="text-muted">Loading unassigned mail…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ padding: "0 4px", fontSize: 13, color: "var(--muted)" }}>
        {total.toLocaleString()} message(s) could not be automatically matched to a candidate. Assign one below — every other unread message already in that same conversation is matched at the same time.
      </div>
      {error && <div className="alert error">{error}</div>}
      {messages.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center" }} className="text-muted">Nothing unassigned right now.</div>
      ) : (
        messages.map((m) => (
          <div key={m.id} style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>{m.from_email || "Unknown sender"} &middot; {new Date(m.sent_at).toLocaleString()}</div>
              <div style={{ fontSize: 14, fontWeight: 500, margin: "4px 0" }}>{m.subject || "(no subject)"}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.snippet}</div>
              {m.attachment_metadata?.length > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>📎 {m.attachment_metadata.length} attachment(s)</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <select
                className="input"
                style={{ minWidth: 200 }}
                value={selection[m.id] || ""}
                onChange={(e) => setSelection((prev) => ({ ...prev, [m.id]: e.target.value }))}
              >
                <option value="">Assign to candidate…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                className="btn primary sm"
                disabled={!selection[m.id] || assigningId === m.id}
                onClick={() => assign(m.id)}
              >
                {assigningId === m.id ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
