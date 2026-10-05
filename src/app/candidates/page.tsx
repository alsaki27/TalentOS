// src/app/candidates/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toCsv, downloadCsv } from "@/lib/csv";
import Pagination from "@/components/Pagination";
import { CANDIDATE_PIPELINE_STAGES } from "@/lib/candidatePipeline";
import { formatOptCalendarDate, getOptApprovalCountdown, localCalendarDateIso } from "@/lib/candidateOptStatus";

interface Candidate {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  pipeline_stage: string;
  target_tier: string | null;
  resume_filename: string | null;
  avatar_url: string | null;
  audit_status?: string | null;
  audit_progress?: number | null;
  audit_mock_interviews?: number | null;
  opt_approval_date?: string | null;
}

const AUDIT_STATUS_LABELS: Record<string, string> = {
  placed: "Placed",
  excellent: "Excellent",
  good: "Good",
  needs_attention: "Needs Attention",
  bad: "At Risk",
};

const AUDIT_STATUS_CLASSES: Record<string, string> = {
  placed: "candidate-audit-placed",
  excellent: "candidate-audit-excellent",
  good: "candidate-audit-good",
  needs_attention: "candidate-audit-attention",
  bad: "candidate-audit-risk",
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}

function OptDaysLeftCell({ approvalDate, today }: { approvalDate: string | null; today: string }) {
  const countdown = approvalDate ? getOptApprovalCountdown(approvalDate, today) : null;
  if (!countdown) {
    return <span className="muted" title="A full OPT approval date is not recorded">—</span>;
  }

  const urgent = countdown.isExpired || (countdown.hasStarted && countdown.daysRemaining <= 14);
  const attention = countdown.hasStarted && countdown.daysRemaining > 14 && countdown.daysRemaining <= 30;
  const color = urgent ? "var(--danger)" : attention ? "var(--warn)" : "var(--accent)";
  const background = urgent ? "rgba(244,63,94,0.12)" : attention ? "rgba(245,158,11,0.13)" : "rgba(99,102,241,0.12)";
  const borderColor = urgent ? "rgba(244,63,94,0.28)" : attention ? "rgba(245,158,11,0.3)" : "rgba(99,102,241,0.28)";
  const label = countdown.isExpired
    ? "0 days left"
    : !countdown.hasStarted
      ? `Starts in ${countdown.daysUntilStart} ${countdown.daysUntilStart === 1 ? "day" : "days"}`
      : `${countdown.daysRemaining} ${countdown.daysRemaining === 1 ? "day" : "days"} left`;
  const deadlineLabel = countdown.isExpired
    ? `Ended ${formatOptCalendarDate(countdown.endDate)}`
    : countdown.endsToday
      ? `Ends today · ${formatOptCalendarDate(countdown.endDate)}`
      : `Ends ${formatOptCalendarDate(countdown.endDate)}`;

  return (
    <div title={`Approval: ${formatOptCalendarDate(countdown.approvalDate)} · ${deadlineLabel}`} style={{ display: "grid", justifyItems: "start", gap: 4, minWidth: 125 }}>
      <span className="badge" style={{ color, background, border: `1px solid ${borderColor}`, whiteSpace: "nowrap" }}>{label}</span>
      <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{deadlineLabel}</span>
    </div>
  );
}

