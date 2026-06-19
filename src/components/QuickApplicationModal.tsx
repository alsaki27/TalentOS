// src/components/QuickApplicationModal.tsx
// Quick Application modal — 4-step workflow:
// 1. Select candidate
// 2. Paste JD and auto-analyze
// 3. Review job (handle duplicates)
// 4. Create application
//
// Uses existing API routes only. No direct Supabase calls.

"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

/* ─────────── types ─────────── */

interface Candidate {
  id: string;
  name: string;
  email: string | null;
}

interface JdAnalysis {
  title: string | null;
  company: string | null;
  location: string | null;
  workplaceType: string;
  employmentType: string;
  requiredSkills: string[];
  preferredSkills: string[];
  seniorityLevel: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string;
  redFlags: { flag: string; severity: string; reason: string }[];
  confidenceScore: number;
  fitSummary: string;
}

interface DuplicateJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  matchType: string;
  matchScore: number;
}

interface CreatedJob {
  id: string;
  title: string;
  company: string | null;
}

interface ApplicationResult {
  id: string;
  candidate_id: string;
  job_id: string | null;
  status: string;
}

interface Props {
  onClose: () => void;
}

const STEP_LABELS = ["Candidate", "Paste JD", "Review Job", "Create Application"];

const SOURCE_TYPES = [
  { value: "base_resume", label: "Base Resume" },
  { value: "original_resume", label: "Original Resume" },
  { value: "blank", label: "Blank" },
  { value: "manual", label: "Manual" },
];

