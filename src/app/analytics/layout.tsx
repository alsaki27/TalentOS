// src/app/analytics/layout.tsx
// Analytics section layout with sub-navigation tabs

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";

  return (
    <div>
      <div className="page-header">
        <h1>Analytics</h1>
      </div>
      <div className="flex gap-2 mb-6 border-b border-[var(--border)]">
        <TabLink href="/analytics" label="Overview" pathname={pathname} />
        <TabLink href="/analytics/pipeline" label="Pipeline" pathname={pathname} />
        <TabLink href="/analytics/diversity" label="Diversity" pathname={pathname} />
        <TabLink href="/analytics/recruiters" label="Recruiters" pathname={pathname} />
      </div>
      {children}
    </div>
  );
}

function TabLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active = pathname === href || (href !== "/analytics" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={
        "px-4 py-2 text-sm font-medium transition-colors border-b-2 " +
        (active
          ? "text-[var(--accent)] border-[var(--accent)]"
          : "text-[var(--ink-soft)] hover:text-[var(--ink)] border-transparent hover:border-[var(--accent)]")
      }
    >
      {label}
    </Link>
  );
}
