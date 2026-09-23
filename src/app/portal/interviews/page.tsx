"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CandidatePortalInterviewCenter from "@/components/portal/CandidatePortalInterviewCenter";
import { PortalShell } from "../PortalShell";

export default function PortalInterviewsPage() {
  const router = useRouter();
  const [candidateName, setCandidateName] = useState("");

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

  return (
    <PortalShell candidateName={candidateName} pageTitle="Interviews" onSignOut={logout}>
      <CandidatePortalInterviewCenter />
    </PortalShell>
  );
}
