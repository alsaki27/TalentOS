"use client";

import { useRef, useState } from "react";

const MERGE_TAGS = [
  { label: "Candidate Name", value: "{{candidate_name}}" },
  { label: "Job Title", value: "{{job_title}}" },
  { label: "Company Name", value: "{{company_name}}" },
  { label: "Interviewer Name", value: "{{interviewer_name}}" },
  { label: "Interview Date", value: "{{interview_date}}" },
  { label: "Interview Time", value: "{{interview_time}}" },
  { label: "Interview Link", value: "{{interview_link}}" },
  { label: "Portal URL", value: "{{portal_url}}" },
];

interface TemplateEditorProps {
  value: string;
  onChange: (val: string) => void;
  subject?: string;
  onSubjectChange?: (val: string) => void;
  previewData?: Record<string, string>;
}

export default function TemplateEditor({
  value,
  onChange,
  subject = "",
  onSubjectChange,
  previewData,
}: TemplateEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"editor" | "preview">("editor");

  function insertTag(tag: string) {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = before + tag + after;
    onChange(next);
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = start + tag.length;
      el.focus();
    }, 0);
  }

  function renderPreview(text: string, data: Record<string, string> = {}) {
    return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key) => data[key] ?? _match);
  }

  const sampleData: Record<string, string> = {
    candidate_name: "Jane Smith",
    job_title: "Senior Software Engineer",
    company_name: "Acme Corp",
    interviewer_name: "John Doe",
    interview_date: "2024-12-15",
    interview_time: "10:00 AM",
    interview_link: "https://meet.example.com/abc123",
    portal_url: "https://portal.example.com",
    ...previewData,
  };

  return (
    <div className="template-editor" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, minHeight: 360 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="filter-bar" style={{ marginBottom: 0, gap: 6 }}>
          <button className={mode === "editor" ? "btn-primary" : ""} onClick={() => setMode("editor")}>Editor</button>
          <button className={mode === "preview" ? "btn-primary" : ""} onClick={() => setMode("preview")}>Preview</button>
        </div>

        {onSubjectChange && (
          <div className="field-group" style={{ marginBottom: 0 }}>
            <label>Subject</label>
            <input value={subject} onChange={(e) => onSubjectChange(e.target.value)} placeholder="Email subject…" />
          </div>
        )}

        <div className="field-group" style={{ marginBottom: 0, flex: 1, display: "flex", flexDirection: "column" }}>
          <label>Body</label>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your template here… Use merge tags to personalize."
            style={{ flex: 1, minHeight: 240, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 }}
          />
        </div>

        <div>
          <label style={{ marginBottom: 6 }}>Merge Tags</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {MERGE_TAGS.map((tag) => (
              <button key={tag.value} className="btn-compact" onClick={() => insertTag(tag.value)} title={tag.value}>
                {tag.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Live Preview</h3>
          <span className="muted" style={{ fontSize: 12 }}>with sample data</span>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, background: "var(--bg)" }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            Subject: {renderPreview(subject, sampleData)}
          </div>
          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0" }} />
          <div
            style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
            dangerouslySetInnerHTML={{ __html: renderPreview(value, sampleData).replace(/\n/g, "<br/>") }}
          />
        </div>
      </div>
    </div>
  );
}
