"use client";

import { useEffect, useState } from "react";

type QcStage = "qualified" | "doubt" | "unqualified";
type QcTab = QcStage | "activity";

interface QcNote {
  stage: QcStage;
  note: string;
  created_by_name: string;
  created_at: string;
  updated_by_name: string;
  updated_at: string;
}

interface QcEvent {
  id: string;
  event_type: "stage_changed" | "note_created" | "note_updated" | "note_deleted";
  from_status: QcStage | null;
  to_status: QcStage | null;
  note_stage: QcStage | null;
  old_note: string | null;
  new_note: string | null;
  actor_name: string;
  created_at: string;
}

interface QcDetails {
  applicationId: string;
  applicationStage: string | null;
  eligible: boolean;
  canEdit: boolean;
  state: { status: QcStage; changed_at: string; changed_by_name: string } | null;
  notes: QcNote[];
  events: QcEvent[];
}

const STAGES: Array<{ value: QcStage; label: string; icon: string; color: string; tint: string }> = [
  { value: "qualified", label: "Qualified", icon: "✓", color: "#34d399", tint: "rgba(16,185,129,.13)" },
  { value: "doubt", label: "Doubt", icon: "?", color: "#fbbf24", tint: "rgba(245,158,11,.13)" },
  { value: "unqualified", label: "Unqualified", icon: "×", color: "#fb7185", tint: "rgba(244,63,94,.13)" },
];

function stageMeta(stage: QcStage | null | undefined) {
  return STAGES.find((item) => item.value === stage);
}

