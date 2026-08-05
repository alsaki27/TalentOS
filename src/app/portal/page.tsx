"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLogo from "./PortalLogo";

interface PortalApplication {
  id: string;
  status: string;
  public_status: { stage: string; label: string };
  applied_at: string | null;
  job: { id: string; title: string; company: string; location: string | null } | null;
  updates: { id: string; body: string; created_at: string }[];
}

interface PortalDashboard {
  name: string;
  stats: { totalApplications: number; interviews: number; offers: number; responseRate: number };
  applications: PortalApplication[];
}

const STAGE_META: Record<string, { color: string; bg: string; icon: string }> = {
  submitted: { color: "#6b7280", bg: "#f1f2f5", icon: "●" },
  waiting: { color: "#122461", bg: "#eef0f8", icon: "↻" },
  interview: { color: "#b45309", bg: "#fef3e2", icon: "◆" },
  offer: { color: "#ff686b", bg: "#ffeced", icon: "★" },
  closed: { color: "#9ca3af", bg: "#f1f2f5", icon: "○" },
};

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";
}

function StatCard({ icon, value, label, index }: { icon: string; value: string | number; label: string; index: number }) {
  return (
    <div className={`portal-stat portal-stagger-${index}`}>
      <span className="portal-stat-icon">{icon}</span>
      <span className="portal-stat-value">{value}</span>
      <span className="portal-stat-label">{label}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="portal-shell">
      <div className="portal-header">
        <div className="portal-header-left">
          <div className="portal-skeleton" style={{ width: 44, height: 44, borderRadius: "50%" }} />
          <div>
            <div className="portal-skeleton" style={{ width: 160, height: 18, marginBottom: 6 }} />
            <div className="portal-skeleton" style={{ width: 220, height: 12 }} />
          </div>
        </div>
      </div>
      <div className="portal-stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="portal-skeleton" style={{ height: 84 }} />
        ))}
      </div>
      <div className="portal-skeleton" style={{ height: 90 }} />
      <div className="portal-skeleton" style={{ height: 90 }} />
    </div>
  );
}

export default function PortalDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portal/me/dashboard")
      .then((r) => {
        if (r.status === 401) {
          router.push("/portal/login");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => setError("Could not load your dashboard."));
  }, [router]);

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  if (error) {
    return (
      <div className="portal-shell">
        <p className="portal-error">{error}</p>
      </div>
    );
  }
  if (!data) return <DashboardSkeleton />;

  return (
    <div className="portal-shell">
      <div className="portal-logo">
        <PortalLogo size={22} />
        <span className="portal-logo-text">Skarion</span>
      </div>

      <div className="portal-header">
        <div className="portal-header-left">
          <div className="portal-avatar">{initials(data.name)}</div>
          <div>
            <h1 className="portal-greeting">Welcome back, {data.name.split(" ")[0]}</h1>
            <p className="portal-greeting-sub">Here&apos;s where things stand with your applications.</p>
          </div>
        </div>
        <button className="portal-signout" onClick={logout}>Sign out</button>
      </div>

      <div className="portal-stats">
        <StatCard icon="📄" value={data.stats.totalApplications} label="Applications" index={1} />
        <StatCard icon="🎯" value={data.stats.interviews} label="Interviews" index={2} />
        <StatCard icon="🏆" value={data.stats.offers} label="Offers" index={3} />
        <StatCard icon="📈" value={`${data.stats.responseRate}%`} label="Response rate" index={4} />
      </div>

      <div className="portal-section-title">Applications</div>

      {data.applications.length === 0 ? (
        <div className="portal-empty">
          <div className="portal-empty-icon">📭</div>
          No applications submitted yet — check back soon.
        </div>
      ) : (
        <div className="portal-list">
          {data.applications.map((app, i) => {
            const meta = STAGE_META[app.public_status.stage] ?? STAGE_META.submitted;
            return (
              <div key={app.id} className={`portal-app-card portal-stagger-${Math.min(i + 1, 4)}`}>
                <div className="portal-app-top">
                  <div>
                    <div className="portal-app-title">{app.job?.title ?? "Unknown role"}</div>
                    <div className="portal-app-company">
                      {app.job?.company ?? "Unknown company"}{app.job?.location ? ` · ${app.job.location}` : ""}
                    </div>
                  </div>
                  <span className="portal-pill" style={{ color: meta.color, background: meta.bg }}>
                    <span>{meta.icon}</span>
                    {app.public_status.label}
                  </span>
                </div>
                {app.applied_at && (
                  <div className="portal-app-date">Applied {new Date(app.applied_at).toLocaleDateString()}</div>
                )}
                {app.updates.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {app.updates.map((u) => (
                      <div key={u.id} className="portal-update">{u.body}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
