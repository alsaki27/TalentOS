"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CandidatePortalMockInterviewDetail from "@/components/portal/schedule/CandidatePortalMockInterviewDetail";
import { usePortalPolling } from "@/components/portal/schedule/usePortalPolling";
import type { PortalMockSessionDetail } from "@/lib/portalSchedule";
import { PortalShell } from "../../../PortalShell";

export default function CandidatePortalMockInterviewPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params?.id;
  const router = useRouter();
  const [candidateName, setCandidateName] = useState("");
  const session = usePortalPolling<PortalMockSessionDetail>(sessionId ? `/api/portal/me/mock-sessions/${encodeURIComponent(sessionId)}` : null);

  useEffect(() => {
    fetch("/api/portal/me", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) { router.push("/portal/login"); return null; }
        return response.ok ? response.json() : null;
      })
      .then((result) => { if (result) setCandidateName(result.name || ""); })
      .catch(() => undefined);
  }, [router]);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  let body: ReactNode;
  if (session.loading && !session.data) {
    body = <div className="portal-skeleton" style={{ height: 360 }} />;
  } else if (session.notFound) {
    body = (
      <div className="psc-empty">
        <div>This mock interview is not available.</div>
        <Link className="portal-back-link" href="/portal/interviews?tab=training" style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ArrowLeft size={13} /> Back to training audit
        </Link>
      </div>
    );
  } else if (!session.data) {
    body = <p className="portal-error">{session.error || "Could not load this mock interview."}</p>;
  } else {
    body = (
      <>
        {session.error && <div className="psc-error-banner">{session.error}</div>}
        <CandidatePortalMockInterviewDetail session={session.data} />
      </>
    );
  }

  return (
    <PortalShell candidateName={candidateName} pageTitle="Interviews" onSignOut={logout}>
      {body}
    </PortalShell>
  );
}
