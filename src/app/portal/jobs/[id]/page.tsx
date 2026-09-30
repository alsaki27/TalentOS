"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { PortalShell } from "../../PortalShell";

interface PortalJob {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  apply_url: string | null;
  salary_range: string | null;
  employment_type: string | null;
  seniority_level: string | null;
  role_tier: string | null;
  description_text: string | null;
  benefits: string | null;
  job_function: string | null;
  industries: string | string[] | null;
  company_website: string | null;
  company_description: string | null;
  posted_at: string | null;
}

function displayList(value: string | string[] | null) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value || "";
}

export default function CandidatePortalJobPage() {
  const params = useParams<{ id: string }>();
  const jobId = params?.id;
  const router = useRouter();
  const [job, setJob] = useState<PortalJob | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/portal/me/jobs/${jobId}`, { cache: "no-store", signal: controller.signal }),
      fetch("/api/portal/me", { cache: "no-store", signal: controller.signal }),
    ]).then(async ([jobResponse, meResponse]) => {
      if (jobResponse.status === 401 || meResponse.status === 401) { router.push("/portal/login"); return; }
      if (!jobResponse.ok) throw new Error("Job details could not be found.");
      const [jobData, meData] = await Promise.all([jobResponse.json(), meResponse.ok ? meResponse.json() : null]);
      if (!controller.signal.aborted) {
        setJob(jobData);
        setCandidateName(meData?.name || "");
      }
    }).catch((requestError) => {
      if (!controller.signal.aborted && requestError?.name !== "AbortError") setError(requestError.message || "Job details could not be loaded.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [jobId, router]);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  return (
    <PortalShell candidateName={candidateName} pageTitle="Job details" onSignOut={logout}>
      <div className="portal-detail-shell">
        <a className="portal-back-link" href="/portal/interviews"><ArrowLeft size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Back to interviews</a>
        {loading ? <div className="portal-skeleton" style={{ height: 260, marginTop: 18 }} /> : error || !job ? <p className="portal-error">{error || "Job details could not be found."}</p> : (
          <>
            <section className="portal-hero" style={{ marginTop: 18 }}>
              <div><div className="portal-eyebrow">Interview job</div><h1>{job.title}</h1><p>{job.company || "Company unavailable"}{job.location ? ` · ${job.location}` : ""}</p></div>
              {(job.apply_url || job.source_url) && <a className="portal-btn portal-btn-primary portal-btn-small" href={job.apply_url || job.source_url || undefined} target="_blank" rel="noreferrer"><ExternalLink size={13} style={{ marginRight: 4 }} />Open job posting</a>}
            </section>
            <section className="portal-card portal-detail-card" style={{ marginTop: 18 }}>
              <dl className="portal-detail-facts">
                {job.employment_type && <div><dt>Employment type</dt><dd>{job.employment_type}</dd></div>}
                {job.seniority_level && <div><dt>Seniority</dt><dd>{job.seniority_level}</dd></div>}
                {job.role_tier && <div><dt>Role tier</dt><dd>{job.role_tier}</dd></div>}
                {job.salary_range && <div><dt>Salary</dt><dd>{job.salary_range}</dd></div>}
                {job.job_function && <div><dt>Job function</dt><dd>{job.job_function}</dd></div>}
                {displayList(job.industries) && <div><dt>Industry</dt><dd>{displayList(job.industries)}</dd></div>}
                {job.posted_at && <div><dt>Posted</dt><dd>{new Date(job.posted_at).toLocaleDateString()}</dd></div>}
              </dl>
            </section>
            <section className="portal-card portal-detail-card" style={{ marginTop: 18 }}>
              <h2>Job description</h2>
              <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, color: "var(--p-ink-soft)" }}>{job.description_text || "A description was not provided for this job."}</p>
              {job.benefits && <><h2 style={{ marginTop: 24 }}>Benefits</h2><p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, color: "var(--p-ink-soft)" }}>{job.benefits}</p></>}
            </section>
            {(job.company_description || job.company_website) && <section className="portal-card portal-detail-card" style={{ marginTop: 18 }}><h2>About the company</h2>{job.company_description && <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.65, color: "var(--p-ink-soft)" }}>{job.company_description}</p>}{job.company_website && <a className="portal-btn portal-btn-secondary portal-btn-small" href={job.company_website} target="_blank" rel="noreferrer"><ExternalLink size={12} style={{ marginRight: 4 }} />Company website</a>}</section>}
          </>
        )}
      </div>
    </PortalShell>
  );
}
