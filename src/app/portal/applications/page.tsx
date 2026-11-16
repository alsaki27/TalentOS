"use client";

import { useEffect, useState } from "react";
import CandidatePortalApplications, { buildPortalApplicationsUrl, type PortalDashboardFilters } from "@/components/portal/CandidatePortalApplications";
import { usePortalDashboard } from "../usePortalDashboard";

function initialPortalFilters(): PortalDashboardFilters {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    source: params.get("source") ?? "",
    dateRange: params.get("dateRange") ?? "all",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    resumeStatus: params.get("resumeStatus") ?? "all",
    interviewStatus: params.get("interviewStatus") ?? "all",
    needsAttention: params.get("needsAttention") === "true",
    sort: params.get("sort") ?? "submitted_at",
    order: params.get("order") ?? "desc",
    page: Math.max(1, Number(params.get("page") ?? "1") || 1),
  };
}

export default function PortalApplicationsPage() {
  const [filters, setFilters] = useState<PortalDashboardFilters>(initialPortalFilters);
  const { data, error, loading } = usePortalDashboard(filters);

  useEffect(() => {
    const nextUrl = buildPortalApplicationsUrl(filters);
    if (typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [filters]);

  function updateFilters(next: Partial<PortalDashboardFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  return (
    <>
      {error && <p className="portal-error">{error}</p>}
      <CandidatePortalApplications
        applications={data?.applications ?? []}
        total={data?.total ?? 0}
        page={data?.page ?? 1}
        pageSize={data?.pageSize ?? 10}
        totalPages={data?.totalPages ?? 1}
        sourceCounts={data?.sourceCounts ?? {}}
        filters={filters}
        loading={loading || !data}
        onFiltersChange={updateFilters}
      />
    </>
  );
}
