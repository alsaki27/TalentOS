"use client";

import { useEffect, useState } from "react";
import SequenceBuilder from "@/components/SequenceBuilder";
import Pagination from "@/components/Pagination";

interface EmailSequence {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string | null;
  is_active: boolean;
  created_at: string;
  steps?: SequenceStep[];
}

interface SequenceStep {
  id?: string;
  step_number: number;
  template_id: string;
  delay_hours: number;
  send_time?: string | null;
  condition?: string | null;
  template?: { id: string; name: string; subject: string };
}

interface TemplateOption {
  id: string;
  name: string;
  subject: string;
}

const TRIGGER_EVENTS = [
  { value: "application_created", label: "Application Created" },
  { value: "stage_changed", label: "Stage Changed" },
  { value: "no_activity_7", label: "No Activity 7 Days" },
  { value: "no_activity_14", label: "No Activity 14 Days" },
  { value: "interview_scheduled", label: "Interview Scheduled" },
];

export default function SequencesPage() {
  const [items, setItems] = useState<EmailSequence[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<EmailSequence | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [error, setError] = useState("");

  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formTrigger, setFormTrigger] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formSteps, setFormSteps] = useState<SequenceStep[]>([]);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormTrigger("");
    setFormActive(true);
    setFormSteps([]);
    setError("");
  }

  function openCreate() {
    resetForm();
    setEditing(null);
    setShowModal(true);
  }

  function openEdit(seq: EmailSequence) {
    setFormName(seq.name);
    setFormDescription(seq.description ?? "");
    setFormTrigger(seq.trigger_event ?? "");
    setFormActive(seq.is_active);
    setFormSteps((seq.steps ?? []).map((s) => ({ ...s, id: s.id ?? "" })));
    setEditing(seq);
    setShowModal(true);
  }

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
    if (search) params.set("search", search);
    return params;
  }

  async function load(pageNum: number, size: number = pageSize) {
    setLoading(true);
    const [seqRes, tplRes] = await Promise.all([
      fetch(`/api/email-sequences?${buildParams(pageNum, size)}`, { cache: "no-store" }),
      fetch(`/api/email-templates?page=1&pageSize=200`, { cache: "no-store" }),
    ]);
    const seqData = await seqRes.json();
    const tplData = await tplRes.json();
    const newTotal = seqData.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(newTotal / size));
    if (pageNum > totalPages && pageNum > 1) {
      setLoading(false);
      return load(totalPages, size);
    }
    setItems(seqData.items ?? []);
    setTotal(newTotal);
    setPage(pageNum);
    setTemplates((tplData.items ?? []).map((t: any) => ({ id: t.id, name: t.name, subject: t.subject })));
    setLoading(false);
  }

  useEffect(() => { load(1, pageSize); }, [search, pageSize]);

  async function save() {
    if (!formName.trim()) { setError("Name is required."); return; }
    if (formSteps.length === 0) { setError("Add at least one step."); return; }
    setSaving(true);
    setError("");
    const url = "/api/email-sequences";
    const method = editing ? "PATCH" : "POST";
    const body = editing
      ? {
          id: editing.id,
          name: formName,
          description: formDescription || null,
          trigger_event: formTrigger || null,
          is_active: formActive,
          steps: formSteps.map((s) => ({
            step_number: s.step_number,
            template_id: s.template_id,
            delay_hours: s.delay_hours,
            send_time: s.send_time,
            condition: s.condition,
          })),
        }
      : {
          name: formName,
          description: formDescription || null,
          trigger_event: formTrigger || null,
          is_active: formActive,
          steps: formSteps.map((s) => ({
            step_number: s.step_number,
            template_id: s.template_id,
            delay_hours: s.delay_hours,
            send_time: s.send_time,
            condition: s.condition,
          })),
        };

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

  async function toggleActive(seq: EmailSequence) {
    await fetch("/api/email-sequences", {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: seq.id, is_active: !seq.is_active }),
    });
    load(page, pageSize);
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this sequence?")) return;
    await fetch(`/api/email-sequences?id=${id}`, { method: "DELETE", cache: "no-store" });
    load(page, pageSize);
  }

  async function triggerSequence(seqId: string) {
    const candidateId = prompt("Enter candidate ID to trigger for:");
    if (!candidateId) return;
    const res = await fetch(`/api/email-sequences/${seqId}/trigger`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidate_id: candidateId }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Trigger failed.");
    } else {
      alert("Sequence triggered successfully.");
    }
  }

  const filtersActive = search;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Email Sequences</h1>
          <p className="page-kicker">Build drip campaigns that trigger based on candidate events.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Create Sequence</button>
      </div>

      <div className="filter-bar">
        <input placeholder="Search sequences…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        {filtersActive && <button onClick={() => setSearch("")}>Clear</button>}
        <span className="muted" style={{ fontSize: 12 }}>{items.length} of {total}</span>
      </div>

      {loading ? (
        <div className="loading-panel">Loading sequences…</div>
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No sequences match." : "No sequences yet. Create one to get started."}</div>
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Trigger</th>
                <th>Steps</th>
                <th>Status</th>
                <th>Engagement</th>
                <th style={{ width: 200 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((seq) => {
                const stepCount = seq.steps?.length ?? 0;
                const mockOpenRate = seq.is_active ? `${Math.floor(35 + Math.random() * 25)}%` : "—";
                const mockReplyRate = seq.is_active ? `${Math.floor(5 + Math.random() * 15)}%` : "—";
                return (
                  <tr key={seq.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{seq.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{seq.description || "—"}</div>
                    </td>
                    <td>
                      <span className="badge">
                        {TRIGGER_EVENTS.find((t) => t.value === seq.trigger_event)?.label || seq.trigger_event || "Manual"}
                      </span>
                    </td>
                    <td>{stepCount} step{stepCount !== 1 ? "s" : ""}</td>
                    <td>
                      <span className={seq.is_active ? "badge badge-interview" : "badge badge-closed"}>
                        {seq.is_active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }}>Open: <strong>{mockOpenRate}</strong></div>
                      <div style={{ fontSize: 12 }}>Reply: <strong>{mockReplyRate}</strong></div>
                    </td>
                    <td>
                      <div className="action-group">
                        <button className="btn-compact" onClick={() => openEdit(seq)}>Edit</button>
                        <button className="btn-compact" onClick={() => toggleActive(seq)}>
                          {seq.is_active ? "Pause" : "Activate"}
                        </button>
                        <button className="btn-compact" onClick={() => triggerSequence(seq.id)}>Trigger</button>
                        <button className="btn-compact btn-danger" onClick={() => deleteOne(seq.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto" }}>
            <h2>{editing ? "Edit Sequence" : "Create Sequence"}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field-group">
                <label>Name</label>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Sequence name…" />
              </div>
              <div className="field-group">
                <label>Trigger Event</label>
                <select value={formTrigger} onChange={(e) => setFormTrigger(e.target.value)}>
                  <option value="">— Manual —</option>
                  {TRIGGER_EVENTS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-group">
              <label>Description</label>
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} placeholder="Optional description…" />
            </div>
            <label className="checkbox-row" style={{ marginBottom: 12 }}>
              <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
              Active
            </label>
            <SequenceBuilder steps={formSteps} onChange={setFormSteps} templates={templates} />
            {error && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{error}</p>}
            <div className="modal-actions">
              <button onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Sequence"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