function CandidateProfileCard({
  candidate,
  today,
  selected,
  stageUpdating,
  onToggle,
  onStageChange,
  onDelete,
}: {
  candidate: Candidate;
  today: string;
  selected: boolean;
  stageUpdating: boolean;
  onToggle: () => void;
  onStageChange: (stage: string) => void;
  onDelete: () => void;
}) {
  const progress = candidate.audit_progress;
  const statusLabel = candidate.status ? candidate.status.replaceAll("_", " ") : "Status unknown";

  return (
    <article className={`candidate-profile-card stage-card-${candidate.pipeline_stage}${selected ? " is-selected" : ""}`}>
      <div className="candidate-profile-card-header">
        <div className="candidate-profile-person">
          <input
            className="candidate-profile-checkbox"
            type="checkbox"
            aria-label={`Select ${candidate.name}`}
            checked={selected}
            onChange={onToggle}
          />
          {candidate.avatar_url ? (
            <img className="candidate-profile-avatar" src={candidate.avatar_url} alt="" />
          ) : (
            <span className="candidate-profile-avatar candidate-profile-avatar-initials" aria-hidden="true">{initials(candidate.name)}</span>
          )}
          <div className="candidate-profile-identity">
            <Link className="candidate-profile-name" href={`/candidates/${candidate.id}`}>{candidate.name}</Link>
            <span className="candidate-profile-email">{candidate.email || "No email listed"}</span>
          </div>
        </div>
        <span className={`candidate-record-status${candidate.status === "active" ? " is-active" : ""}`}>{statusLabel}</span>
      </div>

      <div className="candidate-profile-tags">
        {candidate.target_tier && <span className="candidate-info-tag">{candidate.target_tier.replaceAll("_", " ").toUpperCase()}</span>}
        {candidate.email?.includes("example.com") && <span className="badge badge-warning">Test record</span>}
      </div>

      <div className="candidate-profile-controls">
        <div className="candidate-profile-field">
          <span className="candidate-profile-label">Pipeline stage</span>
          <select
            aria-label={`${candidate.name} pipeline stage`}
            value={candidate.pipeline_stage}
            disabled={stageUpdating}
            onChange={(event) => onStageChange(event.target.value)}
            className={`candidate-profile-stage stage-select-${candidate.pipeline_stage}`}
          >
            {Object.entries(CANDIDATE_PIPELINE_STAGES).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="candidate-profile-field candidate-profile-opt-field">
          <span className="candidate-profile-label">OPT days left</span>
          <OptDaysLeftCell approvalDate={candidate.opt_approval_date ?? null} today={today} />
        </div>
      </div>

      <section className="candidate-training-summary" aria-label="Training audit summary">
        <div className="candidate-training-heading">
          <span className="candidate-profile-label">Training audit</span>
          {candidate.audit_status ? (
            <span className={`badge candidate-audit-status ${AUDIT_STATUS_CLASSES[candidate.audit_status] ?? ""}`}>
              {AUDIT_STATUS_LABELS[candidate.audit_status] ?? candidate.audit_status}
            </span>
          ) : (
            <span className="muted candidate-training-not-recorded">Not recorded</span>
          )}
        </div>
        <div className="candidate-training-metrics">
          <div className="candidate-training-metric">
            <span className="candidate-profile-label">Course progress</span>
            <strong>{progress != null ? `${progress}%` : "—"}</strong>
            <div className="candidate-progress-track" role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress != null ? Math.min(100, Math.max(0, progress)) : 0}>
              <span style={{ width: `${progress != null ? Math.min(100, Math.max(0, progress)) : 0}%` }} />
            </div>
          </div>
          <div className="candidate-training-metric">
            <span className="candidate-profile-label">Mock interviews</span>
            <strong>{candidate.audit_mock_interviews != null ? candidate.audit_mock_interviews : "—"}</strong>
            <span className="candidate-training-unit">recorded sessions</span>
          </div>
        </div>
      </section>

      <footer className="candidate-profile-card-footer">
        <Link href={`/candidates/${candidate.id}`} className="candidate-open-profile">Open candidate profile <span aria-hidden="true">→</span></Link>
        <button className="btn-danger candidate-delete-button" onClick={onDelete}>Delete</button>
      </footer>
    </article>
  );
}

function CandidateProfileCardSkeleton() {
  return (
    <div className="candidate-profile-card candidate-profile-card-skeleton" aria-hidden="true">
      <div className="candidate-skeleton-heading"><span /><div><i /><i /></div></div>
      <div className="candidate-skeleton-row"><i /><i /></div>
      <div className="candidate-skeleton-row"><i /><i /></div>
      <div className="candidate-skeleton-footer"><i /><i /></div>
    </div>
  );
}

