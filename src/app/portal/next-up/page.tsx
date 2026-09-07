"use client";

import { useRouter } from "next/navigation";
import CandidatePortalNextUp from "@/components/portal/CandidatePortalNextUp";
import { PortalShell } from "../PortalShell";
import { usePortalDashboard, DEFAULT_OVERVIEW_FILTERS } from "../usePortalDashboard";

export default function PortalNextUpPage() {
  const router = useRouter();
  const { data, error, loading } = usePortalDashboard(DEFAULT_OVERVIEW_FILTERS);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  return (
    <PortalShell candidateName={data?.name || ""} pageTitle="Next Up" onSignOut={logout}>
      {error && <p className="portal-error">{error}</p>}
      <CandidatePortalNextUp actionItems={data?.actionItems ?? []} loading={loading || !data} />
    </PortalShell>
  );
}
