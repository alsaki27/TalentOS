"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PortalApplication, PortalDashboardFilters } from "@/components/portal/CandidatePortalApplications";

export interface PortalDashboard {
  name: string;
  summary: {
    totalApplications: number;
    activeApplications: number;
    interviews: number;
    offers: number;
    resumesReady: number;
  };
  applications: PortalApplication[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sourceCounts: Record<string, number>;
  trend: { hourly24h: { bucket: string; count: number }[]; daily7d: { bucket: string; count: number }[]; monthly6m: { bucket: string; count: number }[] };
  actionItems: { id: string; type: "interview" | "follow_up"; title: string; description: string; due_at: string | null; href: string }[];
}

// Shared by every page that needs the candidate portal dashboard payload
// (Overview and Applications today) - extracted so the debounce + abort +
// 401-redirect logic only lives in one place.
export function usePortalDashboard(filters: PortalDashboardFilters) {
  const router = useRouter();
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(filters.page), pageSize: "10" });
    if (filters.search) params.set("search", filters.search);
    if (filters.status) params.set("status", filters.status);
    if (filters.source) params.set("source", filters.source);
    if (filters.dateRange !== "all") params.set("dateRange", filters.dateRange);
    if (filters.dateRange === "custom" && filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateRange === "custom" && filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.resumeStatus !== "all") params.set("resumeStatus", filters.resumeStatus);
    if (filters.interviewStatus !== "all") params.set("interviewStatus", filters.interviewStatus);
    if (filters.needsAttention) params.set("needsAttention", "true");
    if (filters.sort !== "submitted_at") params.set("sort", filters.sort);
    if (filters.order !== "desc") params.set("order", filters.order);

    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetch(`/api/portal/me/dashboard?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
        .then((response) => {
          if (response.status === 401) {
            router.push("/portal/login");
            return null;
          }
          if (!response.ok) throw new Error("dashboard request failed");
          return response.json();
        })
        .then((dashboard) => {
          if (dashboard && !controller.signal.aborted) setData(dashboard);
        })
        .catch((requestError) => {
          if (!controller.signal.aborted && requestError?.name !== "AbortError") setError("Could not load your dashboard.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filters, router]);

  return { data, error, loading };
}

export const DEFAULT_OVERVIEW_FILTERS: PortalDashboardFilters = {
  search: "",
  status: "",
  source: "",
  dateRange: "all",
  dateFrom: "",
  dateTo: "",
  resumeStatus: "all",
  interviewStatus: "all",
  needsAttention: false,
  sort: "submitted_at",
  order: "desc",
  page: 1,
};