export default function CandidatesPage() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [stageUpdating, setStageUpdating] = useState<string>("");
  const [today, setToday] = useState(() => localCalendarDateIso());

  useEffect(() => {
    const interval = window.setInterval(() => setToday(localCalendarDateIso()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
    params.set("includeOptDays", "1");
    if (search) params.set("search", search);
    if (stageFilter) params.set("pipelineStage", stageFilter);
    if (tierFilter) params.set("tier", tierFilter);
    return params;
  }

  async function load(pageNum: number, size: number = pageSize) {
    setLoading(true);
    const res = await fetch(`/api/candidates?${buildParams(pageNum, size)}`, { cache: "no-store" });
    const data = await res.json();
    const newTotal = data.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(newTotal / size));
    if (pageNum > totalPages && pageNum > 1) {
      setLoading(false);
      return load(totalPages, size);
    }
    setItems(data.items ?? []);
    setTotal(newTotal);
    setSelected(new Set());
    setPage(pageNum);
    setLoading(false);
  }

  // Any filter/search change re-queries from page 1.
  useEffect(() => { load(1, pageSize); }, [search, stageFilter, tierFilter, pageSize]);

  async function changeStage(id: string, stage: string) {
    setStageUpdating(id);
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, pipeline_stage: stage } : c)));
    try {
      const res = await fetch(`/api/candidates/${id}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage: stage }),
      });
      if (!res.ok) throw new Error("Update failed");
    } catch {
      load(page, pageSize); // revert optimistic update on failure
    } finally {
      setStageUpdating("");
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((c) => c.id))
    );
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this candidate? This also removes their applications and resume variants.")) return;
    await fetch(`/api/candidates/${id}`, { method: "DELETE", cache: "no-store" });
    load(page, pageSize);
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} selected candidate(s)? This also removes their applications and resume variants.`)) return;
    await fetch("/api/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DELETE", table: "candidates", ids: Array.from(selected) })
    });
    load(page, pageSize);
  }

  async function exportCsv() {
    const res = await fetch(`/api/candidates?${buildParams(1, 1000)}`, { cache: "no-store" });
    const data = await res.json();
    const rows = data.items ?? [];
    const csv = toCsv(rows, ["name", "email", "phone", "pipeline_stage", "target_tier", "resume_filename", "audit_status", "audit_progress", "audit_mock_interviews"]);
    downloadCsv("candidates.csv", csv);
  }

  const filtersActive = search || stageFilter || tierFilter;

  return (
    <div className="candidates-page">
      <div className="page-header">
        <h1>Candidates</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add candidate</button>
      </div>

      <div className="filter-bar">
        <input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All stages</option>
          <option value="not_started">Not Started</option>
          <option value="applying">Actively Applying</option>
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
        {filtersActive && (
          <button onClick={() => { setSearch(""); setStageFilter(""); setTierFilter(""); }}>Clear filters</button>
        )}
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      {loading ? (
        <div className="candidate-profile-grid" aria-label="Loading candidates">
          {Array.from({ length: 6 }, (_, index) => <CandidateProfileCardSkeleton key={index} />)}
        </div>
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No candidates match these filters." : "No candidates yet. Add the first one to get started."}</div>
      ) : (
        <>
          <div className="candidate-selection-toolbar">
            <label className="candidate-selection-control">
              <input
                type="checkbox"
                checked={items.length > 0 && selected.size === items.length}
                onChange={toggleAll}
                aria-label="Select all candidates on this page"
              />
              <span>Select all on this page</span>
            </label>
            <div className="candidate-selection-actions">
              <span className="muted">Showing {items.length} of {total}</span>
              {selected.size > 0 && (
                <>
                  <span className="candidate-selected-count">{selected.size} selected</span>
                  <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
                </>
              )}
            </div>
          </div>
          <div className="candidate-profile-grid">
            {items.map((candidate) => (
              <CandidateProfileCard
                key={candidate.id}
                candidate={candidate}
                today={today}
                selected={selected.has(candidate.id)}
                stageUpdating={stageUpdating === candidate.id}
                onToggle={() => toggleOne(candidate.id)}
                onStageChange={(stage) => changeStage(candidate.id, stage)}
                onDelete={() => deleteOne(candidate.id)}
              />
            ))}
          </div>
        </>
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

      {showAdd && (
        <AddCandidateModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(1, pageSize); }}
        />
      )}
    </div>
  );
}

function AddCandidateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [targetTier, setTargetTier] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [visaStatus, setVisaStatus] = useState("");
  const [locationPreference, setLocationPreference] = useState("");
  const [workModePreference, setWorkModePreference] = useState("");
  const [availableStartDate, setAvailableStartDate] = useState("");
  const [targetIndustries, setTargetIndustries] = useState("");
  const [targetRoles, setTargetRoles] = useState("");

  // Step 2 fields
  const [file, setFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function reset() {
    setStep(1);
    setName("");
    setEmail("");
    setPhone("");
    setTargetTier("");
    setLinkedinUrl("");
    setGithubUrl("");
    setPortfolioUrl("");
    setVisaStatus("");
    setLocationPreference("");
    setWorkModePreference("");
    setAvailableStartDate("");
    setTargetIndustries("");
    setTargetRoles("");
    setFile(null);
    setError("");
    setFeedback(null);
  }

  useEffect(() => {
    reset();
  }, []);

  async function submit() {
    if (!name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    setFeedback(null);

    const payload = {
      name,
      email: email || null,
      phone: phone || null,
      target_tier: targetTier || null,
      linkedin_url: linkedinUrl || null,
      github_url: githubUrl || null,
      portfolio_url: portfolioUrl || null,
      visa_status: visaStatus || null,
      target_industries: targetIndustries.split(",").map((s) => s.trim()).filter(Boolean),
      location_preference: locationPreference || null,
      work_mode_preference: workModePreference || null,
      available_start_date: availableStartDate || null,
      target_roles: targetRoles.split(",").map((s) => s.trim()).filter(Boolean),
    };

    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setFeedback({ kind: "error", text: data.error || "Something went wrong." });
        return;
      }

      const candidate = await res.json();
      const candidateId = candidate.id;

      if (file && candidateId) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("label", "Original Upload");
        formData.append("kind", "resume");
        formData.append("is_original_upload", "true");
        try {
          await fetch(`/api/candidates/${candidateId}/resumes`, {
            method: "POST",
            cache: "no-store",
            body: formData,
          });
        } catch {
          // Upload failure is non-blocking; candidate already created.
        }
      }

      setFeedback({ kind: "success", text: `Candidate "${name}" created.` });
      setTimeout(() => onCreated(), 800);
    } catch (err: any) {
      setFeedback({ kind: "error", text: err.message || "Network error." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add candidate — Step {step} of 2</h2>

        {step === 1 && (
          <>
            <div className="field-group">
              <label>Name <span style={{ color: "var(--danger)" }}>*</span></label>
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
            <div className="field-group">
              <label>LinkedIn URL</label>
              <input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div className="field-group">
              <label>GitHub URL</label>
              <input value={githubUrl} onChange={(e) => setGithubUrl(e.target.value)} placeholder="https://github.com/..." />
            </div>
            <div className="field-group">
              <label>Portfolio URL</label>
              <input value={portfolioUrl} onChange={(e) => setPortfolioUrl(e.target.value)} placeholder="https://..." />
            </div>
            <div className="field-group">
              <label>Visa Status</label>
              <input value={visaStatus} onChange={(e) => setVisaStatus(e.target.value)} placeholder="e.g. H-1B, OPT, Citizen..." />
            </div>
            <div className="field-group">
              <label>Location Preference</label>
              <input value={locationPreference} onChange={(e) => setLocationPreference(e.target.value)} placeholder="City, State, or Remote..." />
            </div>
            <div className="field-group">
              <label>Work Mode Preference</label>
              <select value={workModePreference} onChange={(e) => setWorkModePreference(e.target.value)}>
                <option value="">— Select —</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </div>
            <div className="field-group">
              <label>Available Start Date</label>
              <input type="date" value={availableStartDate} onChange={(e) => setAvailableStartDate(e.target.value)} />
            </div>
            <div className="field-group">
              <label>Target Industries</label>
              <input value={targetIndustries} onChange={(e) => setTargetIndustries(e.target.value)} placeholder="e.g. SaaS, Fintech, Healthcare (comma-separated)" />
            </div>
            <div className="field-group">
              <label>Target Roles</label>
              <input value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} placeholder="e.g. Backend Engineer, DevOps (comma-separated)" />
            </div>
          </>
        )}

        {step === 2 && (
          <div className="field-group">
            <label>Upload original resume (optional — AI will auto-parse)</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>{file.name}</p>}
          </div>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

        {feedback && (
          <div className={`alert ${feedback.kind === "error" ? "alert-error" : "alert-success"}`} style={{ marginTop: 8 }}>
            {feedback.text}
            <button className="alert-close" onClick={() => setFeedback(null)}>&times;</button>
          </div>
        )}

        <div className="modal-actions">
          {step === 1 ? (
            <>
              <button onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => setStep(2)} disabled={!name.trim()}>
                Next
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)}>Back</button>
              <button className="btn-primary" onClick={submit} disabled={saving}>
                {saving ? "Saving…" : "Create candidate"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
