"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

/* ─────────── types ─────────── */

interface BaseResume {
  id: string;
  name: string;
  target_industry: string | null;
  target_roles: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  role_tier: string | null;
}

interface TargetJob {
  id: string;
  candidateId: string;
  jobId: string | null;
  rawDescription: string;
  sourceUrl: string | null;
  jobTitle: string;
  company: string;
  location: string;
  roleType: string;
  requiredSkills: string[];
  preferredSkills: string[];
  atsKeywords: string[];
  redFlags: string[];
  fitScore: number;
  recommendation: "Apply" | "Maybe" | "Do Not Apply";
  keywords?: Keyword[];
}

interface Keyword {
  id: string;
  keyword: string;
  category: "required" | "preferred" | "ats";
  importance: "low" | "medium" | "high";
  evidence: "strong" | "medium" | "weak" | "missing";
  recommendation: string;
  relatedEvidence?: Evidence[];
}

interface KeywordApproval {
  id: string;
  keywordId: string;
  status: "approved" | "rejected" | "needs_review" | "cover_letter_only" | "already_present";
}

interface Evidence {
  id: string;
  source_type: string;
  title: string;
  description: string | null;
  related_skills: string[] | null;
  proof_url: string | null;
  confidence_score: number | null;
  created_at: string;
}

interface ApplicationResumeVersion {
  id: string;
  candidateId: string;
  baseResumeId: string;
  targetJobId: string;
}

interface CandidateDetail {
  id: string;
  name: string;
}

/* ─────────── step config ─────────── */

const STEP_LABELS = [
  "Base Resume",
  "Job Description",
  "JD Analysis",
  "Keyword Approval",
  "Create Resume",
  "Application Packet",
];

/* ─────────── main component ─────────── */

