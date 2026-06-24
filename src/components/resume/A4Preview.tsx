"use client";

import { useMemo, useState, useRef, useEffect } from "react";

/* ──────────── types ──────────── */

interface ResumeDocument {
  header: {
    fullName: string;
    location?: string;
    phone?: string;
    email?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
  };
  summary?: { id: string; text: string };
  skills: { id: string; title: string; skills: string[] }[];
  experience: {
    id: string;
    title: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    bullets: { id: string; text: string }[];
  }[];
  education: { id: string; degree: string; school: string; graduationDate?: string }[];
  certifications?: { id: string; name: string; issuer?: string; date?: string }[];
  projects?: { id: string; title: string; description?: string; bullets: { id: string; text: string }[] }[];
}

interface KeywordHighlight {
  keyword: string;
  color: string;
  sectionId?: string;
}

interface A4PreviewProps {
  content: ResumeDocument;
  highlights?: KeywordHighlight[];
  activeSection?: string | null;
  onSectionClick?: (section: string) => void;
  zoom?: number;
  pageBreakY?: number | null; // px from top where page break would occur
}

/* ──────────── helpers ──────────── */

function highlightText(text: string, highlights: KeywordHighlight[]): React.ReactNode[] {
  if (!highlights.length) return [text];

  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  for (const h of highlights) {
    const regex = new RegExp(`(\\b${escapeRegExp(h.keyword)}\\b)`, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(remaining)) !== null) {
      const before = remaining.slice(0, match.index);
      if (before) parts.push(<span key={`b${keyIdx++}`}>{before}</span>);
      parts.push(
        <mark
          key={`h${keyIdx++}`}
          style={{
            background: h.color,
            borderRadius: 2,
            padding: "0 2px",
            color: "inherit",
            fontWeight: 600,
          }}
          title={`Keyword: ${h.keyword}`}
        >
          {match[1]}
        </mark>
      );
      remaining = remaining.slice(match.index + match[1].length);
      regex.lastIndex = 0;
    }
  }

  if (remaining) parts.push(<span key={`e${keyIdx++}`}>{remaining}</span>);
  return parts.length ? parts : [text];
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ──────────── component ──────────── */

