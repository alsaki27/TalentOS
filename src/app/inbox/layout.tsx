// src/app/inbox/layout.tsx
// Sub-navigation for the Candidate Inbox section. Mirrors
// communications/layout.tsx's tab-bar pattern exactly.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/inbox", label: "Candidate Inbox" },
  { href: "/inbox/approvals", label: "Pending Approvals" },
];

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <div className="filter-bar" style={{ marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        {TABS.map((tab) => {
          const active = tab.href === "/inbox" ? pathname === "/inbox" : pathname?.startsWith(tab.href);
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
