"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./extension-keys.module.css";

interface KeyRow {
  id: string;
  label: string;
  scopes: string[];
  candidate_id: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_role: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface TeamMemberRow { user_id: string; display_name: string | null; email: string; role: string }

const ALL_SCOPES = [
  { value: "extension:job:capture", label: "Job Capture" },
  { value: "extension:queue:read", label: "Queue Read" },
  { value: "extension:readiness:read", label: "Readiness Read" },
  { value: "extension:evidence:write", label: "Evidence Write" },
  { value: "extension:adapters:read", label: "Adapters Read" },
  { value: "extension:resume:read", label: "Resume Read" },
  { value: "extension:application:assign", label: "Match & Log Candidates" },
];

export default function ExtensionKeysAdminPage() {
  const [role, setRole] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [label, setLabel] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const [createdKey, setCreatedKey] = useState<{ key: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadAuth() {
    try {
      const res = await fetch("/api/bootstrap", { cache: "no-store" });
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

  async function loadTeamMembers() {
    try {
      const res = await fetch("/api/admin/extension-keys/members", { cache: "no-store" });
      if (res.ok) setTeamMembers((await res.json()).teamMembers ?? []);
    } catch { /* key list remains available if the owner picker cannot load */ }
  }

  useEffect(() => { loadAuth(); loadKeys(); loadTeamMembers(); }, []);

  const needsOwner = selectedScopes.has("extension:job:capture") || selectedScopes.has("extension:application:assign");

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
    if (needsOwner && !ownerUserId) {
      setError("Choose the team member who will use this key so their work can be tracked."); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/extension-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          scopes: Array.from(selectedScopes),
          candidateId: candidateId.trim() || null,
          ownerUserId: ownerUserId || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || "Failed to create key."); return; }
      setCreatedKey({ key: body.key, label: body.label });
      setLabel(""); setCandidateId(""); setOwnerUserId(""); setSelectedScopes(new Set());
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

  return <div className={styles.page}>
    <header className={styles.hero}>
      <div className={styles.heroIcon} aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none"><path d="M18 14h-4a7 7 0 0 0 0 14h7m9-14h4a7 7 0 0 1 0 14h-7M17 24h14" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/><path d="M24 30v3m-5 7h10l-1.2-7h-7.6L19 40Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/></svg>
      </div>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>SKARION · TEAM ACCESS</span>
        <h1>Extension API Keys</h1>
        <p>Give each team member their own secure key and attribute extension work to the right person.</p>
      </div>
      <Link href="/admin/ai" className={`btn ${styles.backLink}`}><span aria-hidden="true">←</span> AI Control Center</Link>
    </header>

    <div className={styles.highlights}>
      <div className={styles.highlight}><span className={styles.highlightIcon}>♙</span><div><strong>Individual access</strong><span>One owner per working key</span></div></div>
      <div className={styles.highlight}><span className={styles.highlightIcon}>⌘</span><div><strong>Scoped permissions</strong><span>Grant only the tools they need</span></div></div>
      <div className={styles.highlight}><span className={styles.highlightIcon}>◷</span><div><strong>Activity tracking</strong><span>See use and completed actions</span></div></div>
    </div>

    {error && <p className={`form-error ${styles.alert}`}>{error}</p>}
    {message && <p className={styles.notice}>{message}</p>}

    {createdKey && <section className={styles.createdKey} aria-live="polite">
      <div className={styles.createdHeading}><span className={styles.successIcon}>✓</span><div><h2>Key created</h2><p>Save this key now. It is shown only once.</p></div></div>
      <div className={styles.keyReveal}><code>{createdKey.key}</code><button onClick={copyKey} className="btn">{copied ? "Copied" : "Copy key"}</button></div>
      <button onClick={() => setCreatedKey(null)} className={styles.dismiss}>Dismiss</button>
    </section>}

    <div className={styles.contentGrid}>
      <section className={`card ${styles.panel}`}>
        <div className={styles.panelHeading}><div className={styles.panelIcon}>＋</div><div><h2>Issue a key</h2><p>Create an owned key with the permissions this person needs.</p></div></div>
        <form onSubmit={submit} className={styles.form}>
          <label className={styles.field}>
            <span>Key label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Amina · Job Capture" className={`input ${styles.input}`} required />
          </label>
          <div className={styles.field}>
            <span>Permissions</span>
            <div className={styles.scopeGrid}>
              {ALL_SCOPES.map((scope) => (
                <label key={scope.value} className={`${styles.scopeOption} ${selectedScopes.has(scope.value) ? styles.scopeSelected : ""}`}>
                  <input type="checkbox" checked={selectedScopes.has(scope.value)} onChange={() => toggleScope(scope.value)} />
                  <span>{scope.label}</span>
                </label>
              ))}
            </div>
          </div>
          {needsOwner && <label className={styles.field}>
            <span>Key owner <b>Required</b></span>
            <select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)} className={`input ${styles.input}`} required>
              <option value="">Choose an active team member</option>
              {teamMembers.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || member.email} · {member.role.replaceAll("_", " ")}</option>)}
            </select>
            <small>Captured jobs and candidate actions will be credited to this person.</small>
          </label>}
          <label className={styles.field}>
            <span>Candidate binding <em>Optional</em></span>
            <input value={candidateId} onChange={(e) => setCandidateId(e.target.value)} placeholder="Candidate user ID" className={`input ${styles.input}`} />
          </label>
          <button type="submit" disabled={submitting} className={`btn ${styles.createButton}`}>
            <span aria-hidden="true">＋</span>{submitting ? "Creating key…" : "Create team key"}
          </button>
        </form>
      </section>

      <aside className={`card ${styles.guide}`}>
        <div className={styles.guideIcon} aria-hidden="true">⌑</div>
        <h2>Built for accountable access</h2>
        <p>Keys are tied to an active team member when they can capture jobs or log candidates.</p>
        <ul>
          <li><span>01</span><div><strong>Choose the owner</strong><small>Activity is attributed to their account.</small></div></li>
          <li><span>02</span><div><strong>Set the scopes</strong><small>Candidate logging requires both capture and assign access in the extension workflow.</small></div></li>
          <li><span>03</span><div><strong>Share the key securely</strong><small>TalentOS stores a hash. Copy the generated key before closing this page.</small></div></li>
        </ul>
        <div className={styles.securityNote}><span aria-hidden="true">◈</span> Revoke a key at any time to immediately stop its API access.</div>
      </aside>
    </div>

    <section className={`card ${styles.keysPanel}`}>
      <div className={styles.keysHeading}><div><span className={styles.eyebrow}>ACCESS MANAGEMENT</span><h2>Issued keys</h2><p>Review owners, permissions, and recent use.</p></div><span className={styles.keyCount}>{keys.filter((key) => !key.revoked_at).length} active · {keys.length} total</span></div>
      {loading ? <p className={styles.emptyState}>Loading keys…</p> : keys.length === 0 ? <p className={styles.emptyState}>No keys have been issued yet.</p> :
        <div className={styles.tableWrap}><table className={styles.keyTable}>
          <thead><tr><th>Key</th><th>Team member</th><th>Permissions</th><th>Created</th><th>Last used</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{keys.map((key) => <tr key={key.id}>
            <td><strong>{key.label}</strong><small className={styles.keyId}>{key.id.slice(0, 8)}…</small></td>
            <td>{key.owner_name || key.owner_email || <span className={styles.muted}>Unassigned</span>}{key.owner_role && <small>{key.owner_role.replaceAll("_", " ")}</small>}{key.owner_name && key.owner_email && <small>{key.owner_email}</small>}</td>
            <td><div className={styles.scopeTags}>{(key.scopes ?? []).map((scope) => <span key={scope}>{scope.replace("extension:", "")}</span>)}</div></td>
            <td>{key.created_at ? new Date(key.created_at).toLocaleDateString() : "—"}</td>
            <td>{key.last_used_at ? new Date(key.last_used_at).toLocaleString() : <span className={styles.muted}>Never</span>}</td>
            <td><span className={`${styles.status} ${key.revoked_at ? styles.statusRevoked : styles.statusActive}`}><i />{key.revoked_at ? "Revoked" : "Active"}</span></td>
            <td>{!key.revoked_at && <button onClick={() => revoke(key.id)} className={styles.revokeButton}>Revoke</button>}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}
