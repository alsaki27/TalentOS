"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

const STAGE_COLOR: Record<string, string> = {
  submitted: "var(--ink-soft)",
  waiting: "var(--accent)",
  interview: "#f59e0b",
  offer: "#10b981",
  closed: "var(--ink-soft)",
};

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

  if (error) return <div style={{ padding: 40 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40 }}>Loading...</div>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>Welcome back, {data.name}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Here&apos;s where things stand with your applications.</p>
        </div>
        <button className="btn" onClick={logout}>Sign out</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {[
          { label: "Applications", value: data.stats.totalApplications },
          { label: "Interviews", value: data.stats.interviews },
          { label: "Offers", value: data.stats.offers },
          { label: "Response rate", value: `${data.stats.responseRate}%` },
        ].map((card) => (
          <div key={card.label} className="card" style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--ink-soft)", fontWeight: 700 }}>{card.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {data.applications.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--ink-soft)" }}>No applications submitted yet.</div>
        ) : (
          data.applications.map((app, i) => (
            <div
              key={app.id}
              style={{
                padding: 16,
                borderBottom: i < data.applications.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{app.job?.title ?? "Unknown role"}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {app.job?.company ?? "Unknown company"}{app.job?.location ? ` · ${app.job.location}` : ""}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 10,
                    whiteSpace: "nowrap",
                    color: STAGE_COLOR[app.public_status.stage] ?? "var(--ink-soft)",
                    border: `1px solid ${STAGE_COLOR[app.public_status.stage] ?? "var(--border)"}`,
                  }}
                >
                  {app.public_status.label}
                </span>
              </div>
              {app.applied_at && (
                <div className="muted" style={{ fontSize: 12 }}>
                  Applied {new Date(app.applied_at).toLocaleDateString()}
                </div>
              )}
              {app.updates.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                  {app.updates.map((u) => (
                    <div key={u.id} style={{ fontSize: 13, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                      {u.body}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
