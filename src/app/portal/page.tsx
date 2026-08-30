"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import CandidatePortalApplications, { type PortalApplication, type PortalDashboardFilters } from "@/components/portal/CandidatePortalApplications";
import CandidatePortalInsights from "@/components/portal/CandidatePortalInsights";
import CandidatePortalInterviewCenter from "@/components/portal/CandidatePortalInterviewCenter";
import PortalLogo from "./PortalLogo";

interface PortalDashboard {
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

interface GmailPrivacyStatus {
  email_sync_paused: boolean;
  email_consent_at: string | null;
  email_retention_days: number;
  gmail_account_id: string | null;
  gmail_email: string | null;
  gmail_status: "active" | "error" | "revoked" | null;
  gmail_scopes: string[] | null;
  gmail_last_synced_at: string | null;
  gmail_sync_error: string | null;
}

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

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function StatCard({ icon, value, label, index }: { icon: string; value: string | number; label: string; index: number }) {
  return (
    <div className={`portal-stat portal-stagger-${Math.min(index, 4)}`}>
      <span className="portal-stat-icon" aria-hidden="true">{icon}</span>
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
        {[0, 1, 2, 3, 4].map((item) => <div key={item} className="portal-skeleton" style={{ height: 84 }} />)}
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
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<PortalDashboardFilters>(initialPortalFilters);
  const [mfaEnrolled, setMfaEnrolled] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMessage, setMfaMessage] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [emailPaused, setEmailPaused] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [gmailStatus, setGmailStatus] = useState<GmailPrivacyStatus | null>(null);

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
    const nextUrl = params.toString() ? `/portal?${params.toString()}` : "/portal";
    if (typeof window !== "undefined" && `${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [filters]);

  useEffect(() => {
    fetch("/api/portal/auth/mfa")
      .then((response) => response.ok ? response.json() : null)
      .then((result) => { if (result) setMfaEnrolled(Boolean(result.enrolled)); })
      .catch(() => undefined);
    fetch("/api/portal/me/gmail/privacy")
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (result) {
          setGmailStatus(result);
          setEmailPaused(Boolean(result.email_sync_paused));
          setRetentionDays(Number(result.email_retention_days || 365));
        }
      })
      .catch(() => undefined);
  }, []);

  function updateFilters(next: Partial<PortalDashboardFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  async function logout() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  async function setupMfa() {
    setMfaMessage("");
    const response = await fetch("/api/portal/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMfaMessage(result.error || "Could not start MFA setup."); return; }
    if (result.enrolled) setMfaEnrolled(true); else setMfaSetup({ secret: result.secret, otpauthUri: result.otpauthUri });
  }

  async function confirmMfa() {
    const response = await fetch("/api/portal/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: mfaCode }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setMfaMessage(result.error || "Could not verify code."); return; }
    setMfaEnrolled(true);
    setMfaSetup(null);
    setRecoveryCodes(result.recoveryCodes || []);
    setMfaMessage("Google Authenticator is enabled. Save these one-time recovery codes.");
  }

  async function updateEmailPrivacy(nextPaused: boolean) {
    await fetch("/api/portal/me/gmail/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused: nextPaused }) });
    setEmailPaused(nextPaused);
  }

  async function deleteEmailHistory() {
    if (!window.confirm("Delete imported recruiting email history and AI drafts? This cannot be undone.")) return;
    await fetch("/api/portal/me/gmail/privacy", { method: "DELETE" });
    setMfaMessage("Imported email history deleted.");
  }

  async function disconnectGmail() {
    if (!window.confirm("Disconnect Gmail and stop all future synchronization?")) return;
    const response = await fetch("/api/portal/integrations/gmail/disconnect", { method: "POST" });
    if (!response.ok) { setMfaMessage("Gmail could not be disconnected. Please try again."); return; }
    setEmailPaused(true);
    setGmailStatus((current) => current ? { ...current, gmail_status: "revoked" } : current);
    setMfaMessage("Gmail was disconnected.");
  }

  if (error) {
    return <div className="portal-shell"><p className="portal-error">{error}</p></div>;
  }
  if (!data) return <DashboardSkeleton />;

  return (
    <div className="portal-shell">
      <div className="portal-logo"><PortalLogo size={22} /><span className="portal-logo-text">Skarion</span></div>

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
        <StatCard icon="A" value={data.summary.totalApplications} label="Applications" index={1} />
        <StatCard icon="P" value={data.summary.activeApplications} label="Active" index={2} />
        <StatCard icon="I" value={data.summary.interviews} label="Interviews" index={3} />
        <StatCard icon="O" value={data.summary.offers} label="Offers" index={4} />
        <StatCard icon="R" value={data.summary.resumesReady} label="Resumes ready" index={5} />
      </div>

      <CandidatePortalInsights trend={data.trend} actionItems={data.actionItems} />
      <CandidatePortalInterviewCenter />

      <div className="portal-card" style={{ marginBottom: 24, padding: 16 }}>
        <strong>Account security</strong>
        {mfaEnrolled ? <p className="portal-greeting-sub">Google Authenticator is enabled for your next sign-in.</p> : !mfaSetup ? <><p className="portal-greeting-sub">Protect your candidate dashboard with Google Authenticator.</p><button className="portal-btn portal-btn-primary" onClick={setupMfa}>Set up Google Authenticator</button></> : <div style={{ marginTop: 10 }}><p className="portal-greeting-sub">Scan this QR code in Google Authenticator, then enter the six-digit code.</p><div style={{ background: "white", padding: 16, display: "inline-block", borderRadius: 8, marginBottom: 12 }}><QRCode value={mfaSetup.otpauthUri} size={150} /></div><p style={{ fontSize: 12 }}>Manual key: <strong>{mfaSetup.secret}</strong></p><div style={{ display: "flex", gap: 8, marginTop: 8 }}><input inputMode="numeric" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" /><button className="portal-btn portal-btn-primary" onClick={confirmMfa}>Enable MFA</button></div></div>}
        {recoveryCodes.length > 0 && <code style={{ display: "block", marginTop: 8, wordBreak: "break-word" }}>{recoveryCodes.join(" · ")}</code>}
        {mfaMessage && <p className="portal-greeting-sub">{mfaMessage}</p>}
      </div>

      <div className="portal-card" style={{ marginBottom: 24, padding: 16 }}>
        <strong>Email privacy controls</strong>
        <p className="portal-greeting-sub">{gmailStatus?.gmail_status === "active" ? `Connected to ${gmailStatus.gmail_email || "Gmail"}. You can pause inbox review or delete imported history at any time.` : "Gmail is not connected. Connecting is optional and requires separate Gmail consent."}</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {gmailStatus?.gmail_status === "active" ? <button className="portal-btn portal-btn-primary" onClick={() => updateEmailPrivacy(!emailPaused)}>{emailPaused ? "Resume email review" : "Pause email review"}</button> : <a className="portal-btn portal-btn-primary" href="/api/portal/me/gmail/start">Connect Gmail</a>}
          <label style={{ fontSize: 12 }}>Retention <select value={retentionDays} onChange={async (event) => { const value = Number(event.target.value); setRetentionDays(value); await fetch("/api/portal/me/gmail/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retentionDays: value }) }); }}><option value={90}>90 days</option><option value={365}>1 year</option><option value={730}>2 years</option><option value={3650}>10 years</option></select></label>
          <button className="portal-btn" onClick={deleteEmailHistory}>Delete imported history</button>
          {gmailStatus?.gmail_account_id && gmailStatus.gmail_status !== "revoked" && <button className="portal-btn" onClick={disconnectGmail}>Disconnect Gmail</button>}
        </div>
        {gmailStatus?.gmail_status === "error" && <p className="portal-error">Gmail needs to be reconnected before synchronization can continue.</p>}
      </div>

      <CandidatePortalApplications
        applications={data.applications}
        total={data.total}
        page={data.page}
        pageSize={data.pageSize}
        totalPages={data.totalPages}
        sourceCounts={data.sourceCounts}
        filters={filters}
        loading={loading}
        onFiltersChange={updateFilters}
      />
    </div>
  );
}
