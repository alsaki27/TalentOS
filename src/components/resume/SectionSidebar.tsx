"use client";

import { useState } from "react";

/* ──────────── types ──────────── */

interface ResumeDocument {
  header: { fullName: string; location?: string; phone?: string; email?: string; linkedin?: string; github?: string; portfolio?: string };
  summary?: { id: string; text: string };
  skills: { id: string; title: string; skills: string[] }[];
  experience: { id: string; title: string; company: string; location?: string; startDate: string; endDate?: string; bullets: { id: string; text: string }[] }[];
  education: { id: string; degree: string; school: string; graduationDate?: string }[];
  certifications?: { id: string; name: string; issuer?: string; date?: string }[];
  projects?: { id: string; title: string; description?: string; bullets: { id: string; text: string }[] }[];
}

interface SectionSidebarProps {
  content: ResumeDocument;
  activeSection: string | null;
  onSectionClick: (section: string | null) => void;
  onUpdateContent: (section: string, value: any) => void;
  onAISectionAction: (section: string, action: string, prompt?: string) => void;
  keywordMap?: Record<string, string[]>; // keyword -> [sectionIds]
  suggestionsBySection?: Record<string, { id: string; text: string; type: string; status: string }[]>;
}

const SECTIONS = [
  { key: "header", label: "Header", icon: "👤" },
  { key: "summary", label: "Summary", icon: "📝" },
  { key: "skills", label: "Skills", icon: "🛠️" },
  { key: "experience", label: "Experience", icon: "💼" },
  { key: "projects", label: "Projects", icon: "🚀" },
  { key: "education", label: "Education", icon: "🎓" },
  { key: "certifications", label: "Certifications", icon: "🏆" },
] as const;

