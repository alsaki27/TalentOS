// src/app/NavBar.tsx
// Internal team nav, hidden on /portal/* routes since those links go out to candidates
// and shouldn't expose internal CRUD tooling.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  ].filter((link) => link.show);
  const moreActive = moreLinks.some((link) => pathname?.startsWith(link.href));

  return (
    <nav className="topnav">
      <span className="brand">Skarion Tracker</span>
      <div className="navlinks">
        <Link href="/candidates">Candidates</Link>
        <Link href="/jobs">Jobs</Link>
        <Link href="/companies">Companies</Link>
        <Link href="/application-queue">
          Application Queue
          {notifications && (notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent) > 0 && (
            <span className="nav-badge">{notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent}</span>
          )}
        </Link>
        <Link href="/follow-ups">
          Follow-ups
          {notifications && notifications.followUps.due > 0 && <span className="nav-badge">{notifications.followUps.due}</span>}
        </Link>
        <div className="nav-more" ref={moreRef}>
          <button
            className="nav-more-trigger"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            style={{ color: moreActive ? "var(--ink)" : undefined }}
          >
            More ▾
          </button>
          {moreOpen && (
            <div className="nav-more-menu">
              {moreLinks.map((link) => (
                <Link key={link.href} href={link.href} onClick={() => setMoreOpen(false)}>
                  {link.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <Link href="/account">Account</Link>
      </div>
      <div className="nav-user">
        {me?.profile && (
          <span>
            {me.profile.display_name || me.profile.email || "User"}
            <span className="role-pill">{me.profile.role.replaceAll("_", " ")}</span>
          </span>
        )}
        <button onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}
