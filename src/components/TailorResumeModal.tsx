"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_COLORS, DEFAULT_PAGE_PADDING, DEFAULT_SECTIONS, type ResumeData } from "@/components/falood/resumify/types/resume";

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

function normalizeSkillsForFalood(skills: any): ResumeData["skills"] {
  if (!skills) {
    return { mode: "categorized", simple: [], categorized: [] };
  }

  if (Array.isArray(skills)) {
    const allStrings = skills.every((s: any) => typeof s === "string");
    if (allStrings) {
      const validSkills = skills.filter((s: any) => typeof s === "string" && s.trim());
      return {
        mode: "categorized",
        simple: [],
        categorized: validSkills.length > 0
          ? [{ id: "skills-technical", name: "Technical Skills", skills: validSkills }]
          : [],
      };
    }
    const categorized = skills
      .filter((s: any) => s && typeof s === "object" && !Array.isArray(s))
      .map((s: any) => ({
        id: s.id || Math.random().toString(),
        name: s.title || s.name || "",
        skills: Array.isArray(s.skills) ? s.skills : [],
      }))
      .filter((c) => c.name && c.skills.length > 0);
    return { mode: "categorized", simple: [], categorized };
  }

  if (typeof skills === "object" && skills !== null) {
    if (skills.mode === "simple" || skills.mode === "categorized") {
      return skills as ResumeData["skills"];
    }
    const categorized = Object.entries(skills)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => ({
        id: `skills-${key}`,
        name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        skills: (value as any[]).filter((v: any) => typeof v === "string" && v.trim()),
      }))
      .filter((c) => c.skills.length > 0);
    return { mode: "categorized", simple: [], categorized };
  }

  return { mode: "categorized", simple: [], categorized: [] };
}

function buildCustomSectionsForBuilder(old: any): ResumeData["customSections"] {
  const importedSections = Array.isArray(old.customSections)
    ? old.customSections
        .map((section: any, index: number) => {
          const content = Array.isArray(section?.bullets)
            ? section.bullets
                .map((bullet: any) => bullet?.text || bullet)
                .filter(Boolean)
                .join("\n")
            : typeof section?.content === "string"
              ? section.content.trim()
              : "";
          if (!content) return null;
          const lines = content.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
          return {
            id: section?.id || `custom-${index}`,
            title: section?.title || `Custom Section ${index + 1}`,
            content,
            type: lines.length > 1 ? "bullets" : "paragraph",
            visible: section?.visible ?? true,
            order: index,
            placement: section?.placement || "right",
          };
        })
        .filter((section: ResumeData["customSections"][number] | null): section is ResumeData["customSections"][number] => Boolean(section))
    : [];

  const certificationLines = Array.isArray(old.certifications)
    ? old.certifications
        .map((cert: any) => [cert?.name, cert?.issuer, cert?.date].filter(Boolean).join(" | "))
        .filter(Boolean)
    : [];

  if (certificationLines.length > 0) {
    importedSections.push({
      id: "certifications",
      title: "Certifications",
      content: certificationLines.join("\n"),
      type: "bullets",
      visible: true,
      order: importedSections.length,
      placement: "right",
    });
  }

  return importedSections;
}