const STATUS_OPTIONS = [
  { value: "stacked", label: "Stacked" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In Progress" },
  { value: "applied", label: "Applied" },
];

export default function QuickApplicationModal({ onClose }: Props) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1: Candidate
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  // Step 2: JD
  const [rawText, setRawText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [analysis, setAnalysis] = useState<JdAnalysis | null>(null);
  const [analyzeError, setAnalyzeError] = useState("");

  // Step 3: Job
  const [selectedJob, setSelectedJob] = useState<CreatedJob | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateJob[]>([]);
  const [showDuplicateChoice, setShowDuplicateChoice] = useState(false);
  const [duplicateChoice, setDuplicateChoice] = useState<"existing" | "force" | null>(null);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string | null>(null);

  // Step 4: Application
  const [sourceType, setSourceType] = useState("base_resume");
  const [status, setStatus] = useState("stacked");
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [createdApp, setCreatedApp] = useState<ApplicationResult | null>(null);
  const [appError, setAppError] = useState("");

  /* ── fetch candidates ── */
  const fetchCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    const params = new URLSearchParams();
    params.set("compact", "1");
    params.set("pageSize", "200");
    if (candidateSearch.trim()) params.set("search", candidateSearch.trim());
    const res = await fetch(`/api/candidates?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setCandidates(data.items ?? []);
    }
    setCandidatesLoading(false);
  }, [candidateSearch]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  /* ── step 1 confirm ── */
  function goToStep2() {
    if (!selectedCandidate) {
      setError("Please select a candidate.");
      return;
    }
    setError("");
    setStep(2);
  }

  /* ── auto-analyze JD ── */
  async function analyzeJD() {
    if (!rawText.trim()) {
      setAnalyzeError("Please paste a job description.");
      return;
    }
    setLoading(true);
    setAnalyzeError("");
    setAnalysis(null);
    const res = await fetch("/api/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: rawText.trim() }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data.error || "Analysis failed";
      if (res.status === 400) setAnalyzeError(`Bad request: ${msg}`);
      else if (res.status === 401) setAnalyzeError("Unauthenticated. Please log in.");
      else if (res.status === 403) setAnalyzeError("You do not have permission to analyze job descriptions.");
      else if (res.status === 503) setAnalyzeError("AI provider is not configured.");
      else if (res.status === 502) setAnalyzeError(`AI provider failed: ${msg}`);
      else setAnalyzeError(msg);
      return;
    }
    const data = await res.json();
    setAnalysis(data.analysis);
  }

  function goToStep3() {
    if (!analysis) {
      setAnalyzeError("Please analyze the JD first.");
      return;
    }
    if (!analysis.title) {
      setAnalyzeError("AI could not extract a job title. Please paste a clearer JD.");
      return;
    }
    setAnalyzeError("");
    setError("");
    setStep(3);
  }

  /* ── create/select job ── */
  async function createJobFromJD(forceCreate = false, useExistingJobId?: string) {
    setLoading(true);
    setError("");
    setShowDuplicateChoice(false);
    setDuplicates([]);
    setDuplicateChoice(null);
    setSelectedDuplicateId(null);

    const body: any = {
      rawText: rawText.trim(),
      sourceUrl: sourceUrl.trim() || undefined,
    };
    if (forceCreate) body.forceCreate = true;
    if (useExistingJobId) body.useExistingJobId = useExistingJobId;

    const res = await fetch("/api/jobs/from-jd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setLoading(false);

    if (res.status === 422) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "AI could not extract a job title. Please paste a clearer JD.");
      return;
    }

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      setDuplicates(data.duplicates ?? []);
      setShowDuplicateChoice(true);
      setError("Possible duplicate job(s) found. Choose an action below.");
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not create job.");
      return;
    }

    const data = await res.json();
    setSelectedJob(data.job);
    setShowDuplicateChoice(false);
  }

  function handleDuplicateAction() {
    if (!duplicateChoice) return;
    if (duplicateChoice === "existing" && selectedDuplicateId) {
      createJobFromJD(false, selectedDuplicateId);
    } else if (duplicateChoice === "force") {
      createJobFromJD(true);
    }
  }

  /* ── create application ── */
  async function createApplication() {
    if (!selectedCandidate) {
      setAppError("No candidate selected.");
      return;
    }
    setLoading(true);
    setAppError("");

    const body: any = {
      candidate_id: selectedCandidate.id,
      status,
      source_type: sourceType,
      notes: notes.trim() || null,
    };

    if (selectedJob) {
      body.job_id = selectedJob.id;
    } else {
      // ad-hoc only: send raw text and parsed analysis as adhoc data
      body.adhoc_job_raw_text = rawText.trim();
      body.adhoc_job_data = analysis;
    }

    if (assignedTo.trim()) body.assigned_to_user_id = assignedTo.trim();
    if (assignmentNote.trim()) body.assignment_note = assignmentNote.trim();

    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setLoading(false);

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      setAppError(data.error || "This candidate already has an application for this job.");
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAppError(data.error || "Could not create application.");
      return;
    }

    const data = await res.json();
    const created = data.created?.[0];
    if (created) {
      setCreatedApp(created);
    }
    setStep(4);
  }

  /* ── render helpers ── */
  function stepClass(s: number) {
    return s === step ? "badge" : s < step ? "muted" : "muted";
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Quick Application</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          {STEP_LABELS.map((label, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className={stepClass(i + 1)} style={{ fontSize: 12, fontWeight: 600 }}>
                {i + 1 < step ? "✓" : i + 1}
              </span>
              <span style={{ fontSize: 12, color: i + 1 === step ? "var(--ink)" : "var(--ink-soft)" }}>{label}</span>
              {i < STEP_LABELS.length - 1 && <span className="muted" style={{ marginLeft: 4 }}>→</span>}
            </div>
          ))}
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {/* ── Step 1: Candidate ── */}
        {step === 1 && (
          <>
            <div className="field-group">
              <label>Search candidates</label>
              <input
                value={candidateSearch}
                onChange={(e) => setCandidateSearch(e.target.value)}
                placeholder="Type to filter..."
                disabled={candidatesLoading}
              />
            </div>
            {candidatesLoading ? (
              <div className="empty">Loading candidates...</div>
            ) : candidates.length === 0 ? (
              <div className="empty">No candidates found.</div>
            ) : (
              <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 4 }}>
                {candidates.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCandidate(c)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      background: selectedCandidate?.id === c.id ? "var(--accent-bg)" : "transparent",
                    }}
                  >
                    <strong>{c.name}</strong>
                    {c.email && <span className="muted" style={{ marginLeft: 8 }}>{c.email}</span>}
                  </div>
                ))}
              </div>
            )}
            {selectedCandidate && (
              <p style={{ marginTop: 10, fontSize: 13 }}>
                Selected: <strong>{selectedCandidate.name}</strong>
              </p>
            )}
            <div className="modal-actions">
              <button onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={goToStep2} disabled={!selectedCandidate}>
                Next: Paste JD
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Paste JD ── */}
        {step === 2 && (
          <>
            <div className="field-group">
              <label>Job Description</label>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste the full job description here..."
                rows={8}
                style={{ resize: "vertical" }}
              />
              <p className="muted" style={{ fontSize: 11 }}>{rawText.length} characters (minimum 100, max 30,000)</p>
            </div>
            <div className="field-group">
              <label>Source URL (optional)</label>
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            {analyzeError && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>{analyzeError}</p>}
            {analysis && (
              <div className="card" style={{ marginBottom: 14, borderColor: "var(--accent)" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>AI Analysis</h3>
                <p><strong>Title:</strong> {analysis.title ?? "—"}</p>
                <p><strong>Company:</strong> {analysis.company ?? "—"}</p>
                <p><strong>Location:</strong> {analysis.location ?? "—"}</p>
                <p><strong>Workplace:</strong> {analysis.workplaceType}</p>
                <p><strong>Employment:</strong> {analysis.employmentType}</p>
                <p><strong>Seniority:</strong> {analysis.seniorityLevel ?? "—"}</p>
                <p><strong>Salary:</strong> {analysis.salaryMin ?? "—"} — {analysis.salaryMax ?? "—"} {analysis.salaryCurrency}</p>
                <p><strong>Confidence:</strong> {Math.round((analysis.confidenceScore ?? 0) * 100)}%</p>
                {analysis.requiredSkills.length > 0 && (
                  <p><strong>Required:</strong> {analysis.requiredSkills.join(", ")}</p>
                )}
                {analysis.preferredSkills.length > 0 && (
                  <p><strong>Preferred:</strong> {analysis.preferredSkills.join(", ")}</p>
                )}
                {analysis.redFlags.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Red Flags:</strong>
                    {analysis.redFlags.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, color: f.severity === "high" ? "var(--danger)" : "var(--warning)" }}>
                        • {f.flag} ({f.severity}): {f.reason}
                      </div>
                    ))}
                  </div>
                )}
                <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Editing extracted fields will come in a future update.
                </p>
              </div>
            )}
            <div className="modal-actions">
              <button onClick={() => setStep(1)}>Back</button>
              <button onClick={analyzeJD} disabled={loading || rawText.length < 100} className="btn-primary">
                {loading ? "Analyzing..." : "Auto-Analyze JD"}
              </button>
              <button onClick={goToStep3} disabled={!analysis || !analysis.title} className="btn-primary">
                Next: Review Job
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: Review Job ── */}
        {step === 3 && (
          <>
            {selectedJob ? (
              <div className="card" style={{ marginBottom: 14, borderColor: "var(--accent)" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Job selected</h3>
                <p><strong>{selectedJob.title}</strong></p>
                <p className="muted">{selectedJob.company ?? "—"}</p>
                <p style={{ fontSize: 12, marginTop: 6 }}>
                  {analysis?.location ?? "—"} · {analysis?.workplaceType} · {analysis?.employmentType}
                </p>
              </div>
            ) : showDuplicateChoice && duplicates.length > 0 ? (
              <div className="card" style={{ marginBottom: 14, borderColor: "var(--warning)" }}>
                <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Duplicate job(s) found</h3>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  This JD may match an existing job. Choose how to proceed:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  {duplicates.map((d) => (
                    <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: 6, borderRadius: 6, background: selectedDuplicateId === d.id ? "var(--accent-bg)" : "transparent" }}>
                      <input
                        type="radio"
                        name="duplicate"
                        checked={duplicateChoice === "existing" && selectedDuplicateId === d.id}
                        onChange={() => { setDuplicateChoice("existing"); setSelectedDuplicateId(d.id); }}
                      />
                      <span>
                        <strong>{d.title}</strong>
                        {d.company && <span className="muted"> — {d.company}</span>}
                        <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                          ({d.matchType} · {Math.round(d.matchScore * 100)}%)
                        </span>
                      </span>
                    </label>
                  ))}
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: 6, borderRadius: 6, background: duplicateChoice === "force" ? "var(--accent-bg)" : "transparent" }}>
                    <input
                      type="radio"
                      name="duplicate"
                      checked={duplicateChoice === "force"}
                      onChange={() => { setDuplicateChoice("force"); setSelectedDuplicateId(null); }}
                    />
                    <span><strong>Force create new job</strong> (ignore duplicates)</span>
                  </label>
                </div>
                <div className="modal-actions" style={{ marginTop: 0 }}>
                  <button onClick={() => { setShowDuplicateChoice(false); setDuplicates([]); setDuplicateChoice(null); }}>Cancel</button>
                  <button className="btn-primary" onClick={handleDuplicateAction} disabled={loading || !duplicateChoice || (duplicateChoice === "existing" && !selectedDuplicateId)}>
                    {loading ? "Creating..." : "Proceed"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ marginBottom: 14 }}>
                <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Create job from pasted JD</h3>
                <p className="muted" style={{ fontSize: 12 }}>
                  Title: <strong>{analysis?.title}</strong> · {analysis?.company} · {analysis?.location}
                </p>
                <p style={{ marginTop: 8, fontSize: 12 }}>
                  Click "Create Job" to save this as a masterlist job. If duplicates exist, you will be prompted to choose.
                </p>
                <div style={{ marginTop: 10 }}>
                  <button className="btn-primary" onClick={() => createJobFromJD()} disabled={loading}>
                    {loading ? "Creating..." : "Create Job"}
                  </button>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button onClick={() => setStep(2)}>Back</button>
              {selectedJob && (
                <button className="btn-primary" onClick={() => setStep(4)}>
                  Next: Create Application
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Step 4: Create Application ── */}
        {step === 4 && (
          <>
            {createdApp ? (
              <div className="card" style={{ borderColor: "var(--accent)", marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Application created!</h3>
                <p><strong>Candidate:</strong> {selectedCandidate?.name}</p>
                <p><strong>Job:</strong> {selectedJob?.title ?? "Ad-hoc application"}</p>
                <p><strong>Status:</strong> {createdApp.status}</p>
                <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                  {selectedCandidate && (
                    <Link href={`/candidates/${selectedCandidate.id}`}>
                      <button className="btn-primary">View Candidate</button>
                    </Link>
                  )}
                  {selectedJob && (
                    <Link href={`/jobs/${selectedJob.id}`}>
                      <button>View Job</button>
                    </Link>
                  )}
                  <Link href="/application-queue">
                    <button>Go to Queue</button>
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="field-group">
                  <label>Candidate</label>
                  <p><strong>{selectedCandidate?.name}</strong> {selectedCandidate?.email && <span className="muted">{selectedCandidate.email}</span>}</p>
                </div>
                <div className="field-group">
                  <label>Job</label>
                  <p>
                    {selectedJob ? (
                      <><strong>{selectedJob.title}</strong> <span className="muted">{selectedJob.company}</span></>
                    ) : (
                      <span className="muted">Ad-hoc application (no masterlist job)</span>
                    )}
                  </p>
                </div>
                <div className="field-group">
                  <label>Resume Source</label>
                  <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                    {SOURCE_TYPES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Application Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label>Notes / Assignment Note</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes..."
                    rows={3}
                    style={{ resize: "vertical" }}
                  />
                </div>
                <div className="field-group">
                  <label>Assign to User ID (optional)</label>
                  <input
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    placeholder="UUID of team member..."
                  />
                </div>
                <div className="field-group">
                  <label>Assignment Note (optional)</label>
                  <input
                    value={assignmentNote}
                    onChange={(e) => setAssignmentNote(e.target.value)}
                    placeholder="Brief assignment note..."
                  />
                </div>
                {appError && (
                  <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 12 }}>
                    {appError}
                    {appError.includes("already has an application") && selectedCandidate && selectedJob && (
                      <span>
                        {" "}
                        <Link href={`/candidates/${selectedCandidate.id}`} style={{ color: "var(--accent)" }}>
                          View candidate
                        </Link>
                      </span>
                    )}
                  </p>
                )}
                <div className="modal-actions">
                  <button onClick={() => setStep(3)}>Back</button>
                  <button className="btn-primary" onClick={createApplication} disabled={loading}>
                    {loading ? "Creating..." : "Create Application"}
                  </button>
                </div>
              </>
            )}
            {!createdApp && (
              <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                Or skip creating a masterlist job and create an ad-hoc application.
                <button className="btn-danger" onClick={() => { setSelectedJob(null); createApplication(); }} disabled={loading} style={{ marginLeft: 8 }}>
                  Create ad-hoc only
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
