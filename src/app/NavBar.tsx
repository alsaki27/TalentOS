// src/app/NavBar.tsx
// Internal team nav, hidden on /portal/* routes since those links go out to candidates
// and shouldn't expose internal CRUD tooling.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "../components/ThemeToggle";
import NotificationBell from "../components/NotificationBell";

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
}

export default function NavBar() {
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const canManageSources = ["admin", "manager", "recruiter"].includes(me?.profile.role ?? "");
  const isAdmin = me?.profile.role === "admin";

  useEffect(() => {
    if (pathname?.startsWith("/portal") || pathname === "/login") return;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setNotifications(data))
      .catch(() => setNotifications(null));
  }, [pathname]);

  // Close the "More" dropdown on outside click or navigation.
  useEffect(() => { setMoreOpen(false); }, [pathname]);
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
    { href: "/analytics", label: "Analytics", show: true },
    { href: "/chat", label: "Assistant", show: true },
    { href: "/import-sources", label: "Import Sources", show: canManageSources },
    { href: "/audit", label: "Audit Log", show: isAdmin },
    { href: "/ops", label: "System Health", show: isAdmin },
    { href: "/team", label: "Team", show: isAdmin },
    { href: "/settings/webhooks", label: "Webhooks", show: isAdmin || me?.profile.role === "manager" },
    { href: "/settings/billing", label: "Billing", show: isAdmin || me?.profile.role === "manager" },
  ].filter((link) => link.show);
  const moreActive = moreLinks.some((link) => pathname?.startsWith(link.href));

  return (
    <nav className="topnav flex items-center justify-between px-6 py-3.5 bg-surface border-b border-border">
      <span className="brand font-semibold text-[15px] text-ink tracking-tight">Skarion Tracker</span>
      <div className="navlinks flex items-center gap-5">
        <Link href="/candidates" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">Candidates</Link>
        <Link href="/jobs" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">Jobs</Link>
        <Link href="/companies" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">Companies</Link>
        <Link href="/application-queue" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">
          Application Queue
          {notifications && (notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent) > 0 && (
            <span className="nav-badge">{notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent}</span>
          )}
        </Link>
        <Link href="/follow-ups" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">
          Follow-ups
          {notifications && notifications.followUps.due > 0 && <span className="nav-badge">{notifications.followUps.due}</span>}
        </Link>
        <div className="nav-more relative" ref={moreRef}>
          <button
            className="nav-more-trigger text-sm font-medium text-ink-soft hover:text-ink transition-colors"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            style={{ color: moreActive ? "var(--ink)" : undefined }}
          >
            More ▾
          </button>
          {moreOpen && (
            <div className="nav-more-menu absolute top-7 left-0 min-w-[160px] bg-surface border border-border rounded-lg shadow-lg p-1.5 flex flex-col z-50">
              {moreLinks.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMoreOpen(false)} className="px-2.5 py-2 rounded-md text-sm font-medium text-ink hover:bg-bg transition-colors">
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link href="/account" className="text-sm font-medium text-ink-soft hover:text-ink transition-colors">Account</Link>
      </div>
      <div className="nav-user flex items-center gap-3 text-xs text-ink-soft">
        <NotificationBell />
        <ThemeToggle />
        {me?.profile && (
          <span className="hidden md:inline">
            {me.profile.display_name || me.profile.email || "User"}
            <span className="role-pill">{me.profile.role.replaceAll("_", " ")}</span>
          </span>
        )}
        <button onClick={logout} className="text-xs">Sign out</button>
      </div>
    </nav>
  );
}
