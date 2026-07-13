"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface KeyRow {
  id: string;
  label: string;
  scopes: string[];
  candidate_id: string | null;
  created_at: string;
  revoked_at: string | null;
}

const ALL_SCOPES = [
  { value: "extension:job:capture", label: "Job Capture" },
  { value: "extension:queue:read", label: "Queue Read" },
  { value: "extension:readiness:read", label: "Readiness Read" },
  { value: "extension:evidence:write", label: "Evidence Write" },
  { value: "extension:adapters:read", label: "Adapters Read" },
];

export default function ExtensionKeysAdminPage() {
  const [role, setRole] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [label, setLabel] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const [createdKey, setCreatedKey] = useState<{ key: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadAuth() {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setRole(d?.profile?.role ?? "");
      }
    } catch { /* ignore */ }
    finally { setAuthLoading(false); }
  }

  async function loadKeys() {
    try {
      const res = await fetch("/api/admin/extension-keys", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setKeys(d.keys ?? []);
      } else if (res.status === 401 || res.status === 403) {
        setError("You do not have access to this page.");
      }
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAuth(); loadKeys(); }, []);

  function toggleScope(s: string) {
    setSelectedScopes((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s); else n.add(s);
      return n;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage(""); setCreatedKey(null); setCopied(false);
    if (!label.trim()) { setError("Label is required."); return; }
    if (selectedScopes.size === 0) { setError("Select at least one scope."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/extension-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          scopes: Array.from(selectedScopes),
          candidateId: candidateId.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Failed to create key."); return; }
      setCreatedKey({ key: body.key, label: body.label });
      setLabel(""); setCandidateId(""); setSelectedScopes(new Set());
      loadKeys();
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this extension key? Any client using it will immediately stop authenticating.")) return;
    try {
      const res = await fetch(`/api/admin/extension-keys/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Revoke failed."); return; }
      setMessage(`Key ${id.slice(0, 8)}… revoked.`);
      loadKeys();
    } catch (err: any) { setError(err.message); }
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setError("Clipboard copy failed — select and copy manually."); }
  }

  if (authLoading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (role !== "admin") {
    return <p className="form-error" style={{ padding: 24 }}>Access restricted to admins.</p>;
  }

  return (<>
    <div className="page-header">
      <h1>Extension API Keys</h1>
      <Link href="/admin/ai" className="btn" style={{ marginLeft: "auto" }}>← AI Control Center</Link>
    </div>

    {error && <p className="form-error">{error}</p>}
    {message && <p style={{ color: "var(--accent)", fontSize: 13 }}>{message}</p>}

    {createdKey && (
      <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>
        <h2 className="section-title" style={{ color: "var(--accent)" }}>Key Created — Save It Now</h2>
        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          This plaintext key for "{createdKey.label}" is shown ONCE and cannot be retrieved again.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <code style={{ flex: 1, padding: "8px 10px", background: "var(--bg)", borderRadius: 6, fontSize: 13, wordBreak: "break-all", userSelect: "all" }}>
            {createdKey.key}
          </code>
          <button onClick={copyKey} className="btn">{copied ? "Copied!" : "Copy"}</button>
        </div>
        <button onClick={() => setCreatedKey(null)} className="btn" style={{ fontSize: 12 }}>Dismiss</button>
      </div>
    )}

    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Issue New Key</h2>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. browser-extension-prod" className="input" required />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>Scopes</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {ALL_SCOPES.map((s) => (
              <label key={s.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={selectedScopes.has(s.value)} onChange={() => toggleScope(s.value)} />
                {s.label}
              </label>
            ))}
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>Candidate binding (optional)</span>
          <input value={candidateId} onChange={(e) => setCandidateId(e.target.value)} placeholder="candidate user_id" className="input" />
        </label>
        <button type="submit" disabled={submitting} className="btn" style={{ maxWidth: 180 }}>
          {submitting ? "Creating…" : "Create key"}
        </button>
      </form>
    </div>

    <div className="card">
      <h2 className="section-title">Active Keys ({keys.length})</h2>
      {loading ? (
        <p>Loading…</p>
      ) : keys.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>No keys issued yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "8px 6px" }}>Label</th>
              <th style={{ padding: "8px 6px" }}>Scopes</th>
              <th style={{ padding: "8px 6px" }}>Created</th>
              <th style={{ padding: "8px 6px" }}>Status</th>
              <th style={{ padding: "8px 6px" }}></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 6px" }}>{k.label}</td>
                <td style={{ padding: "8px 6px", fontSize: 11 }}>{(k.scopes ?? []).join(", ") || <em style={{ color: "var(--ink-soft)" }}>none</em>}</td>
                <td style={{ padding: "8px 6px", fontSize: 11 }}>{k.created_at ? new Date(k.created_at).toLocaleDateString() : "—"}</td>
                <td style={{ padding: "8px 6px" }}>
                  {k.revoked_at ? (
                    <span style={{ color: "var(--danger, #c0392b)" }}>revoked</span>
                  ) : (
                    <span style={{ color: "var(--accent)" }}>active</span>
                  )}
                </td>
                <td style={{ padding: "8px 6px" }}>
                  {!k.revoked_at && (
                    <button onClick={() => revoke(k.id)} className="btn" style={{ fontSize: 12 }}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </>);
}