function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function ResumeQcDialog({
  applicationId,
  candidateName,
  jobTitle,
  company,
  onClose,
  onSaved,
}: {
  applicationId: string;
  candidateName: string;
  jobTitle: string;
  company: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [details, setDetails] = useState<QcDetails | null>(null);
  const [drafts, setDrafts] = useState<Record<QcStage, string>>({ qualified: "", doubt: "", unqualified: "" });
  const [activeTab, setActiveTab] = useState<QcTab>("qualified");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/applications/${applicationId}/resume-qc`, { cache: "no-store" })
      .then(async (response) => {
        const data = await readJson(response);
        if (!response.ok) throw new Error(data.error || "Could not load QC history.");
        if (!active) return;
        setDetails(data as QcDetails);
        const nextDrafts: Record<QcStage, string> = { qualified: "", doubt: "", unqualified: "" };
        for (const note of data.notes ?? []) nextDrafts[note.stage as QcStage] = note.note;
        setDrafts(nextDrafts);
        if (data.state?.status) setActiveTab(data.state.status);
      })
      .catch((loadError) => { if (active) setError(loadError.message || "Could not load QC history."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applicationId]);

  const noteByStage = new Map((details?.notes ?? []).map((note) => [note.stage, note]));

  async function save(action: "set_status" | "update_note", stage: QcStage) {
    if (!details) return;
    const note = drafts[stage].trim();
    if (action === "set_status" && stage !== "qualified" && !note) {
      setError("Add a note before marking a resume Doubt or Unqualified.");
      return;
    }
    if (action === "update_note" && stage !== "qualified" && !note) {
      setError("Doubt and Unqualified notes are required and cannot be cleared.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body: Record<string, string> = action === "set_status"
        ? { action, status: stage }
        : { action, stage, note };
      if (action === "set_status" && note) body.note = note;
      const response = await fetch(`/api/applications/${applicationId}/resume-qc`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "Could not save the QC update.");
      setDetails(data as QcDetails);
      const nextDrafts: Record<QcStage, string> = { qualified: "", doubt: "", unqualified: "" };
      for (const entry of data.notes ?? []) nextDrafts[entry.stage as QcStage] = entry.note;
      setDrafts(nextDrafts);
      setSuccess(action === "set_status" ? `${stageMeta(stage)?.label} status saved.` : "Note saved to the QC history.");
      onSaved();
    } catch (saveError: any) {
      setError(saveError?.message || "Could not save the QC update.");
    } finally {
      setSaving(false);
    }
  }

  function eventTitle(event: QcEvent) {
    if (event.event_type === "stage_changed") {
      return `${stageMeta(event.from_status)?.label ?? "Not checked"} → ${stageMeta(event.to_status)?.label ?? "Not checked"}`;
    }
    const stage = stageMeta(event.note_stage)?.label ?? "QC";
    if (event.event_type === "note_created") return `${stage} note added`;
    if (event.event_type === "note_deleted") return `${stage} note cleared`;
    return `${stage} note edited`;
  }

  const currentMeta = stageMeta(details?.state?.status);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      style={{ zIndex: 1200, padding: 12 }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-qc-title"
        className="modal"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: "min(900px, calc(100vw - 24px))",
          maxWidth: 900,
          height: "min(816px, calc(100dvh - 24px))",
          maxHeight: "calc(100dvh - 24px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: 0,
        }}
      >
        <header style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--accent, #4ade80)", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Resume quality check</div>
            <h2 id="resume-qc-title" style={{ margin: 0, fontSize: 20, lineHeight: 1.3 }}>QC notes &amp; activity</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 5, overflowWrap: "anywhere" }}>
              {candidateName} · {jobTitle}{company ? ` at ${company}` : ""}
            </div>
          </div>
          <button className="btn-compact" type="button" onClick={onClose} aria-label="Close QC dialog">✕</button>
        </header>

        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, flexShrink: 0 }}>
          <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>CURRENT QC</span>
          <span style={{
            border: `1px solid ${currentMeta?.color ?? "var(--border)"}`,
            background: currentMeta?.tint ?? "var(--surface-2)",
            color: currentMeta?.color ?? "var(--muted)",
            borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 800,
          }}>{currentMeta ? `${currentMeta.icon} ${currentMeta.label}` : "Not checked"}</span>
          {details?.state && <span className="text-muted" style={{ fontSize: 12 }}>Set by {details.state.changed_by_name} · {formatTime(details.state.changed_at)}</span>}
          {details && !details.eligible && <span className="text-muted" style={{ marginLeft: "auto", fontSize: 12 }}>Editing is available in In AI Pipeline, AE Review Pending, and Ready for AE Application.</span>}
        </div>

        <nav role="tablist" aria-label="Resume QC notes and activity" style={{ display: "flex", flexShrink: 0, minHeight: 53, alignItems: "end", gap: 6, overflowX: "auto", padding: "12px 24px 0", borderBottom: "1px solid var(--border)" }}>
          {[...STAGES.map((stage) => ({ value: stage.value as QcTab, label: stage.label })), { value: "activity" as QcTab, label: `Activity${details?.events?.length ? ` (${details.events.length})` : ""}` }].map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => { setActiveTab(tab.value); setError(""); setSuccess(""); }}
              style={{
                flex: "0 0 auto", padding: "9px 13px", border: "1px solid var(--border)",
                borderBottom: activeTab === tab.value ? "2px solid var(--accent, #4ade80)" : "1px solid var(--border)",
                borderRadius: "8px 8px 0 0", color: activeTab === tab.value ? "var(--ink)" : "var(--muted)",
                background: activeTab === tab.value ? "var(--surface-2)" : "transparent", fontWeight: 700, cursor: "pointer",
              }}
            >{tab.label}</button>
          ))}
        </nav>

        <div style={{ flex: "1 1 auto", minHeight: 0, padding: 24, overflowY: "auto" }}>
          {loading ? <div className="text-muted" style={{ textAlign: "center", padding: 35 }}>Loading QC history…</div> : error && !details ? (
            <div className="form-error" role="alert">{error}</div>
          ) : activeTab === "activity" ? (
            <div style={{ display: "grid", gap: 10 }}>
              {!details?.events.length ? <div className="text-muted" style={{ textAlign: "center", padding: 30 }}>No QC changes have been recorded yet.</div> : details.events.map((event) => (
                <article key={event.id} style={{ border: "1px solid var(--border)", background: "var(--surface-2)", borderRadius: 10, padding: 13, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <strong style={{ fontSize: 13 }}>{eventTitle(event)}</strong>
                    <time className="text-muted" style={{ fontSize: 12 }}>{formatTime(event.created_at)}</time>
                  </div>
                  <div className="text-muted" style={{ fontSize: 12 }}>Changed by {event.actor_name}</div>
                  {event.old_note && <div style={{ fontSize: 12, overflowWrap: "anywhere" }}><strong>Previous note:</strong> {event.old_note}</div>}
                  {event.new_note && <div style={{ fontSize: 12, overflowWrap: "anywhere" }}><strong>{event.event_type === "stage_changed" ? "Note at decision:" : "Saved note:"}</strong> {event.new_note}</div>}
                </article>
              ))}
            </div>
          ) : (
            (() => {
              const stage = activeTab as QcStage;
              const meta = stageMeta(stage)!;
              const note = noteByStage.get(stage);
              const draft = drafts[stage];
              const hasChanges = draft !== (note?.note ?? "");
              const required = stage !== "qualified";
              return (
                <div style={{ display: "grid", gap: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h3 style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", color: meta.color }}><span aria-hidden="true">{meta.icon}</span>{meta.label} note</h3>
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 5 }}>{required ? "A note is required for this QC status." : "A note is optional for this QC status."}</div>
                    </div>
                    {details?.state?.status === stage && <span className="badge badge-info">Current stage</span>}
                  </div>

                  {note ? (
                    <div className="text-muted" style={{ fontSize: 12, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <span>Last note update by {note.updated_by_name}</span><span>·</span><time>{formatTime(note.updated_at)}</time>
                    </div>
                  ) : <div className="text-muted" style={{ fontSize: 12 }}>No note saved for this stage yet.</div>}

                  <textarea
                    className="input"
                    aria-label={`${meta.label} QC note`}
                    value={draft}
                    onChange={(event) => setDrafts((current) => ({ ...current, [stage]: event.target.value }))}
                    readOnly={!details?.canEdit}
                    maxLength={8000}
                    rows={6}
                    placeholder={details?.canEdit ? (required ? "Describe the resume issues or evidence for this decision…" : "Optional note about why this resume qualified…") : "No note has been added for this stage."}
                    style={{ width: "100%", minHeight: 145, resize: "vertical", lineHeight: 1.5, fontSize: 14 }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                    <span className="text-muted" style={{ fontSize: 11 }}>{draft.length.toLocaleString()} / 8,000 characters</span>
                    {details?.canEdit && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <button type="button" className="btn-compact" onClick={() => save("update_note", stage)} disabled={saving || !hasChanges || (required && !draft.trim())}>
                          {saving ? "Saving…" : "Save note"}
                        </button>
                        {details.state?.status !== stage && (
                          <button
                            type="button"
                            className="btn-primary btn-compact"
                            onClick={() => save("set_status", stage)}
                            disabled={saving || (required && !draft.trim())}
                            style={{ borderColor: meta.color, background: meta.tint, color: meta.color }}
                          >Mark as {meta.label}</button>
                        )}
                      </div>
                    )}
                  </div>
                  {details?.canEdit && required && !draft.trim() && <div className="form-error" role="note">Add a note before saving or selecting {meta.label}.</div>}
                </div>
              );
            })()
          )}
          {error && details && <div className="form-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
          {success && <div role="status" style={{ marginTop: 12, color: "#34d399", fontSize: 13 }}>{success}</div>}
        </div>

        <footer style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexShrink: 0 }}>
          <span className="text-muted" style={{ fontSize: 11 }}>QC changes and note edits are time-stamped and attributed.</span>
          <button type="button" className="btn-compact" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  );
}
