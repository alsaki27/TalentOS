"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CANDIDATE_OPT_STATUS_FIELDS,
  CANDIDATE_OPT_STATUS_NOT_PROVIDED,
  emptyCandidateOptStatusData,
  type CandidateOptStatusData,
  type CandidateOptStatusRecord,
} from "@/lib/candidateOptStatus";

interface EditableRecord {
  id: string | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  data: CandidateOptStatusData;
  savedData: CandidateOptStatusData;
  isNew: boolean;
}

function editableRecord(record: CandidateOptStatusRecord): EditableRecord {
  return {
    id: record.id,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    data: { ...record.data },
    savedData: { ...record.data },
    isNew: false,
  };
}

function formatSavedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function dateEntryMode(value: string | null, emptyMode: "date" | "month" = "date"): "date" | "month" | "not-provided" {
  if (value === CANDIDATE_OPT_STATUS_NOT_PROVIDED) return "not-provided";
  if (value && /^\d{4}-\d{2}$/.test(value)) return "month";
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  return emptyMode;
}

function formatDateValue(value: string | null): string {
  if (!value) return "—";
  if (value === CANDIDATE_OPT_STATUS_NOT_PROVIDED) return CANDIDATE_OPT_STATUS_NOT_PROVIDED;

  const isMonth = /^\d{4}-\d{2}$/.test(value);
  const dateValue = isMonth ? `${value}-01` : value;
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    ...(isMonth ? {} : { day: "numeric" as const }),
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function CandidateOptStatusPanel({ candidateId, canEdit }: { candidateId: string; canEdit: boolean }) {
  const [record, setRecord] = useState<EditableRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emptyDateModes, setEmptyDateModes] = useState<Record<string, "date" | "month">>({});

  const dirty = useMemo(() => Boolean(record && (
    record.isNew || CANDIDATE_OPT_STATUS_FIELDS.some(({ key }) => record.data[key] !== record.savedData[key])
  )), [record]);

  const load = useCallback(async () => {
    setEmptyDateModes({});
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/opt-status`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Could not load the status record.");
      setRecord(payload ? editableRecord(payload as CandidateOptStatusRecord) : null);
    } catch (err: any) {
      setLoadError(err?.message || "Could not load the status record.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => { void load(); }, [load]);

  function startRecord() {
    setError(null);
    const data = emptyCandidateOptStatusData();
    setRecord({ id: null, version: 0, createdAt: null, updatedAt: null, data, savedData: { ...data }, isNew: true });
  }

  function changeField(key: keyof CandidateOptStatusData, value: string) {
    setRecord((current) => current ? { ...current, data: { ...current.data, [key]: value } } : current);
    setError(null);
  }

  function cancelChanges() {
    if (!record) return;
    if (dirty && !window.confirm("Discard the unsaved OPT status changes?")) return;
    setError(null);
    if (record.isNew) setRecord(null);
    else setRecord({ ...record, data: { ...record.savedData } });
  }

  function reloadLatest() {
    if (dirty && !window.confirm("Reloading will discard your unsaved OPT status edits. Continue?")) return;
    void load();
  }

  async function save() {
    if (!record || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const isNew = record.isNew;
      const response = await fetch(
        isNew
          ? `/api/candidates/${candidateId}/opt-status`
          : `/api/candidates/${candidateId}/opt-status/${record.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: record.data, ...(isNew ? {} : { version: record.version }) }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save OPT status.");
      setRecord(editableRecord(payload as CandidateOptStatusRecord));
    } catch (err: any) {
      setError(err?.message || "Could not save OPT status. Your edits are still here; retry when ready.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (!record?.id || !window.confirm("Delete this candidate’s OPT/work authorization record?")) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/candidates/${candidateId}/opt-status/${record.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not delete OPT status.");
      setRecord(null);
    } catch (err: any) {
      setError(err?.message || "Could not delete OPT status.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="card"><p className="muted">Loading OPT/work authorization status…</p></div>;
  if (loadError) {
    return (
      <div className="card">
        <div className="alert alert-error" role="alert">{loadError}</div>
        <button className="btn-compact" onClick={() => void load()}>Retry</button>
      </div>
    );
  }

  return (
    <section aria-label="OPT status">
      <div className="page-header" style={{ alignItems: "center", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>OPT / Work Authorization Status</h2>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            {record?.updatedAt ? `Last saved ${formatSavedAt(record.updatedAt)}` : "Keep the current status and dates up to date."}
          </p>
        </div>
        {!record && canEdit && (
          <button className="btn-primary" onClick={startRecord}>+ Add OPT Status</button>
        )}
      </div>

      {!record ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No OPT/work authorization record has been added for this candidate yet.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-shell" style={{ maxHeight: "70vh", overflow: "auto", border: 0 }}>
            <table className="table" style={{ minWidth: 3180, margin: 0 }}>
              <thead>
                <tr>
                  {CANDIDATE_OPT_STATUS_FIELDS.map((field) => (
                    <th key={field.key} scope="col" style={{ position: "sticky", top: 0, zIndex: 1, minWidth: field.kind === "date" ? 220 : field.key === "notes" ? 360 : field.key === "premiumTriggerPlan" || field.key === "uscisCurrentStatus" || field.key === "expectedStartWorkEligibleDate" ? 260 : 170, background: "var(--surface, var(--card))", whiteSpace: "normal" }}>
                      {field.label}
                    </th>
                  ))}
                  {canEdit && <th scope="col" style={{ position: "sticky", top: 0, zIndex: 1, minWidth: 210, background: "var(--surface, var(--card))" }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {CANDIDATE_OPT_STATUS_FIELDS.map((field) => (
                    <td key={field.key} style={{ verticalAlign: "top", minWidth: field.kind === "date" ? 220 : field.key === "notes" ? 360 : field.key === "premiumTriggerPlan" || field.key === "uscisCurrentStatus" || field.key === "expectedStartWorkEligibleDate" ? 260 : 170 }}>
                      {canEdit ? field.kind === "date" ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 195 }}>
                          <select
                            className="input"
                            aria-label={`${field.label} entry type`}
                            value={dateEntryMode(record.data[field.key], emptyDateModes[field.key] ?? "date")}
                            disabled={saving || deleting}
                            onChange={(event) => {
                              const mode = event.target.value as "date" | "month" | "not-provided";
                              const current = record.data[field.key];
                              if (mode === "not-provided") {
                                changeField(field.key, CANDIDATE_OPT_STATUS_NOT_PROVIDED);
                              } else {
                                setEmptyDateModes((modes) => ({ ...modes, [field.key]: mode }));
                              }
                              if (mode !== "not-provided" && current === CANDIDATE_OPT_STATUS_NOT_PROVIDED) {
                                changeField(field.key, "");
                              } else if (mode === "month" && current && /^\d{4}-\d{2}-\d{2}$/.test(current)) {
                                changeField(field.key, current.slice(0, 7));
                              } else if (mode === "date" && current && /^\d{4}-\d{2}$/.test(current)) {
                                changeField(field.key, "");
                              }
                            }}
                          >
                            <option value="date">Full date</option>
                            <option value="month">Month &amp; year</option>
                            <option value="not-provided">Not Provided</option>
                          </select>
                          {dateEntryMode(record.data[field.key], emptyDateModes[field.key] ?? "date") !== "not-provided" && (
                            <input
                              className="input"
                              type={dateEntryMode(record.data[field.key], emptyDateModes[field.key] ?? "date") === "month" ? "month" : "date"}
                              aria-label={field.label}
                              value={record.data[field.key] === CANDIDATE_OPT_STATUS_NOT_PROVIDED ? "" : record.data[field.key] ?? ""}
                              onChange={(event) => {
                                setEmptyDateModes((modes) => ({ ...modes, [field.key]: event.target.type === "month" ? "month" : "date" }));
                                changeField(field.key, event.target.value);
                              }}
                              disabled={saving || deleting}
                            />
                          )}
                        </div>
                      ) : field.key === "notes" ? (
                        <textarea
                          className="input"
                          aria-label={field.label}
                          maxLength={field.maxLength}
                          rows={4}
                          value={record.data[field.key] ?? ""}
                          onChange={(event) => changeField(field.key, event.target.value)}
                          disabled={saving || deleting}
                          style={{ minWidth: 330, resize: "vertical" }}
                        />
                      ) : (
                        <input
                          className="input"
                          type="text"
                          aria-label={field.label}
                          maxLength={field.maxLength}
                          value={record.data[field.key] ?? ""}
                          onChange={(event) => changeField(field.key, event.target.value)}
                          disabled={saving || deleting}
                          style={{ minWidth: 150 }}
                        />
                      ) : (
                        <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{field.kind === "date" ? formatDateValue(record.data[field.key]) : record.data[field.key] || "—"}</span>
                      )}
                    </td>
                  ))}
                  {canEdit && (
                    <td style={{ verticalAlign: "top", position: "sticky", right: 0, background: "var(--card)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 7, minWidth: 180 }}>
                        <button className="btn-primary" onClick={() => void save()} disabled={!dirty || saving || deleting}>
                          {saving ? "Saving…" : record.isNew ? "Save OPT Status" : "Save Changes"}
                        </button>
                        {dirty && <button className="btn-compact" onClick={cancelChanges} disabled={saving || deleting}>Discard changes</button>}
                        {!record.isNew && <button className="btn-compact btn-danger" onClick={() => void deleteRecord()} disabled={saving || deleting || dirty}>{deleting ? "Deleting…" : "Delete record"}</button>}
                        <span className="muted" role="status" aria-live="polite" style={{ fontSize: 11 }}>
                          {saving ? "Saving to TalentOS…" : error ? "Save failed" : dirty ? "Unsaved changes" : record.updatedAt ? `Saved ${formatSavedAt(record.updatedAt)}` : "Not saved"}
                        </span>
                      </div>
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          {error && <div className="alert alert-error" role="alert" style={{ margin: 12 }}>{error}{error.includes("changed elsewhere") && <button className="btn-compact btn-sm" style={{ marginLeft: 8 }} onClick={reloadLatest}>Reload latest</button>}</div>}
        </div>
      )}
    </section>
  );
}
