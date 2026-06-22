"use client";

import { useState } from "react";
import type { ResumeDocument } from "@/lib/falood/types";

export type SectionPath =
  | "header"
  | "summary"
  | `skills[${number}]`
  | `experience[${number}]`
  | `projects[${number}]`
  | `education[${number}]`
  | `certifications[${number}]`;

export interface SectionResolution {
  path: SectionPath;
  status: "pending" | "accepted" | "rejected";
}

interface Props {
  original: ResumeDocument;
  proposed: ResumeDocument;
  onResolve: (resolutions: SectionResolution[]) => void;
  onCancel: () => void;
}

export default function InlineDiffEditor({ original, proposed, onResolve, onCancel }: Props) {
  const [resolutions, setResolutions] = useState<Record<string, SectionResolution["status"]>>({});

  // Compute which sections have changes
  const changedSections = getChangedSections(original, proposed);

  function setStatus(path: string, status: SectionResolution["status"]) {
    setResolutions((prev) => ({ ...prev, [path]: status }));
  }

  const allResolved = changedSections.every((s) => resolutions[s] !== undefined);
  const acceptedCount = changedSections.filter((s) => resolutions[s] === "accepted").length;
  const rejectedCount = changedSections.filter((s) => resolutions[s] === "rejected").length;

  function handleResolve() {
    const result: SectionResolution[] = changedSections.map((path) => ({
      path: path as SectionPath,
      status: resolutions[path] ?? "rejected",
    }));
    onResolve(result);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 style={{ fontSize: 14, margin: 0 }}>AI Suggested Changes</h3>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            {changedSections.length} section{changedSections.length !== 1 ? "s" : ""} changed ·{" "}
            {acceptedCount} accepted · {rejectedCount} rejected ·{" "}
            {changedSections.length - acceptedCount - rejectedCount} pending
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleResolve} disabled={!allResolved}>
            {allResolved ? "Apply resolved changes" : "Resolve all to apply"}
          </button>
        </div>
      </div>

      {changedSections.map((path) => {
        const status = resolutions[path] ?? "pending";
        const sectionData = getSectionData(proposed, path);
        const originalData = getSectionData(original, path);
        const label = getSectionLabel(path, sectionData, originalData);

        return (
          <div
            key={path}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
              background:
                status === "accepted"
                  ? "#f0fdf4"
                  : status === "rejected"
                  ? "#fef2f2"
                  : "#fffbeb",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className={status === "accepted" ? "btn-primary btn-compact" : "btn btn-compact"}
                  onClick={() => setStatus(path, "accepted")}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  ✓ Accept
                </button>
                <button
                  className={status === "rejected" ? "btn-danger btn-compact" : "btn btn-compact"}
                  onClick={() => setStatus(path, "rejected")}
                  style={{ fontSize: 12, padding: "4px 10px" }}
                >
                  ✗ Reject
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
              <div style={{ opacity: status === "accepted" ? 0.4 : 1 }}>
                <p className="muted" style={{ fontSize: 11, margin: "0 0 4px" }}>Original</p>
                <SectionPreview data={originalData} />
              </div>
              <div style={{ opacity: status === "rejected" ? 0.4 : 1 }}>
                <p className="muted" style={{ fontSize: 11, margin: "0 0 4px" }}>Proposed</p>
                <SectionPreview data={sectionData} />
              </div>
            </div>
          </div>
        );
      })}

      {changedSections.length === 0 && (
        <p className="muted">No structural changes detected. The AI response may be identical to the current draft.</p>
      )}
    </div>
  );
}

/* ──────────── helpers ──────────── */

