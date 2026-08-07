// src/app/candidates/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toCsv, downloadCsv } from "@/lib/csv";
import { TableSkeleton } from "../Skeleton";
import Pagination from "@/components/Pagination";

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
}

const STAGE_LABELS: Record<string, string> = {
  not_started: "Not Started",
  applying: "Actively Applying",
  placed: "Placed",
  dropped: "Dropped",
};

const STAGE_BADGE_CLASS: Record<string, string> = {
  not_started: "badge-waiting",
  applying: "badge-scheduled",
  placed: "badge-offer",
  dropped: "badge-closed",
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
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

  function buildParams(pageNum: number, size: number) {
    const params = new URLSearchParams();
    params.set("page", String(pageNum));
    params.set("pageSize", String(size));
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
    const csv = toCsv(rows, ["name", "email", "phone", "pipeline_stage", "target_tier", "resume_filename"]);
    downloadCsv("candidates.csv", csv);
  }

  const filtersActive = search || stageFilter || tierFilter;

  return (
    <>
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
        <span className="muted" style={{ fontSize: 12 }}>{items.length} of {total}</span>
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button className="btn-danger" onClick={deleteSelected}>Delete selected</button>
        </div>
      )}

      {loading ? (
        <TableSkeleton cols={7} />
      ) : total === 0 ? (
        <div className="empty">{filtersActive ? "No candidates match these filters." : "No candidates yet. Add the first one to get started."}</div>
      ) : (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Target tier</th>
                <th>Stage</th>
                <th>Resume</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} /></td>
                  <td style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {c.avatar_url ? (
                      <img className="avatar-circle" src={c.avatar_url} alt={c.name} />
                    ) : (
                      <span className="avatar-circle">{initials(c.name)}</span>
                    )}
                    <Link className="row-link" href={`/candidates/${c.id}`}>{c.name}</Link>
                    {c.email?.includes("example.com") && <span className="badge badge-warning" style={{ marginLeft: 8, fontSize: 10 }}>Test Record</span>}
                  </td>
                  <td className="muted">{c.email || "—"}</td>
                  <td>{c.target_tier ? <span className="badge">{c.target_tier}</span> : <span className="muted">—</span>}</td>
                  <td>
                    <select
                      value={c.pipeline_stage}
                      disabled={stageUpdating === c.id}
                      onChange={(e) => changeStage(c.id, e.target.value)}
                      className={`badge ${STAGE_BADGE_CLASS[c.pipeline_stage] ?? ""}`}
                      style={{ cursor: "pointer", border: "none" }}
                    >
                      {Object.entries(STAGE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">{c.resume_filename || "Not uploaded"}</td>
                  <td><button onClick={() => deleteOne(c.id)}>Delete</button></td>
                </tr>
              ))}
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

      {showAdd && (
        <AddCandidateModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); load(1, pageSize); }}
        />
      )}
    </>
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
