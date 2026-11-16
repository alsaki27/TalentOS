"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import CandidatePortalApplicationDetail from "@/components/portal/CandidatePortalApplicationDetail";

function safeApplicationsReturnPath(value: string | null) {
  return value === "/portal/applications" || value?.startsWith("/portal/applications?")
    ? value
    : "/portal/applications";
}

export default function CandidatePortalApplicationPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeApplicationsReturnPath(searchParams.get("returnTo"));
  const [application, setApplication] = useState<any>(null);
  const [resume, setResume] = useState<any>(null);
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = applicationId;
    if (!id) return;
    const controller = new AbortController();
    let disposed = false;
    let refreshing = false;
    async function refreshApplication() {
      if (disposed || refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const response = await fetch(`/api/portal/me/applications/${id}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) { router.replace("/portal/login"); return; }
        if (response.ok) {
          const applicationData = await response.json();
          if (!disposed) setApplication(applicationData);
        }
      } catch (requestError: any) {
        if (!disposed && requestError?.name !== "AbortError") console.error("Application refresh failed", requestError);
      } finally {
        refreshing = false;
      }
    }
    Promise.all([
      fetch(`/api/portal/me/applications/${id}`, { signal: controller.signal, cache: "no-store" }),
      fetch(`/api/portal/me/applications/${id}/resume`, { signal: controller.signal, cache: "no-store" }),
      fetch(`/api/portal/me`, { signal: controller.signal, cache: "no-store" }),
    ])
      .then(async ([applicationResponse, resumeResponse, meResponse]) => {
        if (applicationResponse.status === 401) { router.replace("/portal/login"); return; }
        if (!applicationResponse.ok) throw new Error("Application not found");
        const applicationData = await applicationResponse.json();
        const resumeData = resumeResponse.ok ? await resumeResponse.json() : null;
        const meData = meResponse.ok ? await meResponse.json() : null;
        if (!disposed && !controller.signal.aborted) {
          setApplication(applicationData);
          setResume(resumeData);
          setCandidateName(meData?.name || "");
        }
      })
      .catch((requestError) => {
        if (!disposed && !controller.signal.aborted && requestError?.name !== "AbortError") setError("Could not load this application.");
      })
      .finally(() => { if (!disposed && !controller.signal.aborted) setLoading(false); });
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshApplication(); };
    const timer = window.setInterval(() => { void refreshApplication(); }, 15000);
    window.addEventListener("focus", refreshApplication);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshApplication);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applicationId, router]);

  if (loading) {
    return <div className="portal-skeleton" style={{ height: 360 }} />;
  }
  if (error || !application) {
    return (
      <>
        <p className="portal-error">{error || "Application not found."}</p>
        <button className="portal-btn portal-btn-secondary" onClick={() => router.push(returnTo)}>Back to applications</button>
      </>
    );
  }

  return (
    <CandidatePortalApplicationDetail application={application} resume={resume} candidateName={candidateName} onBack={() => router.push(returnTo)} />
  );
}
