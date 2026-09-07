"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Briefcase, ListChecks, CalendarClock, ShieldCheck, Menu, X, LogOut, Sun, Moon, MonitorSmartphone } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import PortalLogo from "./PortalLogo";

// Real routes, not anchors - each nav item opens its own page (matching the
// Luminaux inspiration site's actual per-section pages) instead of
// scrolling one long page back to a section.
const NAV_ITEMS = [
  { href: "/portal", label: "Overview", icon: LayoutDashboard },
  { href: "/portal/applications", label: "Applications", icon: Briefcase },
  { href: "/portal/next-up", label: "Next Up", icon: ListChecks },
  { href: "/portal/interviews", label: "Interviews", icon: CalendarClock },
  { href: "/portal/account", label: "Account", icon: ShieldCheck },
];

function PortalThemeToggle() {
  const { theme, setTheme, resolved } = useTheme();
  const cycle = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };
  const Icon = theme === "system" ? MonitorSmartphone : resolved === "dark" ? Moon : Sun;
  return (
    <button
      type="button"
      className="portal-icon-btn"
      onClick={cycle}
      title={`Theme: ${theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"}`}
      aria-label="Toggle color theme"
    >
      <Icon size={17} />
    </button>
  );
}

export function PortalShell({
  children,
  candidateName,
  pageTitle,
  onSignOut,
}: {
  children: ReactNode;
  candidateName: string;
  pageTitle: string;
  onSignOut: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  function initials(name: string) {
    return (
      name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "?"
    );
  }

  function firstName(name: string) {
    return name.split(" ").filter(Boolean)[0] || name;
  }

  function isActive(href: string) {
    // "/portal" itself must not match every sub-route (applications,
    // interviews, account, or an application-detail page) - only its own
    // exact path. Every other nav item matches its own path and anything
    // nested under it.
    if (href === "/portal") return pathname === "/portal";
    return pathname === href || pathname?.startsWith(`${href}/`);
  }

  return (
    <div className={`portal-layout ${mobileOpen ? "portal-sidebar-open" : ""}`}>
      <div className="portal-sidebar-backdrop" onClick={() => setMobileOpen(false)} />

      <aside className="portal-sidebar">
        <div className="portal-sidebar-logo">
          <PortalLogo size={24} />
          <span>Skarion</span>
        </div>

        <nav className="portal-sidebar-nav" aria-label="Portal navigation">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`portal-sidebar-link ${isActive(item.href) ? "portal-sidebar-link-active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <item.icon size={17} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="portal-sidebar-profile">
          <div className="portal-sidebar-profile-row">
            <div className="portal-avatar" style={{ width: 32, height: 32, fontSize: 12 }}>
              {initials(candidateName)}
            </div>
            {/* First name only here - the full name doesn't fit this fixed-width
                sidebar without ellipsis-truncating; the full name is shown in
                the "Welcome back" hero on Overview instead. */}
            <span className="portal-sidebar-profile-name">{firstName(candidateName)}</span>
          </div>
          <button type="button" className="portal-sidebar-signout" onClick={onSignOut}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="portal-content">
        <header className="portal-topbar">
          <div className="portal-topbar-left">
            <button
              type="button"
              className="portal-icon-btn portal-hamburger"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
            <span className="portal-topbar-title">{pageTitle}</span>
          </div>
          <div className="portal-topbar-actions">
            <PortalThemeToggle />
          </div>
        </header>

        <main className="portal-main">{children}</main>
      </div>
    </div>
  );
}
