"use client";

import React, { useState } from "react";
import type {
  ResumeDocument,
  ExperienceBlock,
  SkillSection,
  ProjectBlock,
  EducationBlock,
  CertificationBlock,
  ResumeCustomSection,
} from "@/lib/falood/types";

interface Props {
  original: ResumeDocument;
  current: ResumeDocument;
}

type DiffStatus = "added" | "removed" | "modified" | "unchanged";

function compareJSON(a: unknown, b: unknown): DiffStatus {
  if (JSON.stringify(a) === JSON.stringify(b)) return "unchanged";
  if (!a && b) return "added";
  if (a && !b) return "removed";
  return "modified";
}

function DiffBadge({ status }: { status: DiffStatus }) {
  const map: Record<DiffStatus, string> = {
    added: "bg-green-100 text-green-800",
    removed: "bg-red-100 text-red-800",
    modified: "bg-yellow-100 text-yellow-800",
    unchanged: "bg-gray-100 text-gray-600",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function CollapsibleSection({
  label,
  status,
  children,
  defaultOpen = false,
}: {
  label: string;
  status: DiffStatus;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(status !== "unchanged" ? true : defaultOpen);
  return (
    <div className="border border-[#e2e4e8] rounded-lg mb-3 overflow-hidden">
      <button
        className="w-full text-left px-4 py-2 text-sm font-medium flex items-center justify-between bg-[#f7f7f8] hover:bg-[#eef1f5]"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2">
          {label}
          <DiffBadge status={status} />
        </span>
        <span className="text-[#5a5f6b]">{open ? "▼" : "▶"}</span>
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

function SideBySide({
  label,
  orig,
  curr,
  status,
  render,
}: {
  label: string;
  orig: unknown;
  curr: unknown;
  status: DiffStatus;
  render: (item: unknown) => React.ReactNode;
}) {
  if (status === "unchanged") {
    return (
      <CollapsibleSection label={label} status="unchanged" defaultOpen={false}>
        <div>{render(curr)}</div>
      </CollapsibleSection>
    );
  }
  return (
    <CollapsibleSection label={label} status={status}>
      <div className="grid grid-cols-2 gap-4">
        <div
          className={`rounded p-3 ${
            status === "added"
              ? "opacity-40 bg-gray-50"
              : status === "removed"
              ? "bg-red-50"
              : "bg-yellow-50/50"
          }`}
        >
          <p className="text-xs font-semibold text-[#5a5f6b] mb-2">Original</p>
          {orig ? render(orig) : <p className="text-xs text-[#5a5f6b] italic">None</p>}
        </div>
        <div
          className={`rounded p-3 ${
            status === "added"
              ? "bg-green-50"
              : status === "removed"
              ? "opacity-40 bg-gray-50"
              : "bg-yellow-50/50"
          }`}
        >
          <p className="text-xs font-semibold text-[#5a5f6b] mb-2">Current</p>
          {curr ? render(curr) : <p className="text-xs text-[#5a5f6b] italic">None</p>}
        </div>
      </div>
    </CollapsibleSection>
  );
}

function diffArray<T extends { id: string }>(orig: T[] = [], curr: T[] = []): { item: T; status: DiffStatus }[] {
  const origMap = new Map(orig.map((i) => [i.id, i]));
  const currMap = new Map(curr.map((i) => [i.id, i]));
  const result: { item: T; status: DiffStatus }[] = [];

  for (const item of curr) {
    if (!origMap.has(item.id)) {
      result.push({ item, status: "added" });
    } else {
      const o = origMap.get(item.id)!;
      result.push({
        item,
        status: JSON.stringify(o) === JSON.stringify(item) ? "unchanged" : "modified",
      });
    }
  }

  for (const item of orig) {
    if (!currMap.has(item.id)) {
      result.push({ item, status: "removed" });
    }
  }

  return result;
}

function ArrayDiffSection<T extends { id: string }>({
  label,
  orig,
  curr,
  renderItem,
  itemLabel,
}: {
  label: string;
  orig: T[];
  curr: T[];
  renderItem: (item: T, status: DiffStatus) => React.ReactNode;
  itemLabel: (item: T) => string;
}) {
  const diffs = diffArray(orig, curr);
  const overallStatus = diffs.some((d) => d.status !== "unchanged") ? "modified" : "unchanged";

  return (
    <CollapsibleSection label={label} status={overallStatus}>
      <div className="space-y-2">
        {diffs.map((d) => (
          <div
            key={d.item.id}
            className={`border rounded-lg p-3 ${
              d.status === "added"
                ? "bg-green-50 border-green-200"
                : d.status === "removed"
                ? "bg-red-50 border-red-200"
                : d.status === "modified"
                ? "bg-yellow-50 border-yellow-200"
                : "bg-white border-[#e2e4e8]"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[#1a1d23]">{itemLabel(d.item)}</span>
              <DiffBadge status={d.status} />
            </div>
            {renderItem(d.item, d.status)}
          </div>
        ))}
        {diffs.length === 0 && <p className="text-xs text-[#5a5f6b] italic">No items</p>}
      </div>
    </CollapsibleSection>
  );
}

export default function ResumeDiffViewer({ original, current }: Props) {
  return (
    <div className="space-y-2">
      <SideBySide
        label="Header"
        orig={original.header}
        curr={current.header}
        status={compareJSON(original.header, current.header)}
        render={(h) => (
          <div>
            <p className="text-sm font-semibold text-[#1a1d23]">{(h as any).fullName}</p>
            <p className="text-xs text-[#5a5f6b]">
              {[
                (h as any).location,
                (h as any).phone,
                (h as any).email,
                (h as any).linkedin,
                (h as any).github,
                (h as any).portfolio,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
      />

      <SideBySide
        label="Summary"
        orig={original.summary}
        curr={current.summary}
        status={compareJSON(original.summary, current.summary)}
        render={(s) => (
          <p className="text-sm text-[#1a1d23]">
            {(s as any)?.text ?? <span className="text-[#5a5f6b] italic">None</span>}
          </p>
        )}
      />

      <ArrayDiffSection
        label="Skills"
        orig={original.skills}
        curr={current.skills}
        itemLabel={(s: SkillSection) => s.title}
        renderItem={(s, status) => (
          <p className="text-xs text-[#1a1d23]">
            <strong>{s.title}:</strong> {s.skills.join(", ")}
          </p>
        )}
      />

      <ArrayDiffSection
        label="Experience"
        orig={original.experience}
        curr={current.experience}
        itemLabel={(e: ExperienceBlock) => `${e.title} at ${e.company}`}
        renderItem={(exp, status) => (
          <div>
            <p className="text-xs text-[#5a5f6b]">
              {exp.startDate} – {exp.endDate ?? "Present"}{" "}
              {exp.location ? `· ${exp.location}` : ""}
            </p>
            <ul className="text-xs text-[#1a1d23] mt-1 pl-4 list-disc">
              {exp.bullets.map((b) => (
                <li key={b.id}>{b.text}</li>
              ))}
            </ul>
          </div>
        )}
      />

      <ArrayDiffSection
        label="Projects"
        orig={original.projects ?? []}
        curr={current.projects ?? []}
        itemLabel={(p: ProjectBlock) => p.name}
        renderItem={(proj, status) => (
          <div>
            {proj.description && <p className="text-xs text-[#5a5f6b]">{proj.description}</p>}
            {proj.technologies && proj.technologies.length > 0 && (
              <p className="text-xs text-[#5a5f6b]">{proj.technologies.join(", ")}</p>
            )}
            <ul className="text-xs text-[#1a1d23] mt-1 pl-4 list-disc">
              {proj.bullets.map((b) => (
                <li key={b.id}>{b.text}</li>
              ))}
            </ul>
          </div>
        )}
      />

      <ArrayDiffSection
        label="Education"
        orig={original.education}
        curr={current.education}
        itemLabel={(e: EducationBlock) => `${e.degree} — ${e.school}`}
        renderItem={(edu, status) => (
          <p className="text-xs text-[#1a1d23]">
            {edu.location ? `${edu.location} · ` : ""}
            {edu.graduationDate ? `Graduated: ${edu.graduationDate}` : ""}
          </p>
        )}
      />

      <ArrayDiffSection
        label="Certifications"
        orig={original.certifications ?? []}
        curr={current.certifications ?? []}
        itemLabel={(c: CertificationBlock) => c.name}
        renderItem={(cert, status) => (
          <p className="text-xs text-[#1a1d23]">
            {cert.issuer ? `Issuer: ${cert.issuer}` : ""}
            {cert.issuer && cert.date ? " · " : ""}
            {cert.date ? cert.date : ""}
          </p>
        )}
      />

      <ArrayDiffSection
        label="Custom Sections"
        orig={original.customSections ?? []}
        curr={current.customSections ?? []}
        itemLabel={(s: ResumeCustomSection) => s.title}
        renderItem={(section, status) => (
          <ul className="text-xs text-[#1a1d23] pl-4 list-disc">
            {section.bullets.map((b) => (
              <li key={b.id}>{b.text}</li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}