export default function NewApplicationPage() {
  const params = useParams<{ id: string }>();
  const candidateId = params?.id;
  const router = useRouter();

  const [step, setStep] = useState(1);

  /* Step 1 */
  const [baseResumes, setBaseResumes] = useState<BaseResume[]>([]);
  const [baseResumesLoading, setBaseResumesLoading] = useState(false);
  const [selectedBaseResumeId, setSelectedBaseResumeId] = useState<string | null>(null);

  /* Step 2 */
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [inputMode, setInputMode] = useState<"select" | "paste">("select");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [rawDescription, setRawDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  /* Step 3 */
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const [targetJob, setTargetJob] = useState<TargetJob | null>(null);
  const [analysisError, setAnalysisError] = useState("");

  /* Step 4 */
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [approvals, setApprovals] = useState<Record<string, KeywordApproval["status"]>>({});
  const [approvalError, setApprovalError] = useState("");
  const [evidenceBank, setEvidenceBank] = useState<Evidence[]>([]);

  /* Step 5 */
  const [creating, setCreating] = useState(false);
  const [applicationResumeId, setApplicationResumeId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");

  /* Step 6 summary */
  const [candidateName, setCandidateName] = useState("");
  const [baseResumeName, setBaseResumeName] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  /* ─────────── fetch candidate name ─────────── */
  useEffect(() => {
    if (!candidateId) return;
    fetch(`/api/candidates/${candidateId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CandidateDetail | null) => {
        if (data) setCandidateName(data.name);
      });
  }, [candidateId]);

  /* ─────────── Step 1: load base resumes ─────────── */
  useEffect(() => {
    if (!candidateId || step !== 1) return;
    let cancelled = false;
    async function load() {
      setBaseResumesLoading(true);
      const res = await fetch(`/api/base-resumes?candidateId=${candidateId}`);
      if (!cancelled) {
        setBaseResumes(res.ok ? await res.json() : []);
        setBaseResumesLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [candidateId, step]);

  /* ─────────── Step 2: load jobs ─────────── */
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    async function load() {
      setJobsLoading(true);
      const res = await fetch(`/api/jobs`);
      if (!cancelled) {
        setJobs(res.ok ? await res.json() : []);
        setJobsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [step]);

  /* ─────────── Step 3: JD analysis ─────────── */
  useEffect(() => {
    if (step !== 3) return;
    if (targetJob || analysisInProgress || analysisError) return;
    let cancelled = false;

    async function analyze() {
      setAnalysisInProgress(true);
      setAnalysisError("");
      const payload: Record<string, any> = { candidateId };
      if (inputMode === "paste") {
        payload.rawDescription = rawDescription;
      } else {
        payload.jobId = selectedJobId;
      }
      if (sourceUrl) payload.sourceUrl = sourceUrl;

      const res = await fetch(`/api/target-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!cancelled) {
        if (res.ok) {
          const data: TargetJob = await res.json();
          setTargetJob(data);
        } else {
          setAnalysisError("Failed to analyze job description. Please try again.");
        }
        setAnalysisInProgress(false);
      }
    }
    analyze();
    return () => { cancelled = true; };
  }, [step, targetJob, analysisInProgress, analysisError, candidateId, inputMode, rawDescription, selectedJobId, sourceUrl]);

  /* ─────────── Step 4: load keywords + evidence ─────────── */
  useEffect(() => {
    if (!candidateId || !targetJob?.id || step !== 4) return;
    let cancelled = false;

    async function load() {
      setKeywordsLoading(true);
      const [tjRes, kaRes, evRes] = await Promise.all([
        fetch(`/api/target-jobs/${targetJob.id}`),
        fetch(`/api/keyword-approvals?candidateId=${candidateId}`),
        fetch(`/api/candidates/${candidateId}/evidence`),
      ]);

      const tjData: TargetJob | null = tjRes.ok ? await tjRes.json() : null;
      const kaData: KeywordApproval[] = kaRes.ok ? await kaRes.json() : [];
      const evData: Evidence[] = evRes.ok ? await evRes.json() : [];

      if (!cancelled) {
        if (tjData?.keywords) {
          setKeywords(tjData.keywords);
        }
        setEvidenceBank(evData);

        const existingMap: Record<string, KeywordApproval["status"]> = {};
        for (const a of kaData) {
          existingMap[a.keywordId] = a.status;
        }
        setApprovals(existingMap);
        setKeywordsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [candidateId, targetJob?.id, step]);

  /* ─────────── Step 5: create application resume ─────────── */
  useEffect(() => {
    if (step !== 5) return;
    if (creating || applicationResumeId || createError) return;
    if (!candidateId || !selectedBaseResumeId || !targetJob?.id) return;
    let cancelled = false;

    async function create() {
      setCreating(true);
      setCreateError("");
      const res = await fetch(`/api/application-resume-versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          baseResumeId: selectedBaseResumeId,
          targetJobId: targetJob.id,
        }),
      });

      if (!cancelled) {
        if (res.ok) {
          const data: ApplicationResumeVersion = await res.json();
          setApplicationResumeId(data.id);
          const br = baseResumes.find((b) => b.id === selectedBaseResumeId);
          setBaseResumeName(br?.name ?? "");
          setJobTitle(targetJob.jobTitle || targetJob.company || "Untitled");
          setStep(6);
        } else {
          setCreateError("Failed to create application resume.");
        }
        setCreating(false);
      }
    }
    create();
    return () => { cancelled = true; };
  }, [step, creating, applicationResumeId, createError, candidateId, selectedBaseResumeId, targetJob, baseResumes]);

  /* ─────────── helpers ─────────── */

  async function postApproval(keywordId: string, status: KeywordApproval["status"]) {
    setApprovals((prev) => ({ ...prev, [keywordId]: status }));
    await fetch(`/api/keyword-approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, keywordId, status }),
    });
  }

  function approveAllSafe() {
    const toApprove = keywords.filter((k) => k.evidence === "strong" && !approvals[k.id]);
    if (toApprove.length === 0) return;
    const next = { ...approvals };
    for (const kw of toApprove) {
      next[kw.id] = "approved";
      fetch(`/api/keyword-approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId, keywordId: kw.id, status: "approved" }),
      });
    }
    setApprovals(next);
  }

  const allKeywordsDecided = keywords.length > 0 && keywords.every((k) => approvals[k.id]);

  function handleNext() {
    if (step < 5) setStep((s) => s + 1);
  }

  function handleBack() {
    if (step === 3) {
      setTargetJob(null);
      setAnalysisError("");
      setAnalysisInProgress(false);
    }
    if (step === 5) {
      setCreateError("");
      setCreating(false);
    }
    if (step > 1) setStep((s) => s - 1);
  }

  function isNextDisabled(): boolean {
    switch (step) {
      case 1:
        return !selectedBaseResumeId;
      case 2:
        if (inputMode === "select") return !selectedJobId;
        return !rawDescription.trim();
      case 4:
        return !allKeywordsDecided;
      default:
        return false;
    }
  }

  function relatedEvidence(kw: Keyword): Evidence[] {
    return evidenceBank.filter(
      (e) => e.related_skills && e.related_skills.some((s) => s.toLowerCase() === kw.keyword.toLowerCase())
    );
  }

  const progressPercent = (step / 6) * 100;

  /* ─────────── render ─────────── */

  return (
    <div className="page">
      <div className="page-header">
        <h1>New Application</h1>
        <span className="muted">Candidate: {candidateName || candidateId}</span>
      </div>

      {/* Step indicators */}
      <div className="flex flex-col gap-4 mb-8">
        <div className="flex items-center justify-between">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            const isActive = num === step;
            const isDone = num < step;
            return (
              <div key={label} className="flex flex-col items-center gap-2 flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border transition-colors ${
                    isActive
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : isDone
                      ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]"
                      : "bg-[var(--surface)] text-[var(--ink-soft)] border-[var(--border)]"
                  }`}
                >
                  {isDone ? "✓" : num}
                </div>
                <span
                  className={`text-xs hidden sm:block text-center ${
                    isActive ? "text-[var(--ink)] font-semibold" : "text-[var(--ink-soft)]"
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-[var(--border)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* ─── Step 1 ─── */}
      {step === 1 && (
        <div className="space-y-6">
          <h2 className="section-title">Select a Base Resume</h2>

          {baseResumesLoading ? (
            <div className="loading-panel">
              <p className="muted">Loading base resumes…</p>
            </div>
          ) : baseResumes.length === 0 ? (
            <div className="empty">
              <p className="muted mb-4">No base resumes found for this candidate.</p>
              <Link className="btn-primary inline-block" href={`/candidates/${candidateId}`}>
                Create new base resume
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {baseResumes.map((br) => (
                <button
                  key={br.id}
                  onClick={() => setSelectedBaseResumeId(br.id)}
                  className={`card text-left transition-shadow hover:shadow-md ${
                    selectedBaseResumeId === br.id
                      ? "ring-2 ring-[var(--accent)] border-[var(--accent)]"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-sm">{br.name}</h3>
                    <span className="badge">{br.status}</span>
                  </div>
                  <p className="muted text-xs mb-1">
                    Target: {br.target_industry ?? "—"}
                  </p>
                  <p className="muted text-xs">
                    Updated: {new Date(br.updated_at).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <Link className="btn inline-block" href={`/candidates/${candidateId}`}>
              Create new base resume
            </Link>
            <button
              className="btn-primary"
              onClick={handleNext}
              disabled={isNextDisabled()}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 2 ─── */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="section-title">Paste Job Description</h2>

          <div className="flex gap-4 mb-4">
            <button
              className={`btn ${inputMode === "select" ? "btn-primary" : ""}`}
              onClick={() => setInputMode("select")}
            >
              Select from masterlist
            </button>
            <button
              className={`btn ${inputMode === "paste" ? "btn-primary" : ""}`}
              onClick={() => setInputMode("paste")}
            >
              Paste raw JD
            </button>
          </div>

          {inputMode === "select" ? (
            <div className="field-group">
              <label>Existing job</label>
              <select
                value={selectedJobId ?? ""}
                onChange={(e) => setSelectedJobId(e.target.value || null)}
              >
                <option value="">— Select a job —</option>
                {jobsLoading ? (
                  <option disabled>Loading jobs…</option>
                ) : (
                  jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} @ {j.company} — {j.location}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : (
            <div className="field-group">
              <label>Job description</label>
              <textarea
                rows={12}
                value={rawDescription}
                onChange={(e) => setRawDescription(e.target.value)}
                placeholder="Paste the full job description here…"
              />
            </div>
          )}

          <div className="field-group">
            <label>Source URL (optional)</label>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="flex items-center justify-between">
            <button onClick={handleBack}>Back</button>
            <button className="btn-primary" onClick={handleNext} disabled={isNextDisabled()}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3 ─── */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="section-title">JD Analysis</h2>

          {analysisInProgress ? (
            <div className="loading-panel">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
                <p className="muted">AI is analyzing the job description…</p>
              </div>
            </div>
          ) : analysisError ? (
            <div className="card border-[var(--danger)] bg-[#fbeaea]">
              <p className="text-[var(--danger)]">{analysisError}</p>
              <button className="mt-4 btn-primary" onClick={() => { setAnalysisError(""); setAnalysisInProgress(false); }}>
                Retry
              </button>
            </div>
          ) : targetJob ? (
            <div className="space-y-4">
              <div className="card">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label>Job Title</label>
                    <p className="font-medium">{targetJob.jobTitle || "—"}</p>
                  </div>
                  <div>
                    <label>Company</label>
                    <p className="font-medium">{targetJob.company || "—"}</p>
                  </div>
                  <div>
                    <label>Location</label>
                    <p className="font-medium">{targetJob.location || "—"}</p>
                  </div>
                  <div>
                    <label>Role Type</label>
                    <p className="font-medium">{targetJob.roleType || "—"}</p>
                  </div>
                </div>
              </div>

              <div className="card">
                <label>Required Skills</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {targetJob.requiredSkills.length ? (
                    targetJob.requiredSkills.map((s) => (
                      <span key={s} className="badge">{s}</span>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>

              <div className="card">
                <label>Preferred Skills</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {targetJob.preferredSkills.length ? (
                    targetJob.preferredSkills.map((s) => (
                      <span key={s} className="badge badge-priority-normal">{s}</span>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>

              <div className="card">
                <label>ATS Keywords</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {targetJob.atsKeywords.length ? (
                    targetJob.atsKeywords.map((s) => (
                      <span key={s} className="badge badge-priority-low">{s}</span>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              </div>

              {targetJob.redFlags.length > 0 && (
                <div className="card border-[var(--warn)]">
                  <label className="text-[var(--warn)]">Red Flags</label>
                  <ul className="list-disc pl-5 mt-2 space-y-1">
                    {targetJob.redFlags.map((flag, i) => (
                      <li key={i} className="text-[var(--warn)] text-sm">{flag}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card">
                <div className="flex items-center justify-between mb-2">
                  <label>Fit Score</label>
                  <span className="font-bold text-lg">{targetJob.fitScore}%</span>
                </div>
                <div className="w-full h-3 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] transition-all duration-700"
                    style={{ width: `${targetJob.fitScore}%` }}
                  />
                </div>
              </div>

              <div className="card">
                <label>Recommendation</label>
                <div className="mt-2">
                  <span
                    className={`badge text-sm ${
                      targetJob.recommendation === "Apply"
                        ? "badge-offer"
                        : targetJob.recommendation === "Maybe"
                        ? "badge-in_progress"
                        : "badge-rejected"
                    }`}
                  >
                    {targetJob.recommendation}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <button onClick={handleBack}>Back</button>
            <button className="btn-primary" onClick={handleNext} disabled={!targetJob || analysisInProgress}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 4 ─── */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Keyword Approval Board</h2>
            <button className="btn btn-compact" onClick={approveAllSafe}>
              Approve All Safe
            </button>
          </div>

          {keywordsLoading ? (
            <div className="loading-panel">
              <p className="muted">Loading keywords…</p>
            </div>
          ) : keywords.length === 0 ? (
            <div className="empty">No keywords found for this job.</div>
          ) : (
            <div className="table-shell overflow-x-auto">
              <table className="table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Category</th>
                    <th>Importance</th>
                    <th>Evidence</th>
                    <th>Recommendation</th>
                    <th>Related Evidence</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((kw) => {
                    const decision = approvals[kw.id];
                    const evList = relatedEvidence(kw);
                    return (
                      <tr key={kw.id}>
                        <td className="font-medium">{kw.keyword}</td>
                        <td>
                          <span className={`badge badge-${kw.category === "required" ? "priority-urgent" : kw.category === "ats" ? "priority-normal" : "priority-low"}`}>
                            {kw.category}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge-${kw.importance === "high" ? "priority-urgent" : kw.importance === "medium" ? "priority-high" : "priority-low"}`}>
                            {kw.importance}
                          </span>
                        </td>
                        <td>
                          <span className={`badge badge-${kw.evidence === "strong" ? "offer" : kw.evidence === "medium" ? "in_progress" : kw.evidence === "weak" ? "priority-normal" : "rejected"}`}>
                            {kw.evidence}
                          </span>
                        </td>
                        <td className="text-sm max-w-[200px]">{kw.recommendation}</td>
                        <td>
                          {evList.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {evList.map((e) => (
                                <span key={e.id} className="text-xs text-[var(--ink-soft)]">
                                  {e.title} ({e.source_type})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="muted text-xs">—</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {(["approved", "rejected", "needs_review", "cover_letter_only", "already_present"] as const).map(
                              (action) => (
                                <button
                                  key={action}
                                  className={`btn-compact text-xs ${
                                    decision === action
                                      ? action === "approved"
                                        ? "badge-offer"
                                        : action === "rejected"
                                        ? "badge-rejected"
                                        : "badge-in_progress"
                                      : ""
                                  }`}
                                  onClick={() => postApproval(kw.id, action)}
                                  style={
                                    decision === action
                                      ? {
                                          background:
                                            action === "approved"
                                              ? "var(--accent-soft)"
                                              : action === "rejected"
                                              ? "#fbeaea"
                                              : "#fff3e0",
                                          borderColor:
                                            action === "approved"
                                              ? "var(--accent)"
                                              : action === "rejected"
                                              ? "var(--danger)"
                                              : "var(--warn)",
                                        }
                                      : {}
                                  }
                                >
                                  {action.replace("_", " ")}
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {approvalError && <p className="form-error">{approvalError}</p>}

          <div className="flex items-center justify-between">
            <button onClick={handleBack}>Back</button>
            <button className="btn-primary" onClick={handleNext} disabled={isNextDisabled()}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 5 ─── */}
      {step === 5 && (
        <div className="space-y-6">
          <div className="loading-panel" style={{ minHeight: 300 }}>
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
              <p className="muted">Launching Studio…</p>
              <p className="muted text-xs">Creating application resume from base resume and target job.</p>
            </div>
          </div>
          {createError && (
            <div className="card border-[var(--danger)] bg-[#fbeaea]">
              <p className="text-[var(--danger)]">{createError}</p>
              <button className="mt-4 btn-primary" onClick={() => { setCreateError(""); setCreating(false); }}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Step 6 ─── */}
      {step === 6 && (
        <div className="space-y-6">
          <h2 className="section-title">Application Packet</h2>

          <div className="card max-w-xl mx-auto">
            <div className="space-y-4">
              <div className="flex justify-between border-b border-[var(--border)] pb-3">
                <span className="muted text-sm">Candidate</span>
                <span className="font-medium">{candidateName || candidateId}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--border)] pb-3">
                <span className="muted text-sm">Base Resume</span>
                <span className="font-medium">{baseResumeName || "—"}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--border)] pb-3">
                <span className="muted text-sm">Job</span>
                <span className="font-medium">{jobTitle || "—"}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--border)] pb-3">
                <span className="muted text-sm">Approved Keywords</span>
                <span className="font-medium text-[var(--accent)]">
                  {Object.values(approvals).filter((v) => v === "approved").length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="muted text-sm">Rejected Keywords</span>
                <span className="font-medium text-[var(--danger)]">
                  {Object.values(approvals).filter((v) => v === "rejected").length}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--border)]">
              <button onClick={() => router.push(`/candidates/${candidateId}`)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (applicationResumeId) {
                    router.push(`/falood/studio/application/${applicationResumeId}`);
                  }
                }}
                disabled={!applicationResumeId}
              >
                Launch Resume Studio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
