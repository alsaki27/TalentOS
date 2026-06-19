// src/app/communications/layout.tsx
// Sub-navigation layout for the Communications section.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/communications/inbox", label: "Inbox" },
  { href: "/communications/templates", label: "Templates" },
  { href: "/communications/sequences", label: "Sequences" },
  { href: "/communications/logs", label: "Logs" },
];

export default function CommunicationsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <div className="filter-bar" style={{ marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={active ? "btn-primary" : ""}
              style={{
                textDecoration: "none",
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: "var(--radius)",
                border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: active ? "var(--accent)" : "var(--surface)",
                color: active ? "white" : "var(--ink)",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
