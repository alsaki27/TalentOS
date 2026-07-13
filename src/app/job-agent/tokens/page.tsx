"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface TokenRow {
  id: string;
  label: string | null;
  priority: number;
  is_active: boolean;
  last_error: string | null;
  last_error_at: string | null;
}

const PAGE_SIZE = 25;

export default function JobAgentTokensPage() {
  const [role, setRole] = useState<string>("");
  const [authLoading, setAuthLoading] = useState(true);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const nextPriority = useMemo(() => {
    if (tokens.length === 0) return 1;
    return Math.max(...tokens.map((t) => t.priority)) + 1;
  }, [tokens]);
  const [priority, setPriority] = useState<number>(1);
  useEffect(() => { setPriority(nextPriority); }, [nextPriority]);

  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);

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

  async function loadTokens() {
    try {
      const res = await fetch("/api/job-agent/tokens", { cache: "no-store" });
      if (res.ok) setTokens((await res.json()) ?? []);
      else if (res.status === 401 || res.status === 403) setError("You do not have access to this page.");
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAuth(); loadTokens(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMessage("");
    const cleanToken = token.trim();
    if (!cleanToken) { setError("Token is required."); return; }
    setSubmitting(true);
    try {
      const testRes = await fetch("/api/job-agent/configs/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apifyToken: cleanToken }),
      });
      const testBody = await testRes.json().catch(() => ({}));
      if (!testRes.ok || testBody.ok === false) {
        setError(`Token validation failed: ${testBody.error || "unknown error"}. Token was NOT saved.`);
        return;
      }

      const res = await fetch("/api/job-agent/tokens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null, token: cleanToken, priority }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Failed to save token."); return; }
      setMessage(`Token saved${body.label ? ` as "${body.label}"` : ""} (priority ${body.priority}). Validation passed.`);
      setLabel(""); setToken("");
      loadTokens();
    } catch (err: any) { setError(err.message); }
    finally { setSubmitting(false); }
  }

  async function toggleActive(t: TokenRow) {
    const next = !t.is_active;
    try {
      const res = await fetch("/api/job-agent/tokens", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, is_active: next }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setError(b.error || "Toggle failed."); return; }
      loadTokens();
    } catch (err: any) { setError(err.message); }
  }

  if (authLoading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (role !== "admin") {
    return <p className="form-error" style={{ padding: 24 }}>Access restricted to admins.</p>;
  }

  const totalPages = Math.max(1, Math.ceil(tokens.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = tokens.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (<>
    <div className="page-header">
      <h1>Job Agent Tokens</h1>
      <Link href="/job-agent" className="btn" style={{ marginLeft: "auto" }}>← Back to Job Agent</Link>
    </div>

    {error && <p className="form-error">{error}</p>}
    {message && <p style={{ color: "var(--accent)", fontSize: 13 }}>{message}</p>}

    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title">Add Apify Token</h2>
      <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 12 }}>
        Tokens are validated against Apify before being saved. Raw values are never displayed again after submit.
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. account-john" className="input" />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>Apify token</span>
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="apify_api_..." className="input" required />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12 }}>Priority (lower runs first)</span>
          <input type="number" value={priority} min={1} onChange={(e) => setPriority(Number(e.target.value) || 1)} className="input" style={{ maxWidth: 120 }} />
        </label>
        <button type="submit" disabled={submitting} className="btn" style={{ maxWidth: 180 }}>
          {submitting ? "Validating…" : "Add token"}
        </button>
      </form>
    </div>

    <div className="card">
      <h2 className="section-title">Token Pool ({tokens.length})</h2>
      {loading ? (
        <p>Loading…</p>
      ) : tokens.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>No tokens yet. Add one above to enable scraping.</p>
      ) : (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                <th style={{ padding: "8px 6px" }}>Label</th>
                <th style={{ padding: "8px 6px" }}>ID</th>
                <th style={{ padding: "8px 6px" }}>Priority</th>
                <th style={{ padding: "8px 6px" }}>Active</th>
                <th style={{ padding: "8px 6px" }}>Last error</th>
                <th style={{ padding: "8px 6px" }}></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 6px" }}>{t.label || <em style={{ color: "var(--ink-soft)" }}>unlabeled</em>}</td>
                  <td style={{ padding: "8px 6px", fontFamily: "monospace", fontSize: 11, color: "var(--ink-soft)" }}>{t.id.slice(0, 8)}…</td>
                  <td style={{ padding: "8px 6px" }}>{t.priority}</td>
                  <td style={{ padding: "8px 6px" }}>
                    <span style={{ color: t.is_active ? "var(--accent)" : "var(--ink-soft)" }}>
                      {t.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 6px", maxWidth: 320 }}>
                    {t.last_error ? (
                      <span title={t.last_error_at ?? ""} style={{ color: "var(--danger, #c0392b)" }}>
                        {t.last_error.slice(0, 60)}{t.last_error.length > 60 ? "…" : ""}
                      </span>
                    ) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    <button onClick={() => toggleActive(t)} className="btn" style={{ fontSize: 12 }}>
                      {t.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
              <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="btn">Prev</button>
              <span>Page {currentPage} of {totalPages}</span>
              <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} className="btn">Next</button>
            </div>
          )}
        </>
      )}
    </div>
  </>);
}