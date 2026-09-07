"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Briefcase, Activity, CalendarCheck2, Award, FileCheck2, type LucideIcon } from "lucide-react";
import CandidatePortalInsights from "@/components/portal/CandidatePortalInsights";
import { PortalShell } from "./PortalShell";
import { usePortalDashboard, DEFAULT_OVERVIEW_FILTERS } from "./usePortalDashboard";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function StatCard({ icon: Icon, badgeClass, value, label, index }: { icon: LucideIcon; badgeClass: string; value: string | number; label: string; index: number }) {
  return (
    <div className={`portal-stat portal-stagger-${Math.min(index, 4)}`}>
      <span className={`portal-icon-badge ${badgeClass}`} aria-hidden="true"><Icon size={16} /></span>
      <span className="portal-stat-value">{value}</span>
      <span className="portal-stat-label">{label}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div className="portal-skeleton" style={{ height: 132, borderRadius: "var(--p-radius-lg)" }} />
      <div className="portal-stats">
        {[0, 1, 2, 3, 4].map((item) => <div key={item} className="portal-skeleton" style={{ height: 84 }} />)}
      </div>
      <div className="portal-skeleton" style={{ height: 90 }} />
      <div className="portal-skeleton" style={{ height: 90 }} />
    </div>
  );
}

export default function PortalOverviewPage() {
  const router = useRouter();
  const { data, error, loading } = usePortalDashboard(DEFAULT_OVERVIEW_FILTERS);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  if (error) {
    return (
      <PortalShell candidateName="" pageTitle="Overview" onSignOut={logout}>
        <p className="portal-error">{error}</p>
      </PortalShell>
    );
  }
  if (!data) {
    return (
      <PortalShell candidateName="" pageTitle="Overview" onSignOut={logout}>
        <DashboardSkeleton />
      </PortalShell>
    );
  }

  return (
    <PortalShell candidateName={data.name} pageTitle="Overview" onSignOut={logout}>
      <div className="portal-hero">
        <div className="portal-hero-left">
          <div className="portal-hero-avatar">{initials(data.name)}</div>
          <div>
            <h1>Welcome back, {data.name.split(" ")[0]}</h1>
            <p>Here&apos;s where things stand with your applications.</p>
          </div>
        </div>
        <div className="portal-hero-chips">
          <Link href="/portal/applications?status=Interview" className="portal-hero-chip" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>{data.summary.activeApplications}</strong><span>Active</span>
          </Link>
          <Link href="/portal/interviews" className="portal-hero-chip" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>{data.summary.interviews}</strong><span>Interviews</span>
          </Link>
          <Link href="/portal/applications" className="portal-hero-chip" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>{data.summary.offers}</strong><span>Offers</span>
          </Link>
        </div>
      </div>

      <div className="portal-stats">
        <StatCard icon={Briefcase} badgeClass="portal-icon-badge-navy" value={data.summary.totalApplications} label="Applications" index={1} />
        <StatCard icon={Activity} badgeClass="portal-icon-badge-coral" value={data.summary.activeApplications} label="Active" index={2} />
        <StatCard icon={CalendarCheck2} badgeClass="portal-icon-badge-amber" value={data.summary.interviews} label="Interviews" index={3} />
        <StatCard icon={Award} badgeClass="portal-icon-badge-green" value={data.summary.offers} label="Offers" index={4} />
        <StatCard icon={FileCheck2} badgeClass="portal-icon-badge-navy" value={data.summary.resumesReady} label="Resumes ready" index={5} />
      </div>

      <CandidatePortalInsights trend={data.trend} actionItems={data.actionItems} loading={loading} />
    </PortalShell>
  );
}
