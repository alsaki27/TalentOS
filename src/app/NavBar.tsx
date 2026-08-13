// src/app/NavBar.tsx
// Internal team nav, hidden on /portal/* routes since those links go out to candidates
// and shouldn't expose internal CRUD tooling.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "../components/ThemeToggle";
import NotificationBell from "../components/NotificationBell";
import QuickApplicationModal from "../components/QuickApplicationModal";

interface MeResponse {
  profile: {
    display_name: string;
    email: string | null;
    role: string;
  };
}

interface Notifications {
  queue: { overdue: number; pendingReview: number; urgent: number };
  followUps: { due: number };
  inbox?: { pendingApprovals: number; needsReply: number };
}

export default function NavBar() {
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const currentRole = me?.profile.role ?? "";
  const canViewJobs = ["admin", "manager", "application_engineer"].includes(currentRole);
  const canViewCompanies = ["admin", "manager"].includes(currentRole);
  const canViewTeam = currentRole === "admin";
  const isAdmin = currentRole === "admin";
  const canManageSources = ["admin", "manager"].includes(currentRole);
  const canQuickApply = ["admin", "manager", "application_engineer"].includes(currentRole);

  useEffect(() => {
    if (pathname?.startsWith("/portal") || pathname === "/login") return;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
    // Notification count fetched once on mount; periodic refresh handled by NotificationBell
    async function loadBadgeCounts() {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) setNotifications(await res.json());
    }
    loadBadgeCounts();
    const interval = setInterval(loadBadgeCounts, 60000);
    return () => clearInterval(interval);
  }, [pathname]);

  // Close the "More" dropdown and the mobile menu on outside click or navigation.
  useEffect(() => { setMoreOpen(false); setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (pathname?.startsWith("/portal")) return null;
  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const moreLinks = [
    { href: "/communications/inbox", label: "Communications", show: true },
    { href: "/analytics", label: "Analytics", show: true },
    { href: "/chat", label: "Assistant", show: true },
    { href: "/import-sources", label: "Import Sources", show: canManageSources },
    { href: "/audit", label: "Audit Log", show: isAdmin },
    { href: "/ops", label: "System Health", show: isAdmin },
    { href: "/job-ceo", label: "Job CEO", show: canManageSources },
    { href: "/job-agent", label: "Job Agent", show: canManageSources },
    { href: "/job-agent/review", label: "Job Agent Review", show: canManageSources },
    { href: "/job-agent/tokens", label: "Job Agent Tokens", show: isAdmin },
    { href: "/candidate-job-matches", label: "Candidate Match Review", show: canViewJobs },
    { href: "/admin/ai", label: "AI Control Center", show: isAdmin },
    { href: "/admin/extension-keys", label: "Extension API Keys", show: isAdmin },
    { href: "/ats-score", label: "ATS Score Analysis", show: true },
    { href: "/resume-parsing-status", label: "Resume Parsing Status", show: true },
    { href: "/team", label: "Team", show: isAdmin },
    { href: "/settings/webhooks", label: "Webhooks", show: isAdmin || me?.profile.role === "manager" },
    { href: "/settings/billing", label: "Billing", show: isAdmin || me?.profile.role === "manager" },
    { href: "/companies", label: "Companies", show: canViewCompanies },
    { href: "/interviews", label: "Interviews", show: true },
  ].filter((link) => link.show);
  const moreActive = moreLinks.some((link) => pathname?.startsWith(link.href)) || pathname?.startsWith("/communications");

  return (<>
    <nav className="topnav relative flex items-center justify-between px-6 py-3.5 bg-surface/80 backdrop-blur-xl border-b border-white/5 sticky top-0 z-50 shadow-glass">
      <span className="brand font-bold text-[16px] text-ink tracking-tight bg-gradient-to-r from-violet-400 to-blue-400 bg-clip-text text-transparent">Skarion Tracker</span>

      <button
        className="nav-mobile-toggle lg:hidden text-ink-soft hover:text-ink transition-colors"
        aria-label="Toggle navigation menu"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((v) => !v)}
      >
        {mobileOpen ? "✕" : "☰"}
      </button>

      <div
        className={`navlinks ${mobileOpen ? "flex" : "hidden"} lg:flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-6
          absolute lg:static left-0 right-0 top-full lg:top-auto
          bg-surface lg:bg-transparent border-b lg:border-0 border-white/5
          px-6 py-4 lg:p-0 z-40 shadow-lg lg:shadow-none`}
      >
        <Link href="/candidates" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors">Candidates</Link>
        <Link href="/candidate-dashboard" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors">Dashboard</Link>
        {canViewJobs && <Link href="/jobs" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors">Jobs</Link>}
        <Link href="/falood" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors">Falood AI</Link>
        <Link href="/application-queue" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors flex items-center gap-1.5">
          Application Queue
          {notifications && (notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent) > 0 && (
            <span className="nav-badge bg-rose-500/20 text-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.3)]">{notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent}</span>
          )}
        </Link>
        <Link href="/follow-ups" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors flex items-center gap-1.5">
          Follow-ups
          {notifications && notifications.followUps.due > 0 && <span className="nav-badge bg-orange-500/20 text-orange-400">{notifications.followUps.due}</span>}
        </Link>
        <Link href="/inbox" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors flex items-center gap-1.5">
          Inbox
          {notifications?.inbox && notifications.inbox.pendingApprovals > 0 && (
            <span className="nav-badge bg-violet-500/20 text-violet-400">{notifications.inbox.pendingApprovals}</span>
          )}
        </Link>
        <div className="nav-more relative" ref={moreRef}>
          <button
            className="nav-more-trigger text-[13px] font-medium text-ink-soft hover:text-white transition-colors flex items-center gap-1"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            style={{ color: moreActive ? "var(--ink)" : undefined }}
          >
            More <span className="text-[10px] opacity-70">▾</span>
          </button>
          {moreOpen && (
            <div className="nav-more-menu absolute top-8 left-0 min-w-[180px] bg-surface/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-1.5 flex flex-col z-50">
              {moreLinks.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMoreOpen(false)} className="px-3 py-2 rounded-lg text-[13px] font-medium text-ink-soft hover:text-white hover:bg-white/5 transition-all">
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link href="/account" className="text-[13px] font-medium text-ink-soft hover:text-white transition-colors">Account</Link>

        {/* On mobile the collapsible panel also carries the user actions, since nav-user is hidden below lg. */}
        <div className="flex lg:hidden items-center gap-4 text-xs text-ink-soft pt-4 mt-2 border-t border-white/5 w-full">
          {canQuickApply && (
            <button
              className="text-[13px] font-semibold text-violet-400 hover:text-violet-300 transition-colors"
              onClick={() => setShowModal(true)}
            >
              + New Application
            </button>
          )}
          <NotificationBell />
          <ThemeToggle />
          <button onClick={logout} className="text-[13px] font-medium hover:text-white transition-colors">Sign out</button>
        </div>
      </div>

      <div className="nav-user hidden lg:flex items-center gap-4 text-[13px] text-ink-soft">
        {canQuickApply && (
          <button
            className="text-[13px] font-semibold text-violet-400 hover:text-violet-300 hover:drop-shadow-[0_0_8px_rgba(139,92,246,0.5)] transition-all"
            onClick={() => setShowModal(true)}
          >
            + New Application
          </button>
        )}
        <div className="flex items-center gap-3 pl-4 border-l border-white/10">
          <NotificationBell />
          <ThemeToggle />
          {me?.profile && (
            <span className="hidden xl:flex items-center gap-2">
              <span className="font-medium text-white">{me.profile.display_name || me.profile.email || "User"}</span>
              <span className="role-pill bg-violet-500/10 text-violet-400 border border-violet-500/20 shadow-[0_0_10px_rgba(139,92,246,0.1)]">{me.profile.role.replaceAll("_", " ")}</span>
            </span>
          )}
          <button onClick={logout} className="text-[13px] font-medium hover:text-white transition-colors">Sign out</button>
        </div>
      </div>
    </nav>
    {showModal && <QuickApplicationModal userRole={me?.profile.role ?? ""} onClose={() => setShowModal(false)} />}
  </>);
}
