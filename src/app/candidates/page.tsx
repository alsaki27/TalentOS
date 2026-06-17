// src/app/candidates/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toCsv, downloadCsv } from "@/lib/csv";

interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  target_tier: string | null;
  resume_filename: string | null;
  avatar_url: string | null;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/candidates");
    setCandidates(await res.json());
    setSelected(new Set());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = candidates.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (tierFilter && c.target_tier !== tierFilter) return false;
    if (search) {
      const haystack = `${c.name} ${c.email ?? ""}`.toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length ? new Set() : new Set(filtered.map((c) => c.id))
    );
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this candidate? This also removes their applications and resume variants.")) return;
    await fetch(`/api/candidates/${id}`, { method: "DELETE" });
    load();
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected candidate(s)? This also removes their applications and resume variants.`)) return;
    await Promise.all(Array.from(selected).map((id) => fetch(`/api/candidates/${id}`, { method: "DELETE" })));
    load();
  }

  function exportCsv() {
    const csv = toCsv(filtered, ["name", "email", "phone", "status", "target_tier", "resume_filename"]);
    downloadCsv("candidates.csv", csv);
  }

  return (
    <>
      <div className="page-header">
        <h1>Candidates</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add candidate</button>
      </div>

      <div className="filter-bar">
        <input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="placed">Placed</option>
          <option value="paused">Paused</option>
          <option value="dropped">Dropped</option>
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          <option value="osp">OSP</option>
          <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
          <option value="adjacent_2">Adjacent 2 (Telecom)</option>
        </select>
        {(search || statusFilter || tierFilter) && (
          <button onClick={() => { setSearch(""); setStatusFilter(""); setTierFilter(""); }}>Clear filters</button>
        )}
        <button onClick={exportCsv}>Export CSV</button>
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} of {candidates.length}</span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
        </div>
      )}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : candidates.length === 0 ? (
        <div className="empty">No candidates yet. Add the first one to get started.</div>
      ) : filtered.length === 0 ? (
        <div className="empty">No candidates match these filters.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={selected.size === filtered.length} onChange={toggleAll} />
              </th>
              <th>Name</th>
              <th>Email</th>
              <th>Target tier</th>
              <th>Status</th>
              <th>Resume</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} /></td>
                <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {c.avatar_url ? (
                    <img className="avatar-circle" src={c.avatar_url} alt={c.name} />
                  ) : (
                    <span className="avatar-circle">{initials(c.name)}</span>
                  )}
                  <Link className="row-link" href={`/candidates/${c.id}`}>{c.name}</Link>
                </td>
                <td className="muted">{c.email || "—"}</td>
                <td>{c.target_tier ? <span className="badge">{c.target_tier}</span> : <span className="muted">—</span>}</td>
                <td className="muted">{c.status}</td>
                <td className="muted">{c.resume_filename || "Not uploaded"}</td>
                <td><button onClick={() => deleteOne(c.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <AddCandidateModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(); }}
        />
      )}
    </>
  );
}

function AddCandidateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [targetTier, setTargetTier] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    const res = await fetch("/api/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone, target_tier: targetTier || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    onCreated();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add candidate</h2>

        <div className="field-group">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </div>
        <div className="field-group">
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
        </div>
        <div className="field-group">
          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(optional)" />
        </div>
        <div className="field-group">
          <label>Target tier</label>
          <select value={targetTier} onChange={(e) => setTargetTier(e.target.value)}>
            <option value="">— None —</option>
            <option value="osp">OSP</option>
            <option value="adjacent_1">Adjacent 1 (Civil/CAD)</option>
            <option value="adjacent_2">Adjacent 2 (Telecom)</option>
          </select>
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add candidate"}
          </button>
        </div>
      </div>
    </div>
  );
}