function getChangedSections(orig: ResumeDocument, prop: ResumeDocument): string[] {
  const changes: string[] = [];
  if (JSON.stringify(orig.header) !== JSON.stringify(prop.header)) changes.push("header");
  if (JSON.stringify(orig.summary) !== JSON.stringify(prop.summary)) changes.push("summary");
  orig.skills.forEach((s, i) => {
    const p = prop.skills[i];
    if (!p || JSON.stringify(s) !== JSON.stringify(p)) changes.push(`skills[${i}]`);
  });
  if (prop.skills.length > orig.skills.length) {
    for (let i = orig.skills.length; i < prop.skills.length; i++) changes.push(`skills[${i}]`);
  }
  orig.experience.forEach((e, i) => {
    const p = prop.experience[i];
    if (!p || JSON.stringify(e) !== JSON.stringify(p)) changes.push(`experience[${i}]`);
  });
  if (prop.experience.length > orig.experience.length) {
    for (let i = orig.experience.length; i < prop.experience.length; i++) changes.push(`experience[${i}]`);
  }
  orig.education.forEach((e, i) => {
    const p = prop.education[i];
    if (!p || JSON.stringify(e) !== JSON.stringify(p)) changes.push(`education[${i}]`);
  });
  if (prop.education.length > orig.education.length) {
    for (let i = orig.education.length; i < prop.education.length; i++) changes.push(`education[${i}]`);
  }
  (orig.certifications ?? []).forEach((c, i) => {
    const p = (prop.certifications ?? [])[i];
    if (!p || JSON.stringify(c) !== JSON.stringify(p)) changes.push(`certifications[${i}]`);
  });
  if ((prop.certifications ?? []).length > (orig.certifications ?? []).length) {
    for (let i = (orig.certifications ?? []).length; i < (prop.certifications ?? []).length; i++) changes.push(`certifications[${i}]`);
  }
  (orig.projects ?? []).forEach((p, i) => {
    const pr = (prop.projects ?? [])[i];
    if (!pr || JSON.stringify(p) !== JSON.stringify(pr)) changes.push(`projects[${i}]`);
  });
  if ((prop.projects ?? []).length > (orig.projects ?? []).length) {
    for (let i = (orig.projects ?? []).length; i < (prop.projects ?? []).length; i++) changes.push(`projects[${i}]`);
  }
  return changes;
}

function getSectionData(doc: ResumeDocument, path: string): unknown {
  if (path === "header") return doc.header;
  if (path === "summary") return doc.summary;
  const m = path.match(/^(\w+)\[(\d+)]$/);
  if (!m) return null;
  const [, section, index] = m;
  const arr = (doc as any)[section] as any[] | undefined;
  return arr?.[parseInt(index, 10)] ?? null;
}

function getSectionLabel(path: string, data: unknown, origData: unknown): string {
  if (path === "header") return "Header";
  if (path === "summary") return "Summary";
  const m = path.match(/^(\w+)\[(\d+)]$/);
  if (!m) return path;
  const [, section, index] = m;
  const d = (data ?? origData) as any;
  const title = d?.title ?? d?.degree ?? d?.name ?? d?.fullName ?? "";
  if (title) return `${section.charAt(0).toUpperCase() + section.slice(1)}: ${title}`;
  return `${section} #${parseInt(index, 10) + 1}`;
}

function SectionPreview({ data }: { data: unknown }) {
  if (data === null || data === undefined) return <p className="muted" style={{ fontSize: 12 }}>None</p>;
  const d = data as any;

  if (typeof d === "string") return <p style={{ fontSize: 12, margin: 0, whiteSpace: "pre-wrap" }}>{d}</p>;

  if (d.fullName) {
    return (
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{d.fullName}</p>
        <p className="muted" style={{ fontSize: 11, margin: 0 }}>
          {[d.location, d.phone, d.email, d.linkedin, d.github, d.portfolio].filter(Boolean).join(" · ")}
        </p>
      </div>
    );
  }

  if (d.text !== undefined) {
    return <p style={{ fontSize: 12, margin: 0, whiteSpace: "pre-wrap" }}>{d.text}</p>;
  }

  if (d.title && d.skills) {
    return <p style={{ fontSize: 12, margin: 0 }}><strong>{d.title}:</strong> {d.skills.join(", ")}</p>;
  }

  if (d.title && d.company) {
    return (
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{d.title} — {d.company}</p>
        <p className="muted" style={{ fontSize: 11, margin: 0 }}>{d.startDate} – {d.endDate ?? "Present"}</p>
        <ul style={{ fontSize: 12, margin: "2px 0", paddingLeft: 16 }}>
          {(d.bullets ?? []).map((b: any) => <li key={b.id}>{b.text}</li>)}
        </ul>
      </div>
    );
  }

  if (d.degree && d.school) {
    return <p style={{ fontSize: 12, margin: 0 }}>{d.degree} — {d.school} {d.graduationDate ? `(${d.graduationDate})` : ""}</p>;
  }

  if (d.name) {
    return (
      <div>
        <p style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{d.name}</p>
        {d.description && <p className="muted" style={{ fontSize: 11 }}>{d.description}</p>}
        <ul style={{ fontSize: 12, margin: "2px 0", paddingLeft: 16 }}>
          {(d.bullets ?? []).map((b: any) => <li key={b.id}>{b.text}</li>)}
        </ul>
      </div>
    );
  }

  return <pre style={{ fontSize: 11, margin: 0, overflow: "auto" }}>{JSON.stringify(d, null, 2)}</pre>;
}
