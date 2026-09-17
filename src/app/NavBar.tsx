// src/app/NavBar.tsx
// Internal team nav — hidden on /portal/* (candidate-facing) and /login.
// Design: minimalistic modern admin top nav.
// All visual styles driven from globals.css nav design tokens — zero hardcoded values.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  inbox?: { pendingApprovals: number; needsReply: number };
}

// ─── Skarion inline SVG logo ────────────────────────────────────────────────
function SkarionLogo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 622 455"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <g fill="currentColor">
        <rect x="32.19" y="31.27" width="134.09" height="105.86" transform="rotate(-45,99.24,84.2)" />
        <rect x="104.28" y="81.02" width="110" height="341.41" transform="rotate(-45,159.28,251.72)" />
        <rect x="261" y="281" width="134.09" height="105.86" transform="rotate(-45,328.05,333.93)" />
      </g>
      <g fill="currentColor">
        <rect x="469" y="316.57" width="134.09" height="105.86" transform="rotate(-45,536.05,369.5)" />
        <rect x="406" y="25" width="110" height="341.41" transform="rotate(-45,461,195.71)" />
        <rect x="222.28" y="84.02" width="134.09" height="105.86" transform="rotate(-45,289.33,136.95)" />
      </g>
    </svg>
  );
}

// ─── Chevron ────────────────────────────────────────────────────────────────
function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10"
      fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease", opacity: 0.6 }}
    >
      <path d="M1.5 3.5L5 7l3.5-3.5" />
    </svg>
  );
}

// ─── Hamburger ──────────────────────────────────────────────────────────────
function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      {open ? (
        <>
          <line x1="3" y1="3" x2="15" y2="15" />
          <line x1="15" y1="3" x2="3" y2="15" />
        </>
      ) : (
        <>
          <line x1="2" y1="5" x2="16" y2="5" />
          <line x1="2" y1="9" x2="16" y2="9" />
          <line x1="2" y1="13" x2="13" y2="13" />
        </>
      )}
    </svg>
  );
}

// ─── Sign-out icon ──────────────────────────────────────────────────────────
function SignOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

