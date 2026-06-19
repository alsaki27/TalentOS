"use client";

import { useEffect, useState } from "react";
import TemplateEditor from "@/components/TemplateEditor";
import Pagination from "@/components/Pagination";

const CATEGORIES = ["All", "Outreach", "Rejection", "Offer", "Screening", "Follow-up", "Custom"];

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  is_default: boolean;
  created_at: string;
}

export default function TemplatesPage() {
  const [items, setItems] = useState<EmailTemplate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);
  const [error, setError] = useState("");

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("general");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formDefault, setFormDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setFormName("");
    setFormCategory("general");
    setFormSubject("");
    setFormBody("");
    setFormDefault(false);
    setError("");
  }

  function openCreate() {
    resetForm();
    setEditing(null);
    setShowModal(true);
  }

  function openEdit(t: EmailTemplate) {
    setFormName(t.name);
    setFormCategory(t.category);
    setFormSubject(t.subject);
    setFormBody(t.body);
    setFormDefault(t.is_default);
    setEditing(t);
    setShowModal(true);
  }

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
    if (search) params.set("search", search);
    if (category !== "All") params.set("category", category.toLowerCase());
    return params;
  }

  async function load(pageNum: number, size: number = pageSize) {
    setLoading(true);
    const res = await fetch(`/api/email-templates?${buildParams(pageNum, size)}`, { cache: "no-store" });
    const data = await res.json();
    const newTotal = data.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(newTotal / size));
    if (pageNum > totalPages && pageNum > 1) {
      setLoading(false);
      return load(totalPages, size);
    }
    setItems(data.items ?? []);
    setTotal(newTotal);
    setPage(pageNum);
    setLoading(false);
  }

  useEffect(() => { load(1, pageSize); }, [search, category, pageSize]);

  async function save() {
    if (!formName.trim() || !formSubject.trim() || !formBody.trim()) {
      setError("Name, subject, and body are required.");
      return;
    }
    setSaving(true);
    setError("");
    const url = "/api/email-templates";
    const method = editing ? "PATCH" : "POST";
    const body = editing
      ? { id: editing.id, name: formName, subject: formSubject, body: formBody, category: formCategory, is_default: formDefault }
      : { name: formName, subject: formSubject, body: formBody, category: formCategory, is_default: formDefault };

    const res = await fetch(url, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong.");
      return;
    }
    setShowModal(false);
    resetForm();
    load(page, pageSize);
  }

  async function duplicate(t: EmailTemplate) {
    const res = await fetch("/api/email-templates", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${t.name} (Copy)`,
        subject: t.subject,
        body: t.body,
        category: t.category,
        is_default: false,
      }),
    });
    if (res.ok) load(page, pageSize);
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/email-templates?id=${id}`, { method: "DELETE", cache: "no-store" });
    load(page, pageSize);
  }

  const filtersActive = search || category !== "All";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Email Templates</h1>
          <p className="page-kicker">Create and manage reusable email templates with merge tags.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Create Template</button>
      </div>

      <div className="filter-bar">
        <input placeholder="Search by name or subject…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={category === cat ? "btn-primary" : "btn-compact"}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        {filtersActive && (
          <button onClick={() => { setSearch(""); setCategory("All"); }}>Clear filters</button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{items.length} of {total}</span>
      </div>

      {loading ? (
        <div className="loading-panel">Loading templates…</div>
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No templates match these filters." : "No templates yet. Create one to get started."}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {items.map((t) => (
            <div key={t.id} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</span>
                {t.is_default && <span className="badge">Default</span>}
              </div>
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>{t.subject}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="badge">{t.category}</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                <button className="btn-compact" onClick={() => openEdit(t)}>Edit</button>
                <button className="btn-compact" onClick={() => duplicate(t)}>Duplicate</button>
                <button className="btn-compact" onClick={() => setPreviewTemplate(t)}>Preview</button>
                <button className="btn-compact btn-danger" onClick={() => deleteOne(t.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(newPage) => load(newPage, pageSize)}
          onPageSizeChange={(newSize) => setPageSize(newSize)}
        />
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "95vw" }}>
            <h2>{editing ? "Edit Template" : "Create Template"}</h2>
            <div className="field-group">
              <label>Name</label>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Template name…" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field-group">
                <label>Category</label>
                <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                  {CATEGORIES.filter((c) => c !== "All").map((cat) => (
                    <option key={cat} value={cat.toLowerCase()}>{cat}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label className="checkbox-row" style={{ marginTop: 22 }}>
                  <input type="checkbox" checked={formDefault} onChange={(e) => setFormDefault(e.target.checked)} />
                  Set as default for this category
                </label>
              </div>
            </div>
            <TemplateEditor
              value={formBody}
              onChange={setFormBody}
              subject={formSubject}
              onSubjectChange={setFormSubject}
            />
            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{error}</p>}
            <div className="modal-actions">
              <button onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewTemplate && (
        <div className="modal-overlay" onClick={() => setPreviewTemplate(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
            <h2>Preview: {previewTemplate.name}</h2>
            <div className="card" style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Subject: {previewTemplate.subject}</div>
              <div
                style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: previewTemplate.body.replace(/\n/g, "<br/>") }}
              />
            </div>
            <div className="modal-actions">
              <button onClick={() => setPreviewTemplate(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
