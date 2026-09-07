"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CandidatePortalApplications, { type PortalDashboardFilters } from "@/components/portal/CandidatePortalApplications";
import { PortalShell } from "../PortalShell";
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
  const router = useRouter();
  const [filters, setFilters] = useState<PortalDashboardFilters>(initialPortalFilters);
  const { data, error, loading } = usePortalDashboard(filters);

  useEffect(() => {
    const params = new URLSearchParams();
    const values: Record<string, string> = {
      search: filters.search,
      status: filters.status,
      source: filters.source,
      dateRange: filters.dateRange === "all" ? "" : filters.dateRange,
      dateFrom: filters.dateRange === "custom" ? filters.dateFrom : "",
      dateTo: filters.dateRange === "custom" ? filters.dateTo : "",
      resumeStatus: filters.resumeStatus === "all" ? "" : filters.resumeStatus,
      interviewStatus: filters.interviewStatus === "all" ? "" : filters.interviewStatus,
      needsAttention: filters.needsAttention ? "true" : "",
      sort: filters.sort === "submitted_at" ? "" : filters.sort,
      order: filters.order === "desc" ? "" : filters.order,
      page: filters.page === 1 ? "" : String(filters.page),
    };
    Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); });
    const nextUrl = params.toString() ? `/portal/applications?${params.toString()}` : "/portal/applications";
    if (typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [filters]);

  function updateFilters(next: Partial<PortalDashboardFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  return (
    <PortalShell candidateName={data?.name || ""} pageTitle="Applications" onSignOut={logout}>
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
    </PortalShell>
  );
}