export default function A4Preview({
  content,
  highlights = [],
  activeSection,
  onSectionClick,
  zoom = 1,
  pageBreakY,
}: A4PreviewProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const [internalZoom, setInternalZoom] = useState(zoom);
  const [measuredHeight, setMeasuredHeight] = useState(0);

  useEffect(() => { setInternalZoom(zoom); }, [zoom]);

  // A4 is 210mm x 297mm. At 96 DPI, that's ~794px x 1123px.
  // We use a scale transform so the page fits the container.
  const A4_WIDTH_PX = 794;
  const A4_HEIGHT_PX = 1123;
  const MARGIN_PX = 56; // ~0.5 inch

  useEffect(() => {
    if (paperRef.current) {
      setMeasuredHeight(paperRef.current.scrollHeight);
    }
  }, [content, internalZoom]);

  const isActive = (section: string) => activeSection === section;

  return (
    <div className="a4-preview-wrapper">
      {/* Zoom controls */}
      <div className="a4-preview-toolbar">
        <span className="a4-preview-label">A4 Preview</span>
        <div className="a4-zoom-controls">
          <button onClick={() => setInternalZoom((z) => Math.max(0.5, z - 0.1))} title="Zoom out">−</button>
          <span>{Math.round(internalZoom * 100)}%</span>
          <button onClick={() => setInternalZoom((z) => Math.min(2, z + 0.1))} title="Zoom in">+</button>
          <button onClick={() => setInternalZoom(1)} title="Fit width">Fit</button>
        </div>
        <span className="a4-page-info">
          {pageBreakY ? `~${(measuredHeight / pageBreakY).toFixed(1)} pages` : "1 page"}
        </span>
      </div>

      {/* Scrollable container */}
      <div className="a4-preview-scroll">
        <div
          className="a4-paper"
          ref={paperRef}
          style={{
            width: A4_WIDTH_PX,
            minHeight: A4_HEIGHT_PX,
            transform: `scale(${internalZoom})`,
            transformOrigin: "top center",
          }}
        >
          {/* Page break indicator */}
          {pageBreakY && (
            <div
              className="a4-page-break"
              style={{ top: pageBreakY }}
              title="Approximate page break"
            />
          )}

          {/* ─── HEADER ─── */}
          <div
            className={`a4-section a4-header ${isActive("header") ? "a4-section-active" : ""}`}
            onClick={() => onSectionClick?.("header")}
          >
            <h1 className="a4-name">{content.header.fullName}</h1>
            <div className="a4-contact-line">
              {[
                content.header.location,
                content.header.phone,
                content.header.email,
                content.header.linkedin,
                content.header.github,
                content.header.portfolio,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </div>
          </div>

          {/* ─── SUMMARY ─── */}
          {content.summary?.text && (
            <div
              className={`a4-section a4-summary ${isActive("summary") ? "a4-section-active" : ""}`}
              onClick={() => onSectionClick?.("summary")}
            >
              <p className="a4-summary-text">
                {highlightText(content.summary.text, highlights)}
              </p>
            </div>
          )}

          {/* ─── SKILLS ─── */}
          {content.skills.length > 0 && (
            <div
              className={`a4-section a4-skills ${isActive("skills") ? "a4-section-active" : ""}`}
              onClick={() => onSectionClick?.("skills")}
            >
              <h2 className="a4-section-title">Skills</h2>
              {content.skills.map((group) => (
                <div key={group.id} className="a4-skill-group">
                  <span className="a4-skill-title">{group.title}:</span>{" "}
                  <span className="a4-skill-list">
                    {group.skills.map((s, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {highlightText(s, highlights)}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ─── EXPERIENCE ─── */}
          {content.experience.length > 0 && (
            <div
              className={`a4-section a4-experience ${isActive("experience") ? "a4-section-active" : ""}`}
              onClick={() => onSectionClick?.("experience")}
            >
              <h2 className="a4-section-title">Professional Experience</h2>
              {content.experience.map((exp) => (
                <div key={exp.id} className="a4-job">
                  <div className="a4-job-header">
                    <span className="a4-job-title">{exp.title}</span>
                    <span className="a4-job-company">{exp.company}</span>
                    {exp.location && <span className="a4-job-location">· {exp.location}</span>}
                  </div>
                  <div className="a4-job-dates">
                    {exp.startDate} — {exp.endDate ?? "Present"}
                  </div>
                  <ul className="a4-bullets">
                    {exp.bullets.map((b) => (
                      <li key={b.id} className="a4-bullet">
                        {highlightText(b.text, highlights)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* ─── PROJECTS ─── */}
          {(content.projects ?? []).length > 0 && (
            <div
              className={`a4-section a4-projects ${isActive("projects") ? "a4-section-active" : ""}`}
              onClick={() => onSectionClick?.("projects")}
            >
              <h2 className="a4-section-title">Projects</h2>
              {content.projects!.map((proj) => (
                <div key={proj.id} className="a4-project">
                  <div className="a4-project-title">{proj.title}</div>
                  {proj.description && (
                    <p className="a4-project-desc">{proj.description}</p>
                  )}
                  <ul className="a4-bullets">
                    {proj.bullets.map((b) => (
                      <li key={b.id} className="a4-bullet">
                        {highlightText(b.text, highlights)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* ─── EDUCATION ─── */}
          {content.education.length > 0 && (
            <div
              className={`a4-section a4-education ${isActive("education") ? "a4-section-active" : ""}`}
              onClick={() => onSectionClick?.("education")}
            >
              <h2 className="a4-section-title">Education</h2>
              {content.education.map((edu) => (
                <div key={edu.id} className="a4-edu-item">
                  <span className="a4-edu-degree">{edu.degree}</span>
                  <span className="a4-edu-school">{edu.school}</span>
                  {edu.graduationDate && (
                    <span className="a4-edu-date">{edu.graduationDate}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ─── CERTIFICATIONS ─── */}
          {(content.certifications ?? []).length > 0 && (
            <div
              className={`a4-section a4-certifications ${isActive("certifications") ? "a4-section-active" : ""}`}
              onClick={() => onSectionClick?.("certifications")}
            >
              <h2 className="a4-section-title">Certifications</h2>
              <div className="a4-cert-list">
                {content.certifications!.map((cert) => (
                  <span key={cert.id} className="a4-cert-item">
                    {cert.name}
                    {cert.issuer && ` — ${cert.issuer}`}
                    {cert.date && ` (${cert.date})`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inline styles for the preview */}
      <style>{`
        .a4-preview-wrapper {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #e8e9ec;
          border-radius: var(--radius);
          overflow: hidden;
        }
        .a4-preview-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          font-size: 12px;
        }
        .a4-preview-label {
          font-weight: 600;
          color: var(--ink);
        }
        .a4-zoom-controls {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .a4-zoom-controls button {
          padding: 2px 8px;
          font-size: 14px;
          min-width: 28px;
        }
        .a4-zoom-controls span {
          min-width: 36px;
          text-align: center;
          font-weight: 600;
          color: var(--ink-soft);
        }
        .a4-page-info {
          color: var(--ink-soft);
          font-size: 11px;
        }
        .a4-preview-scroll {
          flex: 1;
          overflow: auto;
          padding: 24px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
        }
        .a4-paper {
          background: #ffffff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 8px 32px rgba(0,0,0,0.08);
          padding: 56px 56px 56px 56px;
          font-family: "Calibri", "Segoe UI", Arial, sans-serif;
          font-size: 10.5pt;
          line-height: 1.15;
          color: #1a1a1a;
          position: relative;
          cursor: default;
          transition: box-shadow 0.2s ease;
        }
        .a4-paper:hover {
          box-shadow: 0 4px 16px rgba(0,0,0,0.15), 0 12px 40px rgba(0,0,0,0.10);
        }
        .a4-page-break {
          position: absolute;
          left: 0;
          right: 0;
          border-top: 2px dashed #b3261e;
          pointer-events: none;
          z-index: 10;
        }
        .a4-page-break::after {
          content: "Page Break";
          position: absolute;
          right: 8px;
          top: -18px;
          font-size: 9px;
          color: #b3261e;
          background: #fff;
          padding: 0 4px;
          font-weight: 600;
        }
        .a4-section {
          margin-bottom: 14px;
          padding: 4px 6px;
          border-radius: 4px;
          border: 1px solid transparent;
          transition: background 0.15s ease, border-color 0.15s ease;
          cursor: pointer;
        }
        .a4-section:hover {
          background: rgba(42, 111, 79, 0.04);
          border-color: rgba(42, 111, 79, 0.15);
        }
        .a4-section-active {
          background: rgba(42, 111, 79, 0.08) !important;
          border-color: var(--accent) !important;
          box-shadow: 0 0 0 1px var(--accent);
        }
        .a4-header {
          text-align: center;
          margin-bottom: 16px;
        }
        .a4-name {
          font-size: 22pt;
          font-weight: 700;
          margin: 0 0 6px;
          color: #1a1a1a;
          letter-spacing: 0.5px;
        }
        .a4-contact-line {
          font-size: 9.5pt;
          color: #333;
          line-height: 1.4;
        }
        .a4-summary-text {
          font-size: 10.5pt;
          line-height: 1.35;
          margin: 0;
          text-align: justify;
        }
        .a4-section-title {
          font-size: 11pt;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          border-bottom: 1px solid #1a1a1a;
          padding-bottom: 3px;
          margin: 0 0 8px;
          color: #1a1a1a;
        }
        .a4-skill-group {
          margin-bottom: 4px;
          font-size: 10pt;
        }
        .a4-skill-title {
          font-weight: 600;
        }
        .a4-skill-list {
          color: #333;
        }
        .a4-job {
          margin-bottom: 12px;
        }
        .a4-job-header {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0 8px;
          margin-bottom: 2px;
        }
        .a4-job-title {
          font-weight: 700;
          font-size: 10.5pt;
        }
        .a4-job-company {
          font-weight: 600;
          font-size: 10.5pt;
          color: #333;
        }
        .a4-job-location {
          font-size: 10pt;
          color: #555;
        }
        .a4-job-dates {
          font-size: 10pt;
          color: #555;
          margin-bottom: 4px;
          font-style: italic;
        }
        .a4-bullets {
          margin: 0;
          padding-left: 18px;
        }
        .a4-bullet {
          font-size: 10pt;
          line-height: 1.35;
          margin-bottom: 3px;
        }
        .a4-project {
          margin-bottom: 8px;
        }
        .a4-project-title {
          font-weight: 700;
          font-size: 10.5pt;
        }
        .a4-project-desc {
          font-size: 10pt;
          color: #444;
          margin: 2px 0 4px;
          font-style: italic;
        }
        .a4-edu-item {
          margin-bottom: 4px;
          font-size: 10pt;
        }
        .a4-edu-degree {
          font-weight: 600;
        }
        .a4-edu-school {
          color: #333;
        }
        .a4-edu-date {
          color: #555;
          font-style: italic;
          margin-left: 4px;
        }
        .a4-cert-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0 16px;
          font-size: 10pt;
        }
        .a4-cert-item {
          color: #333;
        }
      `}</style>
    </div>
  );
}