// ─── User / Account icon ────────────────────────────────────────────────────
function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [notifications, setNotifications] = useState<Notifications | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const currentRole = me?.profile.role ?? "";
  const canViewJobs = ["admin", "manager", "application_engineer"].includes(currentRole);
  const canViewCompanies = ["admin", "manager"].includes(currentRole);
  const isAdmin = currentRole === "admin";
  const canManageSources = ["admin", "manager"].includes(currentRole);

  // Extract first name only from display_name
  const rawName = me?.profile.display_name || me?.profile.email || "User";
  const firstName = rawName.includes(" ") ? rawName.split(" ")[0] : rawName;

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return !!pathname?.startsWith(href);
  }

  useEffect(() => {
    if (pathname?.startsWith("/portal") || pathname === "/login") return;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));

    async function loadBadgeCounts() {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (res.ok) setNotifications(await res.json());
    }
    loadBadgeCounts();
    const interval = setInterval(loadBadgeCounts, 60000);
    return () => clearInterval(interval);
  }, [pathname]);

  useEffect(() => { setMoreOpen(false); setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
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

  // ─── Primary nav links ────────────────────────────────────────────────────
  const primaryLinks = [
    {
      href: "/candidates", label: "Candidates", show: true,
      badge: 0, badgeColor: "",
    },
    {
      href: "/candidate-dashboard", label: "Dashboard", show: true,
      badge: 0, badgeColor: "",
    },
    {
      href: "/jobs", label: "Jobs", show: canViewJobs,
      badge: 0, badgeColor: "",
    },
    {
      href: "/application-queue", label: "App Queue", show: true,
      badge: notifications ? notifications.queue.overdue + notifications.queue.pendingReview + notifications.queue.urgent : 0,
      badgeColor: "badge-danger",
    },
    {
      href: "/follow-ups", label: "Follow-ups", show: true,
      badge: notifications?.followUps.due ?? 0,
      badgeColor: "badge-warn",
    },
    {
      href: "/inbox", label: "Inbox", show: true,
      badge: notifications?.inbox?.pendingApprovals ?? 0,
      badgeColor: "badge-accent",
    },
  ].filter((l) => l.show);

  // ─── "More" overflow links ────────────────────────────────────────────────
  const moreLinks = [
    { href: "/communications/inbox",  label: "Communications",         show: true },
    { href: "/analytics",             label: "Analytics",              show: true },
    { href: "/chat",                  label: "Assistant",              show: true },
    { href: "/falood",                label: "Falood AI",              show: true },
    { href: "/mcp",                   label: "MCP Command Center",     show: true },
    { href: "/import-sources",        label: "Import Sources",         show: canManageSources },
    { href: "/audit",                 label: "Audit Log",              show: isAdmin },
    { href: "/ops",                   label: "System Health",          show: isAdmin },
    { href: "/job-ceo",               label: "Job CEO",                show: canManageSources },
    { href: "/job-agent",             label: "Job Agent",              show: canManageSources },
    { href: "/job-agent/review",      label: "Job Agent Review",       show: canManageSources },
    { href: "/job-agent/tokens",      label: "Job Agent Tokens",       show: isAdmin },
    { href: "/candidate-job-matches", label: "Candidate Match Review", show: canViewJobs },
    { href: "/admin/ai",              label: "AI Control Center",      show: isAdmin },
    { href: "/admin/extension-keys",  label: "Extension API Keys",     show: isAdmin },
    { href: "/ats-score",             label: "ATS Score Analysis",     show: true },
    { href: "/resume-parsing-status", label: "Resume Parsing Status",  show: true },
    { href: "/team",                  label: "Team",                   show: isAdmin },
    { href: "/settings/webhooks",     label: "Webhooks",               show: isAdmin || me?.profile.role === "manager" },
    { href: "/settings/billing",      label: "Billing",                show: isAdmin || me?.profile.role === "manager" },
    { href: "/companies",             label: "Companies",              show: canViewCompanies },
    { href: "/interviews",            label: "Interviews",             show: true },
  ].filter((l) => l.show);

  const moreActive = moreLinks.some((l) => pathname?.startsWith(l.href));

  return (
    <>
      <nav className="topnav" style={{ position: "sticky", top: 0, zIndex: 50 }}>

        {/* ── Left: Logo + Wordmark ─────────────────────────────────────── */}
        <Link href="/candidates" className="nav-brand">
          <SkarionLogo size={22} />
          <span className="nav-brand-wordmark">Skarion Tracker</span>
        </Link>

        {/* ── Center: Primary nav links (desktop only) ──────────────────── */}
        <div className="navlinks hidden lg:flex">
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link${isActive(link.href) ? " active" : ""}`}
            >
              {link.label}
              {link.badge > 0 && (
                <span className={`nav-badge ${link.badgeColor}`}>
                  {link.badge}
                </span>
              )}
            </Link>
          ))}

          {/* "More" mega-dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              className={`nav-more-btn${moreActive ? " active" : ""}`}
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-haspopup="true"
            >
              More
              <ChevronDown open={moreOpen} />
            </button>
            {moreOpen && (
              <div className="nav-dropdown">
                {moreLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMoreOpen(false)}
                    className={`nav-dropdown-item${isActive(link.href) ? " active" : ""}`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: user section (desktop) ────────────────────────────── */}
        <div className="nav-user hidden lg:flex">

          {/* Theme toggle */}
          <ThemeToggle />

          <div className="nav-user-separator" />

          {/* First name → clicks to /account */}
          {me?.profile && (
            <Link href="/account" className="nav-user-account-btn" title="Account settings">
              <UserIcon />
              <span className="nav-user-name">{firstName}</span>
            </Link>
          )}

          {/* Notification bell — rightmost before sign out */}
          <NotificationBell />

          <div className="nav-user-separator" />

          {/* Sign out with icon */}
          <button onClick={logout} className="nav-signout" title="Sign out">
            <SignOutIcon />
            <span>Sign out</span>
          </button>
        </div>

        {/* ── Mobile: compact right cluster ─────────────────────────────── */}
        <div className="flex lg:hidden items-center gap-2">
          <ThemeToggle />
          <NotificationBell />
          <button
            className="nav-mobile-toggle"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <HamburgerIcon open={mobileOpen} />
          </button>
        </div>
      </nav>

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="nav-drawer lg:hidden">

          {/* User identity strip */}
          {me?.profile && (
            <Link
              href="/account"
              onClick={() => setMobileOpen(false)}
              className="nav-drawer-user-strip"
            >
              <span className="nav-drawer-user-avatar">
                {firstName.charAt(0).toUpperCase()}
              </span>
              <span>
                <span className="nav-drawer-user-name">{firstName}</span>
                <span className="nav-drawer-user-role">{me.profile.role.replaceAll("_", " ")}</span>
              </span>
            </Link>
          )}

          <div className="nav-drawer-divider" />

          {/* Main links */}
          <div className="nav-drawer-section-label">Navigation</div>
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`nav-drawer-link${isActive(link.href) ? " active" : ""}`}
            >
              <span>{link.label}</span>
              {link.badge > 0 && (
                <span className={`nav-badge ${link.badgeColor}`}>{link.badge}</span>
              )}
            </Link>
          ))}

          <div className="nav-drawer-divider" />

          {/* More links */}
          <div className="nav-drawer-section-label">More</div>
          {moreLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={`nav-drawer-link${isActive(link.href) ? " active" : ""}`}
            >
              {link.label}
            </Link>
          ))}

          <div className="nav-drawer-divider" />

          {/* Sign out */}
          <div className="nav-drawer-actions">
            <button onClick={logout} className="nav-signout" style={{ width: "100%", justifyContent: "center" }}>
              <SignOutIcon />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