export function TailorResumeModal({
  candidateId,
  initialJobId,
  initialApplicationId,
  onClose,
  onSaved: _onSaved,
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
  const [showJobSearch, setShowJobSearch] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [jobSearchResults, setJobSearchResults] = useState<any[]>([]);
  const [jobSearching, setJobSearching] = useState(false);
  const [linkingJob, setLinkingJob] = useState(false);

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
        template: "business-professional",
        pageFormat: "letter",
        fontSize: "medium",
        fontFamily: "Inter",
        pagePadding: DEFAULT_PAGE_PADDING,
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
        website: old.header?.portfolio || old.header?.website || "",
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
      skills: normalizeSkillsForFalood(old.skills),
      projects: Array.isArray(old.projects)
        ? old.projects.map((p: any) => ({
            id: p.id || Math.random().toString(),
            title: p.title || p.name || "",
            description:
              p.description ||
              (Array.isArray(p.bullets)
                ? p.bullets.map((b: any) => b?.text || b).filter(Boolean).join("\n")
                : "") ||
              "",
            technologies: Array.isArray(p.technologies) ? p.technologies.filter(Boolean) : [],
            liveUrl: p.liveUrl || p.url || "",
            githubUrl: "",
          }))
        : [],
      customSections: buildCustomSectionsForBuilder(old),
      sections: DEFAULT_SECTIONS,
      colors: DEFAULT_COLORS,
      template: "business-professional",
      pageFormat: "letter",
      fontSize: "medium",
      fontFamily: "Inter",
      pagePadding: DEFAULT_PAGE_PADDING,
    };
  }

  const jobSelectRef = useRef<HTMLSelectElement>(null);

  async function linkJobToCandidate(job: any) {
    setLinkingJob(true);
    setError("");
    try {
      const res = await fetch("/api/target-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          jobId: job.id,
          rawDescription: job.description_text || job.title || "",
          sourceUrl: job.source_url || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to link job to candidate");
      const data = await res.json();
      const newOption: JobOption = { id: job.id, title: job.title, company: job.company ?? null };
      setExtraJob(newOption);
      setJobId(job.id);
      setShowJobSearch(false);
      setJobSearchQuery("");
      setJobSearchResults([]);
    } catch (e: any) {
      setError(e?.message || "Could not link job");
    } finally {
      setLinkingJob(false);
    }
  }

  async function searchJobs(query: string) {
    setJobSearchQuery(query);
    if (query.length < 2) { setJobSearchResults([]); return; }
    setJobSearching(true);
    try {
      const res = await fetch(`/api/jobs?search=${encodeURIComponent(query)}&pageSize=10`);
      const data = await res.json();
      setJobSearchResults(data.jobs || []);
    } catch {
      setJobSearchResults([]);
    } finally {
      setJobSearching(false);
    }
  }

  async function startTailoring() {
    if (!jobId) {
      setError("Select a target job first.");
      jobSelectRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      jobSelectRef.current?.focus();
      return;
    }
    if (!baseResumeId) {
      setError("Choose a source resume first.");
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
                <select value={jobId} onChange={(e) => {
                  if (e.target.value === "__search__") {
                    setShowJobSearch(true);
                    return;
                  }
                  setJobId(e.target.value);
                }}>
                  <option value="">Choose a job...</option>
                  {jobOptions.map((job) => (
                    <option key={job.id} value={job.id}>{job.title}{job.company ? ` - ${job.company}` : ""}</option>
                  ))}
                  <option value="__search__" style={{ color: "var(--accent)", fontWeight: 600 }}>+ Search jobs...</option>
                </select>
              </div>
            </div>

            {showJobSearch && (
              <div style={{ marginTop: 12, padding: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <input
                    placeholder="Search jobs by title or company..."
                    value={jobSearchQuery}
                    onChange={(e) => searchJobs(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px", fontSize: 13 }}
                    autoFocus
                  />
                  <button onClick={() => setShowJobSearch(false)} style={{ fontSize: 12, padding: "4px 8px" }}>Cancel</button>
                </div>
                {jobSearching && <p className="muted" style={{ fontSize: 12 }}>Searching...</p>}
                {!jobSearching && jobSearchQuery.length >= 2 && jobSearchResults.length === 0 && (
                  <p className="muted" style={{ fontSize: 12 }}>No jobs found.</p>
                )}
                {jobSearchResults.length > 0 && (
                  <div style={{ maxHeight: 200, overflowY: "auto" }}>
                    {jobSearchResults.map((job: any) => (
                      <div
                        key={job.id}
                        onClick={() => linkJobToCandidate(job)}
                        style={{
                          padding: "8px 10px",
                          cursor: linkingJob ? "wait" : "pointer",
                          fontSize: 13,
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          opacity: linkingJob ? 0.6 : 1,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{job.title}</div>
                          <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>{job.company} {job.location ? `· ${job.location}` : ""}</div>
                        </div>
                        <span style={{ fontSize: 11, color: "var(--accent)" }}>+ Link</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
