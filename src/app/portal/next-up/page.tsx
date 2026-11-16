"use client";

import CandidatePortalNextUp from "@/components/portal/CandidatePortalNextUp";
import { usePortalDashboard, DEFAULT_OVERVIEW_FILTERS } from "../usePortalDashboard";

export default function PortalNextUpPage() {
  const { data, error, loading } = usePortalDashboard(DEFAULT_OVERVIEW_FILTERS);

  return (
    <>
      {error && <p className="portal-error">{error}</p>}
      <CandidatePortalNextUp actionItems={data?.actionItems ?? []} loading={loading || !data} />
    </>
  );
}
