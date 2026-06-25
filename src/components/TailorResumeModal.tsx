"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_COLORS, DEFAULT_SECTIONS, type ResumeData } from "@/components/falood/resumify/types/resume";

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
  const router = useRouter();
  const [candidate, setCandidate] = useState<CandidateDetail | null>(null);
  const [baseResumes, setBaseResumes] = useState<BaseResume[]>([]);
  const [extraJob, setExtraJob] = useState<JobOption | null>(null);
  const [baseResumeId, setBaseResumeId] = useState("");
  const [jobId, setJobId] = useState(initialJobId ?? "");
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
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
      setCandidateName(candidateData?.name ?? "");
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

  function formatJobDescription(job: any) {
    return [
      `Title: ${job.title}`,
      job.company ? `Company: ${job.company}` : null,
      job.location ? `Location: ${job.location}` : null,
      job.job_category ? `Category: ${job.job_category}` : null,
      job.description_text,
      job.notes ? `Internal notes: ${job.notes}` : null,
    ].filter(Boolean).join("\n\n");
  }

  function convertOldFormatToNew(old: any): ResumeData {
    if (!old || typeof old !== "object") {
      return {
        personalInfo: {
          fullName: "",
          jobTitle: "",
          email: "",
          phone: "",
          location: "",
          website: "",
          linkedin: "",
          github: "",
          profileImage: "",
          birthDate: "",
        },
        summary: "",
        experience: [],
        education: [],
        projects: [],
        skills: { mode: "simple", simple: [], categorized: [] },
        customSections: [],
        sections: DEFAULT_SECTIONS,
        colors: DEFAULT_COLORS,
        template: "tech-sidebar",
        pageFormat: "letter",
        fontSize: "medium",
        fontFamily: "Inter",
      };
    }

    if (old.personalInfo) return old as ResumeData;

    return {
      personalInfo: {
        fullName: old.header?.fullName || "",
        jobTitle: "",
        email: old.header?.email || "",
        phone: old.header?.phone || "",
        location: old.header?.location || "",
        website: old.header?.website || "",
        linkedin: old.header?.linkedin || "",
        github: old.header?.github || "",
        profileImage: "",
        birthDate: "",
      },
      summary: old.summary?.text || "",
      experience: Array.isArray(old.experience)
        ? old.experience.map((e: any) => ({
            id: e.id || Math.random().toString(),
            jobTitle: e.title || "",
            company: e.company || "",
            location: e.location || "",
            startDate: e.startDate || "",
            endDate: e.endDate || "",
            current: !e.endDate,
            description: "",
            bulletPoints: Array.isArray(e.bullets) ? e.bullets.map((b: any) => b.text || b) : [],
          }))
        : [],
      education: Array.isArray(old.education)
        ? old.education.map((e: any) => ({
            id: e.id || Math.random().toString(),
            degree: e.degree || "",
            institution: e.school || "",
            location: "",
            graduationYear: e.graduationDate || "",
          }))
        : [],
      skills: {
        mode: "categorized",
        simple: [],
        categorized: Array.isArray(old.skills)
          ? old.skills.map((s: any) => ({
              id: s.id || Math.random().toString(),
              name: s.title || "",
              skills: Array.isArray(s.skills) ? s.skills : [],
            }))
          : [],
      },
      projects: Array.isArray(old.projects)
        ? old.projects.map((p: any) => ({
            id: p.id || Math.random().toString(),
            title: p.title || "",
            description: "",
            technologies: [],
            liveUrl: "",
            githubUrl: "",
          }))
        : [],
      customSections: [],
      sections: DEFAULT_SECTIONS,
      colors: DEFAULT_COLORS,
      template: "tech-sidebar",
      pageFormat: "letter",
      fontSize: "medium",
      fontFamily: "Inter",
    };
  }

  async function startTailoring() {
    if (!baseResumeId || !jobId) {
      setError("Choose a source resume and target job first.");
      return;
    }
    setGenerating(true);
    setError("");
    try {
      const [baseRes, jobRes] = await Promise.all([
        fetch(`/api/base-resumes/${baseResumeId}`, { cache: "no-store" }),
        fetch(`/api/jobs/${jobId}`, { cache: "no-store" }),
      ]);

      const base = await baseRes.json().catch(() => ({}));
      const job = await jobRes.json().catch(() => ({}));

      if (!baseRes.ok) throw new Error(base.error || "Could not load base resume.");
      if (!jobRes.ok) throw new Error(job.error || "Could not load job details.");

      const resumeData = convertOldFormatToNew(base.content);
      const resolvedCandidateName = candidateName.trim() || candidate?.name || "";
      const finalResumeData: ResumeData = {
        ...resumeData,
        personalInfo: { ...resumeData.personalInfo, fullName: resolvedCandidateName || resumeData.personalInfo.fullName },
      };

      const jd = formatJobDescription(job);
      const createRes = await fetch("/api/falood/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription: jd,
          companyName: job.company || null,
          skills: [],
          resumeData: finalResumeData,
          chatHistory: [{ id: "meta-candidate", role: "assistant", content: "", candidateId, candidateName: resolvedCandidateName }],
        }),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !created?.success) {
        throw new Error(created?.error || "Could not start tailoring in Resume Builder.");
      }

      const newId = created?.data?.id as string | undefined;
      if (!newId) throw new Error("Could not start tailoring in Resume Builder.");

      onClose();
      router.push(
        `/falood/studio/tailor/${encodeURIComponent(newId)}?jobTitle=${encodeURIComponent(job.title || "")}&company=${encodeURIComponent(job.company || "")}`
      );
    } catch (e: any) {
      setError(e?.message || "Could not start tailoring in Resume Builder.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <h2>Tailor resume for job</h2>
        <p className="muted" style={{ marginTop: -6 }}>Open the Resume Builder and tailor with AI.</p>

        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field-group">
                <label>Candidate</label>
                <input value={candidateName} onChange={(e) => setCandidateName(e.target.value)} placeholder={candidate?.name ?? candidateId} />
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
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <button className="btn-primary" onClick={startTailoring} disabled={generating || !baseResumeId || !jobId}>
                {generating ? "Opening..." : "Generate tailored resume"}
              </button>
            </div>

            {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

            <div className="modal-actions">
              <button onClick={onClose}>Close</button>
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
