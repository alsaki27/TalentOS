"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CandidatePortalApplicationDetail from "@/components/portal/CandidatePortalApplicationDetail";
import { PortalShell } from "../../PortalShell";

export default function CandidatePortalApplicationPage() {
  const params = useParams<{ id: string }>();
  const applicationId = params?.id;
  const router = useRouter();
  const [application, setApplication] = useState<any>(null);
  const [resume, setResume] = useState<any>(null);
  const [candidateName, setCandidateName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = applicationId;
    if (!id) return;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/portal/me/applications/${id}`, { signal: controller.signal, cache: "no-store" }),
      fetch(`/api/portal/me/applications/${id}/resume`, { signal: controller.signal, cache: "no-store" }),
      fetch(`/api/portal/me`, { signal: controller.signal, cache: "no-store" }),
    ])
      .then(async ([applicationResponse, resumeResponse, meResponse]) => {
        if (applicationResponse.status === 401) { router.push("/portal/login"); return; }
        if (!applicationResponse.ok) throw new Error("Application not found");
        const applicationData = await applicationResponse.json();
        const resumeData = resumeResponse.ok ? await resumeResponse.json() : null;
        const meData = meResponse.ok ? await meResponse.json() : null;
        if (!controller.signal.aborted) {
          setApplication(applicationData);
          setResume(resumeData);
          setCandidateName(meData?.name || "");
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && requestError?.name !== "AbortError") setError("Could not load this application.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applicationId, router]);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  if (loading) {
    return (
      <PortalShell candidateName={candidateName} pageTitle="Application" onSignOut={logout}>
        <div className="portal-skeleton" style={{ height: 360 }} />
      </PortalShell>
    );
  }
  if (error || !application) {
    return (
      <PortalShell candidateName={candidateName} pageTitle="Application" onSignOut={logout}>
        <p className="portal-error">{error || "Application not found."}</p>
        <button className="portal-btn portal-btn-secondary" onClick={() => router.push("/portal/applications")}>Back to applications</button>
      </PortalShell>
    );
  }

  return (
    <PortalShell candidateName={candidateName} pageTitle="Application" onSignOut={logout}>
      <CandidatePortalApplicationDetail application={application} resume={resume} onBack={() => router.push("/portal/applications")} />
    </PortalShell>
  );
}
