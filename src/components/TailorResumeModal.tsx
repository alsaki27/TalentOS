"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface BaseResume {
  id: string;
  name: string;
  status: string;
}

interface CandidateApplication {
  id: string;
  status: string;
  jobs: { id: string; title: string; company: string | null } | null;
}

interface CandidateDetail {
  id: string;
  name: string;
  applications: CandidateApplication[];
}

interface JobOption {
  id: string;
  title: string;
  company: string | null;
  applicationId?: string;
}

export function TailorResumeModal({
  candidateId,
  initialJobId,
  initialApplicationId,
  onClose,
  onSaved,
}: {
  candidateId: string;
  initialJobId?: string | null;
  initialApplicationId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [baseResumes, setBaseResumes] = useState<BaseResume[]>([]);
  const [extraJob, setExtraJob] = useState<JobOption | null>(null);
  const [baseResumeId, setBaseResumeId] = useState("");
  const [jobId, setJobId] = useState(initialJobId ?? "");
  const [applicationId, setApplicationId] = useState(initialApplicationId ?? "");
  const [title, setTitle] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [draft, setDraft] = useState("");
  const [generatedId, setGeneratedId] = useState("");
  const [targetJobId, setTargetJobId] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const [candidateRes, baseResumesRes] = await Promise.all([
        fetch(`/api/candidates/${candidateId}`, { cache: "no-store" }),
        fetch(`/api/base-resumes?candidateId=${candidateId}`, { cache: "no-store" }),
      ]);
      const candidateData = candidateRes.ok ? await candidateRes.json() : null;
      const baseData = baseResumesRes.ok ? await baseResumesRes.json() : [];
      if (cancelled) return;
      setCandidate(candidateData);
      setBaseResumes(baseData);
      setBaseResumeId(baseData[0]?.id ?? "");
      if (initialApplicationId && candidateData?.applications) {
        const app = candidateData.applications.find((a: CandidateApplication) => a.id === initialApplicationId);
        if (app?.jobs?.id) setJobId(app.jobs.id);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [candidateId, initialApplicationId]);

  useEffect(() => {
    if (!initialJobId) return;
    async function loadJob() {
      const res = await fetch(`/api/jobs/${initialJobId}`, { cache: "no-store" });
      if (!res.ok) return;
      const job = await res.json();
      setExtraJob({ id: job.id, title: job.title, company: job.company ?? null });
    }
    loadJob();
  }, [initialJobId]);

  const jobOptions = useMemo(() => {
    const fromApps: JobOption[] = candidate?.applications
      ?.filter((app) => app.jobs?.id)
      .map((app) => ({
        id: app.jobs!.id,
        title: app.jobs!.title,
        company: app.jobs!.company,
        applicationId: app.id,
      })) ?? [];
    if (extraJob && !fromApps.some((job) => job.id === extraJob.id)) fromApps.unshift(extraJob);
    return fromApps;
  }, [candidate, extraJob]);

  useEffect(() => {
    const app = jobOptions.find((job) => job.id === jobId)?.applicationId;
    if (app && !applicationId) setApplicationId(app);
  }, [jobId, jobOptions, applicationId]);

  async function generate() {
    if (!baseResumeId || !jobId) {
      setError("Choose a source resume and target job first.");
      return;
    }
    setGenerating(true);
    setError("");
    const res = await fetch("/api/resume-tailoring/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, baseResumeId, jobId }),
    });
    const data = await res.json().catch(() => ({}));
    setGenerating(false);
    if (!res.ok) {
      setError(data.error || "Could not generate tailored draft.");
      return;
    }
    setDraft(data.draft ?? "");
    setTitle(data.title ?? "");
    setVersionLabel(data.versionLabel ?? "");
    setTargetJobId(data.targetJobId ?? "");
  }

  async function attachVariant(variantId: string, appId: string) {
    const body = {
      applicationId: appId,
      candidateId,
      targetJobId,
      baseResumeId,
      finalResumeVersionId: variantId,
    };
    const createRes = await fetch("/api/application-packets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (createRes.ok) return;
    if (createRes.status === 409) {
      const patchRes = await fetch(`/api/application-packets/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ final_resume_version_id: variantId, base_resume_id: baseResumeId, target_job_id: targetJobId }),
      });
      if (patchRes.ok) return;
      const patchData = await patchRes.json().catch(() => ({}));
      throw new Error(patchData.error || "Could not attach resume variant.");
    }
    const data = await createRes.json().catch(() => ({}));
    throw new Error(data.error || "Could not create application packet.");
  }

  async function save() {
    if (!draft.trim()) {
      setError("Generate or write a draft first.");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/application-resume-versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseResumeId,
        targetJobId,
        title: title.trim() || "Tailored resume draft",
        versionLabel: versionLabel.trim() || "Tailored draft",
        generatedText: draft,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaving(false);
      setError(data.error || "Could not save resume variant.");
      return;
    }
    try {
      if (applicationId) await attachVariant(data.id, applicationId);
      setGeneratedId(data.id);
      onSaved?.();
    } catch (err: any) {
      setError(err.message || "Saved variant, but could not attach it.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <h2>Tailor resume for job</h2>
        <p className="muted" style={{ marginTop: -6 }}>Review before sending.</p>

        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field-group">
                <label>Candidate</label>
                <input value={candidate?.name ?? candidateId} disabled />
              </div>
              <div className="field-group">
                <label>Source resume</label>
                <select value={baseResumeId} onChange={(e) => setBaseResumeId(e.target.value)}>
                  {baseResumes.map((resume) => (
                    <option key={resume.id} value={resume.id}>{resume.name} ({resume.status})</option>
                  ))}
                </select>
                {baseResumes.length === 0 && (
                  <div style={{ marginTop: 8 }}>
                    <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      No base resumes found. You need one to tailor a resume.
                    </p>
                    <button
                      onClick={async () => {
                        setLoading(true);
                        const res = await fetch("/api/base-resumes", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            candidateId,
                            name: `${candidate?.name ?? "Candidate"} — Base Resume`,
                            startingSource: "blank",
                          }),
                        });
                        setLoading(false);
                        if (res.ok) {
                          const newBase = await res.json();
                          setBaseResumes((prev) => [newBase, ...prev]);
                          setBaseResumeId(newBase.id);
                        }
                      }}
                      disabled={loading}
                      style={{ fontSize: 12 }}
                    >
                      {loading ? "Creating…" : "+ Create blank base resume"}
                    </button>
                  </div>
                )}
              </div>
              <div className="field-group">
                <label>Target job</label>
                <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">Choose a job...</option>
                  {jobOptions.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}{job.company ? ` - ${job.company}` : ""}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Attach to application packet</label>
                <select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
                  <option value="">Save only</option>
                  {candidate?.applications?.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.jobs?.title ?? "Application"} ({app.status})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Candidate - Job title" />
              </div>
              <div className="field-group">
                <label>Version label</label>
                <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="Company tailored draft" />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <button className="btn-primary" onClick={generate} disabled={generating || !baseResumeId || !jobId}>
                {generating ? "Generating..." : "Generate tailored draft"}
              </button>
              {generatedId && (
                <Link href={`/falood/studio/application/${generatedId}`} onClick={onClose}>
                  Open saved variant
                </Link>
              )}
            </div>

            <div className="field-group">
              <label>Draft markdown</label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={18}
                placeholder="Generated tailored resume draft will appear here."
                style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
              />
            </div>

            {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

            <div className="modal-actions">
              <button onClick={onClose}>Close</button>
              <button className="btn-primary" onClick={save} disabled={saving || !draft.trim() || !targetJobId}>
                {saving ? "Saving..." : applicationId ? "Save and attach" : "Save as resume variant"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ApplicationResumeAttach({
  candidateId,
  applicationId,
  jobId,
  onAttached,
}: {
  candidateId: string;
  applicationId: string;
  jobId: string;
  onAttached?: () => void;
}) {
  const [versions, setVersions] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadVersions() {
      const res = await fetch(`/api/application-resume-versions?candidateId=${candidateId}`, { cache: "no-store" });
      if (res.ok && !cancelled) setVersions(await res.json());
    }
    loadVersions();
    return () => { cancelled = true; };
  }, [candidateId]);

  const filtered = versions.filter((version) => !version.target_jobs?.job_id || version.target_jobs.job_id === jobId);

  async function attach() {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    const variant = versions.find((version) => version.id === selected);
    const createRes = await fetch("/api/application-packets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        applicationId,
        candidateId,
        targetJobId: variant?.target_job_id ?? null,
        baseResumeId: variant?.base_resume_id ?? null,
        finalResumeVersionId: selected,
      }),
    });
    if (!createRes.ok && createRes.status === 409) {
      await fetch(`/api/application-packets/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          final_resume_version_id: selected,
          target_job_id: variant?.target_job_id ?? null,
          base_resume_id: variant?.base_resume_id ?? null,
        }),
      });
    }
    setSaving(false);
    setMessage("Attached.");
    onAttached?.();
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 220 }}>
        <option value="">Saved tailored resume...</option>
        {filtered.map((version) => (
          <option key={version.id} value={version.id}>
            {version.title || version.version_label || `Variant ${version.id.slice(0, 8)}`}
          </option>
        ))}
      </select>
      <button onClick={attach} disabled={!selected || saving}>{saving ? "Attaching..." : "Attach"}</button>
      {message && <span className="muted" style={{ fontSize: 12 }}>{message}</span>}
    </div>
  );
}
