"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CandidatePortalApplicationDetail from "@/components/portal/CandidatePortalApplicationDetail";

export default function CandidatePortalApplicationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [application, setApplication] = useState<any>(null);
  const [resume, setResume] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/portal/me/applications/${id}`, { signal: controller.signal, cache: "no-store" }),
      fetch(`/api/portal/me/applications/${id}/resume`, { signal: controller.signal, cache: "no-store" }),
    ])
      .then(async ([applicationResponse, resumeResponse]) => {
        if (applicationResponse.status === 401) { router.push("/portal/login"); return; }
        if (!applicationResponse.ok) throw new Error("Application not found");
        const applicationData = await applicationResponse.json();
        const resumeData = resumeResponse.ok ? await resumeResponse.json() : null;
        if (!controller.signal.aborted) { setApplication(applicationData); setResume(resumeData); }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError?.name !== "AbortError") setError("Could not load this application.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [params, router]);

  if (loading) return <div className="portal-shell"><div className="portal-skeleton" style={{ height: 360 }} /></div>;
  if (error || !application) return <div className="portal-shell"><p className="portal-error">{error || "Application not found."}</p><button className="portal-btn portal-btn-secondary" onClick={() => router.push("/portal")}>Back to dashboard</button></div>;

  return <CandidatePortalApplicationDetail application={application} resume={resume} onBack={() => router.push("/portal")} />;
}