const AI_ACTIONS: Record<string, { label: string; prompt: string; icon: string }[]> = {
  summary: [
    { label: "Improve clarity", prompt: "Rewrite this professional summary to be more concise, impactful, and tailored to the job. Keep it under 3 sentences.", icon: "✨" },
    { label: "Add metrics", prompt: "Add quantifiable achievements to this summary (numbers, percentages, dollar amounts).", icon: "📊" },
    { label: "Shorten", prompt: "Shorten this summary to 2 lines while keeping the key impact.", icon: "✂️" },
  ],
  skills: [
    { label: "Add missing JD skills", prompt: "Add any job-description skills that are missing from this section. Remove irrelevant ones.", icon: "➕" },
    { label: "Reorder by relevance", prompt: "Reorder skills to put the most relevant ones first based on the job description.", icon: "🔀" },
    { label: "Group better", prompt: "Regroup skills into better categories (e.g., Languages, Frameworks, Tools, Cloud).", icon: "📂" },
  ],
  experience: [
    { label: "Add action verbs", prompt: "Rewrite bullet points to start with strong action verbs.", icon: "💪" },
    { label: "Add metrics", prompt: "Add quantifiable results to each bullet point (%, $, time saved, etc.).", icon: "📊" },
    { label: "Shorten bullets", prompt: "Shorten each bullet to one line while keeping impact.", icon: "✂️" },
    { label: "Match JD keywords", prompt: "Inject approved job-description keywords into relevant bullet points.", icon: "🎯" },
  ],
  header: [
    { label: "Update contact", prompt: "Verify and format the contact information professionally.", icon: "📇" },
  ],
  education: [
    { label: "Add coursework", prompt: "Add relevant coursework or honors if applicable.", icon: "📚" },
  ],
  projects: [
    { label: "Add impact", prompt: "Add impact metrics and outcomes to each project description.", icon: "📈" },
  ],
  certifications: [
    { label: "Add expiry dates", prompt: "Add relevant expiry or issue dates for certifications.", icon: "📅" },
  ],
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export default function SectionSidebar({
  content,
  activeSection,
  onSectionClick,
  onUpdateContent,
  onAISectionAction,
  keywordMap = {},
  suggestionsBySection = {},
}: SectionSidebarProps) {
  const [customPrompt, setCustomPrompt] = useState<Record<string, string>>({});
  const [editingInline, setEditingInline] = useState<Record<string, boolean>>({});
  const [inlineEditTemp, setInlineEditTemp] = useState<Record<string, any>>({});

  function getSectionStats(key: string) {
    switch (key) {
      case "header":
        return content.header.fullName;
      case "summary":
        return content.summary?.text ? `${content.summary.text.slice(0, 40)}…` : "Empty";
      case "skills":
        return `${content.skills.length} groups, ${content.skills.reduce((s, g) => s + g.skills.length, 0)} skills`;
      case "experience":
        return `${content.experience.length} jobs, ${content.experience.reduce((s, e) => s + e.bullets.length, 0)} bullets`;
      case "projects":
        return `${(content.projects ?? []).length} projects`;
      case "education":
        return `${content.education.length} degrees`;
      case "certifications":
        return `${(content.certifications ?? []).length} certs`;
      default:
        return "";
    }
  }

  function getKeywordsForSection(key: string): string[] {
    return Object.entries(keywordMap)
      .filter(([, sections]) => sections.includes(key))
      .map(([k]) => k);
  }

  function getSuggestionsForSection(key: string) {
    return suggestionsBySection[key] ?? [];
  }

  function startInlineEdit(key: string) {
    setEditingInline((p) => ({ ...p, [key]: true }));
    switch (key) {
      case "header":
        setInlineEditTemp((p) => ({ ...p, header: { ...content.header } }));
        break;
      case "summary":
        setInlineEditTemp((p) => ({ ...p, summary: { text: content.summary?.text ?? "" } }));
        break;
      case "skills":
        setInlineEditTemp((p) => ({ ...p, skills: JSON.parse(JSON.stringify(content.skills)) }));
        break;
      case "experience":
        setInlineEditTemp((p) => ({ ...p, experience: JSON.parse(JSON.stringify(content.experience)) }));
        break;
      case "projects":
        setInlineEditTemp((p) => ({ ...p, projects: JSON.parse(JSON.stringify(content.projects ?? [])) }));
        break;
      case "education":
        setInlineEditTemp((p) => ({ ...p, education: JSON.parse(JSON.stringify(content.education)) }));
        break;
      case "certifications":
        setInlineEditTemp((p) => ({ ...p, certifications: JSON.parse(JSON.stringify(content.certifications ?? [])) }));
        break;
    }
  }

  function saveInlineEdit(key: string) {
    onUpdateContent(key, inlineEditTemp[key]);
    setEditingInline((p) => ({ ...p, [key]: false }));
  }

  function cancelInlineEdit(key: string) {
    setEditingInline((p) => ({ ...p, [key]: false }));
    setInlineEditTemp((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  }

  return (
    <div className="section-sidebar">
      <div className="section-sidebar-header">
        <h3 style={{ fontSize: 13, margin: 0, fontWeight: 700 }}>Sections</h3>
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
          Click a section to edit or use AI
        </p>
      </div>

      <div className="section-accordion">
        {SECTIONS.map((sec) => {
          const isActive = activeSection === sec.key;
          const keywords = getKeywordsForSection(sec.key);
          const suggestions = getSuggestionsForSection(sec.key);
          const isEditing = editingInline[sec.key];

          return (
            <div
              key={sec.key}
              className={`section-accordion-item ${isActive ? "active" : ""}`}
              onClick={() => !isEditing && onSectionClick(isActive ? null : sec.key)}
            >
              {/* Header row */}
              <div className="section-accordion-header">
                <div className="section-accordion-title">
                  <span className="section-icon">{sec.icon}</span>
                  <span>{sec.label}</span>
                  {suggestions.length > 0 && (
                    <span className="section-badge-suggestion">{suggestions.length}</span>
                  )}
                </div>
                <div className="section-accordion-meta">
                  <span className="section-stats">{getSectionStats(sec.key)}</span>
                  <span className="section-chevron">{isActive ? "▾" : "▸"}</span>
                </div>
              </div>

              {/* Expanded content */}
              {isActive && (
                <div className="section-accordion-body" onClick={(e) => e.stopPropagation()}>
                  {/* Keywords that map to this section */}
                  {keywords.length > 0 && (
                    <div className="section-keywords">
                      <p className="section-keywords-label">Mapped keywords:</p>
                      <div className="section-keywords-list">
                        {keywords.map((k) => (
                          <span key={k} className="section-keyword-tag">{k}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestions for this section */}
                  {suggestions.length > 0 && (
                    <div className="section-suggestions">
                      <p className="section-suggestions-label">{suggestions.length} suggestion(s):</p>
                      {suggestions.map((s) => (
                        <div key={s.id} className={`section-suggestion-item ${s.status}`}>
                          <span className="section-suggestion-type">{s.type}</span>
                          <span className="section-suggestion-text">{s.text}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Inline edit or AI controls */}
                  {!isEditing ? (
                    <div className="section-ai-controls">
                      <button
                        className="btn btn-compact"
                        onClick={() => startInlineEdit(sec.key)}
                        style={{ width: "100%", marginBottom: 8 }}
                      >
                        ✏️ Edit {sec.label}
                      </button>

                      <div className="section-ai-actions">
                        {(AI_ACTIONS[sec.key] ?? []).map((action) => (
                          <button
                            key={action.label}
                            className="btn btn-compact section-ai-action-btn"
                            onClick={() => onAISectionAction(sec.key, action.label, action.prompt)}
                            title={action.prompt}
                          >
                            <span>{action.icon}</span>
                            <span>{action.label}</span>
                          </button>
                        ))}
                      </div>

                      <div className="section-custom-prompt">
                        <textarea
                          rows={2}
                          placeholder={`Custom AI instruction for ${sec.label.toLowerCase()}…`}
                          value={customPrompt[sec.key] ?? ""}
                          onChange={(e) => setCustomPrompt((p) => ({ ...p, [sec.key]: e.target.value }))}
                          style={{ fontSize: 11, marginBottom: 6 }}
                        />
                        <button
                          className="btn-primary btn-compact"
                          onClick={() => {
                            if (customPrompt[sec.key]?.trim()) {
                              onAISectionAction(sec.key, "custom", customPrompt[sec.key]);
                              setCustomPrompt((p) => ({ ...p, [sec.key]: "" }));
                            }
                          }}
                          disabled={!customPrompt[sec.key]?.trim()}
                          style={{ width: "100%" }}
                        >
                          🚀 Run Custom Prompt
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="section-inline-edit">
                      {sec.key === "header" && (
                        <div className="field-group" style={{ display: "grid", gap: 6 }}>
                          <input
                            value={inlineEditTemp.header?.fullName ?? ""}
                            onChange={(e) => setInlineEditTemp((p) => ({ ...p, header: { ...p.header, fullName: e.target.value } }))}
                            placeholder="Full name"
                          />
                          <input
                            value={inlineEditTemp.header?.email ?? ""}
                            onChange={(e) => setInlineEditTemp((p) => ({ ...p, header: { ...p.header, email: e.target.value } }))}
                            placeholder="Email"
                          />
                          <input
                            value={inlineEditTemp.header?.phone ?? ""}
                            onChange={(e) => setInlineEditTemp((p) => ({ ...p, header: { ...p.header, phone: e.target.value } }))}
                            placeholder="Phone"
                          />
                          <input
                            value={inlineEditTemp.header?.location ?? ""}
                            onChange={(e) => setInlineEditTemp((p) => ({ ...p, header: { ...p.header, location: e.target.value } }))}
                            placeholder="Location"
                          />
                          <input
                            value={inlineEditTemp.header?.linkedin ?? ""}
                            onChange={(e) => setInlineEditTemp((p) => ({ ...p, header: { ...p.header, linkedin: e.target.value } }))}
                            placeholder="LinkedIn"
                          />
                        </div>
                      )}

                      {sec.key === "summary" && (
                        <textarea
                          rows={4}
                          value={inlineEditTemp.summary?.text ?? ""}
                          onChange={(e) => setInlineEditTemp((p) => ({ ...p, summary: { text: e.target.value } }))}
                          placeholder="Professional summary…"
                        />
                      )}

                      {sec.key === "skills" && (
                        <div>
                          {(inlineEditTemp.skills ?? []).map((group: any, idx: number) => (
                            <div key={group.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                              <input
                                value={group.title}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.skills];
                                  next[idx] = { ...group, title: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, skills: next }));
                                }}
                                placeholder="Category"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={group.skills.join(", ")}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.skills];
                                  next[idx] = { ...group, skills: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) };
                                  setInlineEditTemp((p) => ({ ...p, skills: next }));
                                }}
                                placeholder="Comma-separated skills"
                              />
                              <button
                                className="btn-danger btn-compact"
                                style={{ marginTop: 4 }}
                                onClick={() => {
                                  const next = inlineEditTemp.skills.filter((_: any, i: number) => i !== idx);
                                  setInlineEditTemp((p) => ({ ...p, skills: next }));
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn btn-compact"
                            onClick={() => {
                              const next = [...(inlineEditTemp.skills ?? []), { id: uid(), title: "", skills: [] }];
                              setInlineEditTemp((p) => ({ ...p, skills: next }));
                            }}
                          >
                            + Add group
                          </button>
                        </div>
                      )}

                      {sec.key === "experience" && (
                        <div>
                          {(inlineEditTemp.experience ?? []).map((exp: any, idx: number) => (
                            <div key={exp.id} style={{ marginBottom: 10, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                              <input
                                value={exp.title}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.experience];
                                  next[idx] = { ...exp, title: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, experience: next }));
                                }}
                                placeholder="Job title"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={exp.company}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.experience];
                                  next[idx] = { ...exp, company: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, experience: next }));
                                }}
                                placeholder="Company"
                                style={{ marginBottom: 4 }}
                              />
                              <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                                <input
                                  value={exp.startDate}
                                  onChange={(e) => {
                                    const next = [...inlineEditTemp.experience];
                                    next[idx] = { ...exp, startDate: e.target.value };
                                    setInlineEditTemp((p) => ({ ...p, experience: next }));
                                  }}
                                  placeholder="Start date"
                                />
                                <input
                                  value={exp.endDate ?? ""}
                                  onChange={(e) => {
                                    const next = [...inlineEditTemp.experience];
                                    next[idx] = { ...exp, endDate: e.target.value || undefined };
                                    setInlineEditTemp((p) => ({ ...p, experience: next }));
                                  }}
                                  placeholder="End date"
                                />
                              </div>
                              {(exp.bullets ?? []).map((b: any, bIdx: number) => (
                                <div key={b.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                                  <input
                                    style={{ flex: 1 }}
                                    value={b.text}
                                    onChange={(e) => {
                                      const next = [...inlineEditTemp.experience];
                                      const bullets = [...exp.bullets];
                                      bullets[bIdx] = { ...b, text: e.target.value };
                                      next[idx] = { ...exp, bullets };
                                      setInlineEditTemp((p) => ({ ...p, experience: next }));
                                    }}
                                    placeholder="Bullet point"
                                  />
                                  <button
                                    className="btn-danger btn-compact"
                                    onClick={() => {
                                      const next = [...inlineEditTemp.experience];
                                      const bullets = exp.bullets.filter((_: any, i: number) => i !== bIdx);
                                      next[idx] = { ...exp, bullets };
                                      setInlineEditTemp((p) => ({ ...p, experience: next }));
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                className="btn btn-compact"
                                onClick={() => {
                                  const next = [...inlineEditTemp.experience];
                                  const bullets = [...exp.bullets, { id: uid(), text: "" }];
                                  next[idx] = { ...exp, bullets };
                                  setInlineEditTemp((p) => ({ ...p, experience: next }));
                                }}
                              >
                                + Bullet
                              </button>
                              <button
                                className="btn-danger btn-compact"
                                style={{ marginLeft: 8 }}
                                onClick={() => {
                                  const next = inlineEditTemp.experience.filter((_: any, i: number) => i !== idx);
                                  setInlineEditTemp((p) => ({ ...p, experience: next }));
                                }}
                              >
                                Remove job
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn btn-compact"
                            onClick={() => {
                              const next = [...(inlineEditTemp.experience ?? []), { id: uid(), title: "", company: "", startDate: "", bullets: [] }];
                              setInlineEditTemp((p) => ({ ...p, experience: next }));
                            }}
                          >
                            + Add job
                          </button>
                        </div>
                      )}

                      {sec.key === "education" && (
                        <div>
                          {(inlineEditTemp.education ?? []).map((edu: any, idx: number) => (
                            <div key={edu.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                              <input
                                value={edu.degree}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.education];
                                  next[idx] = { ...edu, degree: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, education: next }));
                                }}
                                placeholder="Degree"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={edu.school}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.education];
                                  next[idx] = { ...edu, school: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, education: next }));
                                }}
                                placeholder="School"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={edu.graduationDate ?? ""}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.education];
                                  next[idx] = { ...edu, graduationDate: e.target.value || undefined };
                                  setInlineEditTemp((p) => ({ ...p, education: next }));
                                }}
                                placeholder="Graduation date"
                              />
                              <button
                                className="btn-danger btn-compact"
                                style={{ marginTop: 4 }}
                                onClick={() => {
                                  const next = inlineEditTemp.education.filter((_: any, i: number) => i !== idx);
                                  setInlineEditTemp((p) => ({ ...p, education: next }));
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn btn-compact"
                            onClick={() => {
                              const next = [...(inlineEditTemp.education ?? []), { id: uid(), degree: "", school: "" }];
                              setInlineEditTemp((p) => ({ ...p, education: next }));
                            }}
                          >
                            + Add degree
                          </button>
                        </div>
                      )}

                      {sec.key === "certifications" && (
                        <div>
                          {(inlineEditTemp.certifications ?? []).map((cert: any, idx: number) => (
                            <div key={cert.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                              <input
                                value={cert.name}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.certifications];
                                  next[idx] = { ...cert, name: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, certifications: next }));
                                }}
                                placeholder="Certification name"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={cert.issuer ?? ""}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.certifications];
                                  next[idx] = { ...cert, issuer: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, certifications: next }));
                                }}
                                placeholder="Issuer"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={cert.date ?? ""}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.certifications];
                                  next[idx] = { ...cert, date: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, certifications: next }));
                                }}
                                placeholder="Date"
                              />
                              <button
                                className="btn-danger btn-compact"
                                style={{ marginTop: 4 }}
                                onClick={() => {
                                  const next = inlineEditTemp.certifications.filter((_: any, i: number) => i !== idx);
                                  setInlineEditTemp((p) => ({ ...p, certifications: next }));
                                }}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn btn-compact"
                            onClick={() => {
                              const next = [...(inlineEditTemp.certifications ?? []), { id: uid(), name: "" }];
                              setInlineEditTemp((p) => ({ ...p, certifications: next }));
                            }}
                          >
                            + Add certification
                          </button>
                        </div>
                      )}

                      {sec.key === "projects" && (
                        <div>
                          {(inlineEditTemp.projects ?? []).map((proj: any, idx: number) => (
                            <div key={proj.id} style={{ marginBottom: 8, padding: 8, border: "1px solid var(--border)", borderRadius: 6 }}>
                              <input
                                value={proj.title}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.projects];
                                  next[idx] = { ...proj, title: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, projects: next }));
                                }}
                                placeholder="Project title"
                                style={{ marginBottom: 4 }}
                              />
                              <input
                                value={proj.description ?? ""}
                                onChange={(e) => {
                                  const next = [...inlineEditTemp.projects];
                                  next[idx] = { ...proj, description: e.target.value };
                                  setInlineEditTemp((p) => ({ ...p, projects: next }));
                                }}
                                placeholder="Description"
                                style={{ marginBottom: 4 }}
                              />
                              {(proj.bullets ?? []).map((b: any, bIdx: number) => (
                                <div key={b.id} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                                  <input
                                    style={{ flex: 1 }}
                                    value={b.text}
                                    onChange={(e) => {
                                      const next = [...inlineEditTemp.projects];
                                      const bullets = [...proj.bullets];
                                      bullets[bIdx] = { ...b, text: e.target.value };
                                      next[idx] = { ...proj, bullets };
                                      setInlineEditTemp((p) => ({ ...p, projects: next }));
                                    }}
                                    placeholder="Bullet point"
                                  />
                                  <button
                                    className="btn-danger btn-compact"
                                    onClick={() => {
                                      const next = [...inlineEditTemp.projects];
                                      const bullets = proj.bullets.filter((_: any, i: number) => i !== bIdx);
                                      next[idx] = { ...proj, bullets };
                                      setInlineEditTemp((p) => ({ ...p, projects: next }));
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                              <button
                                className="btn btn-compact"
                                onClick={() => {
                                  const next = [...inlineEditTemp.projects];
                                  const bullets = [...proj.bullets, { id: uid(), text: "" }];
                                  next[idx] = { ...proj, bullets };
                                  setInlineEditTemp((p) => ({ ...p, projects: next }));
                                }}
                              >
                                + Bullet
                              </button>
                              <button
                                className="btn-danger btn-compact"
                                style={{ marginLeft: 8 }}
                                onClick={() => {
                                  const next = inlineEditTemp.projects.filter((_: any, i: number) => i !== idx);
                                  setInlineEditTemp((p) => ({ ...p, projects: next }));
                                }}
                              >
                                Remove project
                              </button>
                            </div>
                          ))}
                          <button
                            className="btn btn-compact"
                            onClick={() => {
                              const next = [...(inlineEditTemp.projects ?? []), { id: uid(), title: "", bullets: [] }];
                              setInlineEditTemp((p) => ({ ...p, projects: next }));
                            }}
                          >
                            + Add project
                          </button>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button className="btn-primary btn-compact" onClick={() => saveInlineEdit(sec.key)}>
                          Save
                        </button>
                        <button className="btn btn-compact" onClick={() => cancelInlineEdit(sec.key)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .section-sidebar {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .section-sidebar-header {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
        }
        .section-accordion {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }
        .section-accordion-item {
          border-radius: 6px;
          margin-bottom: 4px;
          border: 1px solid var(--border);
          background: var(--surface);
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.15s ease;
        }
        .section-accordion-item:hover {
          border-color: var(--accent);
        }
        .section-accordion-item.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-soft);
        }
        .section-accordion-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
        }
        .section-accordion-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
        }
        .section-icon {
          font-size: 14px;
        }
        .section-badge-suggestion {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 999px;
          background: var(--warn);
          color: white;
          font-size: 10px;
          font-weight: 700;
        }
        .section-accordion-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section-stats {
          font-size: 11px;
          color: var(--ink-soft);
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .section-chevron {
          font-size: 10px;
          color: var(--ink-soft);
        }
        .section-accordion-body {
          padding: 0 12px 12px;
          border-top: 1px solid var(--border);
        }
        .section-keywords {
          margin: 8px 0;
        }
        .section-keywords-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--accent);
          margin: 0 0 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .section-keywords-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .section-keyword-tag {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 100px;
          background: var(--accent-soft);
          color: var(--accent);
          font-weight: 600;
        }
        .section-suggestions {
          margin: 8px 0;
          padding: 8px;
          background: #fffbeb;
          border-radius: 6px;
          border: 1px solid #fde68a;
        }
        .section-suggestions-label {
          font-size: 10px;
          font-weight: 600;
          color: var(--warn);
          margin: 0 0 6px;
        }
        .section-suggestion-item {
          font-size: 11px;
          margin-bottom: 4px;
          padding: 4px 6px;
          border-radius: 4px;
          background: white;
        }
        .section-suggestion-type {
          display: inline-block;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 1px 4px;
          border-radius: 3px;
          background: var(--accent-soft);
          color: var(--accent);
          margin-right: 4px;
        }
        .section-suggestion-text {
          color: var(--ink);
        }
        .section-ai-controls {
          margin-top: 8px;
        }
        .section-ai-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 8px;
        }
        .section-ai-action-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          padding: 5px 8px;
          flex: 1;
          min-width: 100px;
          justify-content: center;
        }
        .section-custom-prompt {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed var(--border);
        }
        .section-inline-edit {
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}
