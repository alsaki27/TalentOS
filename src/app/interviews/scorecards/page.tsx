"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ScorecardTemplate {
  id: string;
  name: string;
  role_type: string;
  competencies: string[];
  is_default: boolean;
  created_at: string;
}

export default function ScorecardTemplatesPage() {
  const [templates, setTemplates] = useState<ScorecardTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ScorecardTemplate | null>(null);
  const [name, setName] = useState("");
  const [roleType, setRoleType] = useState("General");
  const [competencies, setCompetencies] = useState<string[]>([""]);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/scorecard-templates", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load templates.");
      const data = await res.json();
      setTemplates(data ?? []);
    } catch (err: any) {
      setError(err.message || "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setName("");
    setRoleType("General");
    setCompetencies([""]);
    setIsDefault(false);
    setShowModal(true);
  }

  function openEdit(t: ScorecardTemplate) {
    setEditing(t);
    setName(t.name);
    setRoleType(t.role_type || "General");
    setCompetencies(t.competencies?.length ? [...t.competencies] : [""]);
    setIsDefault(t.is_default ?? false);
    setShowModal(true);
  }

  async function save() {
    if (!name.trim()) { setError("Name is required."); return; }
    const cleanCompetencies = competencies.map((c) => c.trim()).filter(Boolean);
    if (cleanCompetencies.length === 0) { setError("At least one competency is required."); return; }
    setSaving(true);
    setError("");
    if (editing) {
      const res = await fetch("/api/scorecard-templates", {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, name, role_type: roleType, competencies: cleanCompetencies, is_default: isDefault }),
      });
      setSaving(false);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not update template.");
        return;
      }
    } else {
      const res = await fetch("/api/scorecard-templates", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, roleType, competencies: cleanCompetencies, isDefault }),
      });
      setSaving(false);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not create template.");
        return;
      }
    }
    setShowModal(false);
    load();
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    const res = await fetch(`/api/scorecard-templates?id=${id}`, { method: "DELETE", cache: "no-store" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not delete template.");
      return;
    }
    load();
  }

  function addCompetency() {
    setCompetencies((prev) => [...prev, ""]);
  }

  function removeCompetency(index: number) {
    setCompetencies((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCompetency(index: number, value: string) {
    setCompetencies((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Scorecard Templates</h1>
          <div className="page-kicker">Define reusable competency frameworks for interview rounds.</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/interviews"><button>Back</button></Link>
          <button className="btn-primary" onClick={openCreate}>Create Template</button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      {loading ? (
        <div className="loading-panel">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="empty">No scorecard templates yet.</div>
      ) : (
        <div className="table-shell">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role Type</th>
                <th>Competencies</th>
                <th>Default</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="cell-main">
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                  </td>
                  <td><span className="badge">{t.role_type || "General"}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {(t.competencies ?? []).map((c) => <span key={c} className="badge">{c}</span>)}
                    </div>
                  </td>
                  <td>{t.is_default ? <span className="badge badge-offer">Default</span> : "—"}</td>
                  <td>
                    <div className="action-group">
                      <button className="btn-compact" onClick={() => openEdit(t)}>Edit</button>
                      <button className="btn-compact btn-danger" onClick={() => deleteTemplate(t.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit Template" : "Create Template"}</h2>
            <div className="field-group">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Engineering Technical Round" />
            </div>
            <div className="field-group">
              <label>Role Type</label>
              <select value={roleType} onChange={(e) => setRoleType(e.target.value)}>
                <option value="General">General</option>
                <option value="Engineering">Engineering</option>
                <option value="Sales">Sales</option>
                <option value="Design">Design</option>
                <option value="Marketing">Marketing</option>
                <option value="Product">Product</option>
              </select>
            </div>
            <div className="field-group">
              <label>Competencies</label>
              {competencies.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input value={c} onChange={(e) => updateCompetency(i, e.target.value)} placeholder="Competency name" style={{ flex: 1 }} />
                  <button className="btn-compact btn-danger" onClick={() => removeCompetency(i)} disabled={competencies.length <= 1}>Remove</button>
                </div>
              ))}
              <button className="btn-compact" onClick={addCompetency}>+ Add Competency</button>
            </div>
            <div className="field-group">
              <label className="checkbox-row">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                Set as default template
              </label>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving..." : editing ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
