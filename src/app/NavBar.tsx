// src/app/NavBar.tsx
// Mobile: Logo + wordmark left | bell + hamburger right → full-width dropdown below.
// Desktop: Logo | nav links + More dropdown | user section right.
// NO Tailwind responsive classes — all breakpoints handled in globals.css via @media.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "../components/ThemeToggle";
import NotificationBell from "../components/NotificationBell";

interface MeResponse {
  profile: { display_name: string; email: string | null; role: string };
}
interface Notifications {
  queue: { overdue: number; pendingReview: number; urgent: number };
  followUps: { due: number };
  inbox?: { pendingApprovals: number; needsReply: number };
}

function SkarionLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 622 455"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ flexShrink: 0 }}>
      <g fill="currentColor">
        <rect x="32.19"  y="31.27"  width="134.09" height="105.86" transform="rotate(-45,99.24,84.2)" />
        <rect x="104.28" y="81.02"  width="110"    height="341.41" transform="rotate(-45,159.28,251.72)" />
        <rect x="261"    y="281"    width="134.09" height="105.86" transform="rotate(-45,328.05,333.93)" />
      </g>
      <g fill="currentColor">
        <rect x="469"    y="316.57" width="134.09" height="105.86" transform="rotate(-45,536.05,369.5)" />
        <rect x="406"    y="25"     width="110"    height="341.41" transform="rotate(-45,461,195.71)" />
        <rect x="222.28" y="84.02"  width="134.09" height="105.86" transform="rotate(-45,289.33,136.95)" />
      </g>
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s ease", flexShrink: 0 }}>
      <path d="M1.5 3.5L5.5 7.5l4-4" />
    </svg>
  );
}

function BurgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {open
        ? <><line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" /></>
        : <><line x1="2" y1="6" x2="18" y2="6" /><line x1="2" y1="10" x2="18" y2="10" /><line x1="2" y1="14" x2="14" y2="14" /></>
      }
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const role       = me?.profile.role ?? "";
  const canJobs    = ["admin", "manager", "application_engineer"].includes(role);
  const canCo      = ["admin", "manager"].includes(role);
  const isAdmin    = role === "admin";
  const canSources = ["admin", "manager"].includes(role);

  const rawName   = me?.profile.display_name || me?.profile.email || "User";
  const firstName = rawName.includes(" ") ? rawName.split(" ")[0] : rawName;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : !!pathname?.startsWith(href);

  useEffect(() => {
    if (pathname?.startsWith("/portal") || pathname === "/login") return;
    fetch("/api/bootstrap").then(r => r.ok ? r.json() : null).then(setMe).catch(() => setMe(null));
    const load = async () => {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (r.ok) setNotifications(await r.json());
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [pathname]);

  useEffect(() => {
    setMoreOpen(false);
    setMobileOpen(false);
    setMobileMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (pathname?.startsWith("/portal") || pathname === "/login") return null;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const primary = [
    { href: "/candidates",          label: "Candidates",  show: true,     badge: 0, bc: "" },
    { href: "/candidate-dashboard", label: "Dashboard",   show: true,     badge: 0, bc: "" },
    { href: "/jobs",                label: "Jobs",        show: canJobs,  badge: 0, bc: "" },
    {
      href: "/application-queue", label: "App Queue", show: true, bc: "badge-danger",
      badge: notifications ? notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent : 0,
    },
    { href: "/follow-ups", label: "Follow-ups", show: true, badge: notifications?.followUps.due ?? 0, bc: "badge-warn" },
    { href: "/inbox",      label: "Inbox",      show: true, badge: notifications?.inbox?.pendingApprovals ?? 0, bc: "badge-accent" },
  ].filter(l => l.show);

  const more = [
    { href: "/communications/inbox",  label: "Communications",        show: true },
    { href: "/analytics",             label: "Analytics",             show: true },
    { href: "/chat",                  label: "Assistant",             show: true },
    { href: "/falood",                label: "Falood AI",             show: true },
    { href: "/mcp",                   label: "MCP Command Center",    show: true },
    { href: "/import-sources",        label: "Import Sources",        show: canSources },
    { href: "/audit",                 label: "Audit Log",             show: isAdmin },
    { href: "/ops",                   label: "System Health",         show: isAdmin },
    { href: "/job-ceo",               label: "Job CEO",               show: canSources },
    { href: "/job-agent",             label: "Job Agent",             show: canSources },
    { href: "/job-agent/review",      label: "Job Agent Review",      show: canSources },
    { href: "/job-agent/tokens",      label: "Job Agent Tokens",      show: isAdmin },
    { href: "/candidate-job-matches", label: "Candidate Match Review", show: canJobs },
    { href: "/admin/ai",              label: "AI Control Center",     show: isAdmin },
    { href: "/admin/extension-keys",  label: "Extension API Keys",    show: isAdmin },
    { href: "/ats-score",             label: "ATS Score Analysis",    show: true },
    { href: "/resume-parsing-status", label: "Resume Parsing Status", show: true },
    { href: "/team",                  label: "Team",                  show: isAdmin },
    { href: "/settings/webhooks",     label: "Webhooks",              show: isAdmin || role === "manager" },
    { href: "/settings/billing",      label: "Billing",               show: isAdmin || role === "manager" },
    { href: "/companies",             label: "Companies",             show: canCo },
    { href: "/interviews",            label: "Interviews",            show: true },
  ].filter(l => l.show);

  const moreActive = more.some(l => pathname?.startsWith(l.href));

  return (
    <>
      {/* ══ TOP NAV BAR ══════════════════════════════════════════════════════ */}
      <nav className="topnav">

        {/* Logo — always visible on all screen sizes */}
        <Link href="/candidates" className="nav-brand">
          <SkarionLogo size={22} />
          <span className="nav-brand-wordmark">Skarion Tracker</span>
        </Link>

        {/* ── Desktop: center nav links (hidden on mobile via CSS) ─────────── */}
        <div className="nav-desktop-links">
          {primary.map(l => (
            <Link key={l.href} href={l.href}
              className={`nav-link${isActive(l.href) ? " active" : ""}`}>
              {l.label}
              {l.badge > 0 && <span className={`nav-badge ${l.bc}`}>{l.badge}</span>}
            </Link>
          ))}
          <div className="relative" ref={moreRef}>
            <button
              className={`nav-more-btn${moreActive ? " active" : ""}`}
              onClick={() => setMoreOpen(v => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="true">
              More <Chevron open={moreOpen} />
            </button>
            {moreOpen && (
              <div className="nav-dropdown">
                {more.map(l => (
                  <Link key={l.href} href={l.href}
                    onClick={() => setMoreOpen(false)}
                    className={`nav-dropdown-item${isActive(l.href) ? " active" : ""}`}>
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Desktop: right user section (hidden on mobile via CSS) ────────── */}
        <div className="nav-desktop-user">
          <ThemeToggle />
          <div className="nav-user-separator" />
          {me?.profile && (
            <Link href="/account" className="nav-user-account-btn" title="Account settings">
              <UserIcon /><span className="nav-user-name">{firstName}</span>
            </Link>
          )}
          <NotificationBell />
          <div className="nav-user-separator" />
          <button onClick={logout} className="nav-signout">
            <SignOutIcon /><span>Sign out</span>
          </button>
        </div>

        {/* ── Mobile: bell + hamburger only (hidden on desktop via CSS) ─────── */}
        <div className="nav-mobile-right">
          <NotificationBell />
          <button
            className={`nav-burger${mobileOpen ? " is-open" : ""}`}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(v => !v)}>
            <BurgerIcon open={mobileOpen} />
          </button>
        </div>
      </nav>

      {/* ══ MOBILE FULL-WIDTH DROPDOWN (below navbar) ════════════════════════ */}
      {mobileOpen && (
        <div className="mob-panel" role="dialog" aria-label="Navigation menu" aria-modal="true">

          {/* User strip */}
          {me?.profile && (
            <Link href="/account" className="mob-user-strip" onClick={() => setMobileOpen(false)}>
              <span className="mob-avatar">{firstName.charAt(0).toUpperCase()}</span>
              <span className="mob-user-info">
                <span className="mob-user-name">{firstName}</span>
                <span className="mob-user-role">{me.profile.role.replaceAll("_", " ")}</span>
              </span>
              <UserIcon />
            </Link>
          )}

          <hr className="mob-hr" />

          {/* Primary links */}
          <p className="mob-label">Navigation</p>
          {primary.map(l => (
            <Link key={l.href} href={l.href}
              className={`mob-link${isActive(l.href) ? " active" : ""}`}
              onClick={() => setMobileOpen(false)}>
              <span>{l.label}</span>
              {l.badge > 0 && <span className={`nav-badge ${l.bc}`}>{l.badge}</span>}
            </Link>
          ))}

          <hr className="mob-hr" />

          {/* More collapsible */}
          <button
            className={`mob-more-btn${mobileMoreOpen ? " open" : ""}${moreActive ? " route-active" : ""}`}
            onClick={() => setMobileMoreOpen(v => !v)}>
            <span>More</span>
            <span className="mob-more-count">{more.length}</span>
            <Chevron open={mobileMoreOpen} />
          </button>

          {mobileMoreOpen && (
            <div className="mob-more-list">
              {more.map(l => (
                <Link key={l.href} href={l.href}
                  className={`mob-link mob-more-item${isActive(l.href) ? " active" : ""}`}
                  onClick={() => setMobileOpen(false)}>
                  {l.label}
                </Link>
              ))}
            </div>
          )}

          <hr className="mob-hr" />

          {/* Footer: theme + sign out */}
          <div className="mob-footer">
            <ThemeToggle />
            <button onClick={logout} className="mob-signout">
              <SignOutIcon /><span>Sign out</span>
            </button>
          </div>

        </div>
      )}
    </>
  );
}
