"use client";

import Link from "next/link";
import { Users, FileText, Wand2, CheckCircle, PenTool } from "lucide-react";

const modules = [
  {
    title: "Resume Builder",
    description:
      "Create beautiful, ATS-optimized resumes with a live preview editor and 6 professional templates.",
    href: "/falood/studio/base/new",
    icon: PenTool,
  },
  {
    title: "Candidate Profiles",
    description:
      "Create and manage candidate profiles. Upload resumes, parse with AI, and build evidence banks.",
    href: "/candidates",
    icon: Users,
  },
  {
    title: "Base Resumes",
    description:
      "Create reusable base resumes using the Falood CLI. Build Skarion-format drafts for any industry.",
    href: "/candidates",
    icon: FileText,
  },
  {
    title: "Application Studio",
    description:
      "Paste a job description, analyze keywords, approve/reject, and tailor resumes with AI suggestions.",
    href: "/candidates",
    icon: Wand2,
  },
  {
    title: "Review Queue",
    description:
      "QC review queue for base resumes and final application packets. Review, approve, or flag issues.",
    href: "/review",
    icon: CheckCircle,
  },
];

const stats = [
  { label: "Candidates", value: 0 },
  { label: "Base Resumes", value: 0 },
  { label: "Target Jobs", value: 0 },
  { label: "Pending Review", value: 0 },
];

export default function FaloodPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Falood AI</h1>
          <p className="page-kicker">Resume &amp; Application Studio</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {modules.map((mod) => {
          const Icon = mod.icon;
          return (
            <Link
              key={mod.title}
              href={mod.href}
              className="card group block no-underline transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
              style={{ color: "inherit" }}
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent)] shrink-0">
                  <Icon size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold m-0 mb-1">{mod.title}</h2>
                  <p className="muted text-[13px] leading-relaxed m-0">
                    {mod.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="stats-strip">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <span className="stat-label">{s.label}</span>
            <span className="stat-value">{s.value}</span>
          </div>
        ))}
      </div>
    </>
  );
}
