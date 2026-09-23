"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ResumeDocument } from "@/lib/falood/types";
import {
  diffResume,
  executeCommand,
  EDITOR_COMMANDS,
  estimatePages,
  formatResume,
  isValidResume,
  pageStatus,
} from "@/lib/resumeEditorCommands";
import ResumeDiffViewer from "./ResumeDiffViewer";

// ─── Syntax highlighting (lightweight tokenizer) ───

function highlightJSON(json: string): string {
  const tokens: {
    type: "string" | "number" | "boolean" | "null" | "punctuation" | "whitespace" | "other";
    value: string;
    isKey?: boolean;
  }[] = [];

  let i = 0;
  while (i < json.length) {
    const ch = json[i];

    // Whitespace
    if (/\s/.test(ch)) {
      let j = i;
      while (j < json.length && /\s/.test(json[j])) j++;
      tokens.push({ type: "whitespace", value: json.slice(i, j) });
      i = j;
      continue;
    }

    // String
    if (ch === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') {
        if (json[j] === "\\") j += 2;
        else j++;
      }
      j++; // closing quote
      const str = json.slice(i, j);
      let k = j;
      while (k < json.length && /\s/.test(json[k])) k++;
      const isKey = json[k] === ":";
      tokens.push({ type: "string", value: str, isKey });
      i = j;
      continue;
    }

    // Number
    if (/\d/.test(ch) || (ch === "-" && /\d/.test(json[i + 1] || ""))) {
      let j = i + (ch === "-" ? 1 : 0);
      while (j < json.length && /[\d.eE+-]/.test(json[j])) j++;
      tokens.push({ type: "number", value: json.slice(i, j) });
      i = j;
      continue;
    }

    // Boolean / null
    if (json.slice(i, i + 4) === "true") {
      tokens.push({ type: "boolean", value: "true" });
      i += 4;
      continue;
    }
    if (json.slice(i, i + 5) === "false") {
      tokens.push({ type: "boolean", value: "false" });
      i += 5;
      continue;
    }
    if (json.slice(i, i + 4) === "null") {
      tokens.push({ type: "null", value: "null" });
      i += 4;
      continue;
    }

    // Punctuation
    if (/[{}\[\],:]/.test(ch)) {
      tokens.push({ type: "punctuation", value: ch });
      i++;
      continue;
    }

    // Other
    tokens.push({ type: "other", value: ch });
    i++;
  }

  let html = "";
  for (const t of tokens) {
    const escaped = t.value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    switch (t.type) {
      case "string":
        html += `<span class="${t.isKey ? "text-[#9cdcfe]" : "text-[#ce9178]"}">${escaped}</span>`;
        break;
      case "number":
        html += `<span class="text-[#b5cea8]">${escaped}</span>`;
        break;
      case "boolean":
      case "null":
        html += `<span class="text-[#569cd6]">${escaped}</span>`;
        break;
      default:
        html += escaped;
    }
  }
  return html;
}

// ─── Props ───

interface ResumeCliEditorProps {
  initialContent: ResumeDocument;
  originalContent?: ResumeDocument;
  onSave?: (content: ResumeDocument) => void;
  isSaving?: boolean;
  saveStatus?: "saving" | "saved" | "error" | "";
  title?: string;
  backLink?: string;
  pageType?: "base" | "application";
}

// ─── Component ───

export default function ResumeCliEditor({
  initialContent,
  originalContent,
  onSave,
  isSaving = false,
  saveStatus = "",
  title = "Resume Editor",
  backLink,
  pageType = "base",
}: ResumeCliEditorProps) {
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initialContent, null, 2));
  const [parsed, setParsed] = useState<ResumeDocument>(initialContent);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const lineCount = jsonText.split("\n").length;

  // Update editor when initialContent prop changes (e.g. after external load)
  useEffect(() => {
    const text = JSON.stringify(initialContent, null, 2);
    setJsonText(text);
    setParsed(initialContent);
    setHasUnsavedChanges(false);
    setError(null);
  }, [initialContent]);

  // Auto-expand textarea height whenever jsonText changes
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [jsonText]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setJsonText(newText);

    try {
      const obj = JSON.parse(newText);
      if (isValidResume(obj)) {
        setParsed(obj);
        setError(null);
        setHasUnsavedChanges(true);
      } else {
        setError("Invalid resume structure: missing required fields");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }, []);

  const syncScroll = useCallback(() => {
    if (lineNumbersRef.current && containerRef.current) {
      lineNumbersRef.current.scrollTop = containerRef.current.scrollTop;
    }
    if (preRef.current && containerRef.current) {
      preRef.current.scrollTop = containerRef.current.scrollTop;
      preRef.current.scrollLeft = containerRef.current.scrollLeft;
    }
  }, []);

  const handleFormat = useCallback(() => {
    try {
      const obj = JSON.parse(jsonText);
      const formatted = JSON.stringify(obj, null, 2);
      setJsonText(formatted);
      setError(null);
      if (isValidResume(obj)) {
        setParsed(obj);
        setHasUnsavedChanges(true);
      }
    } catch (err) {
      setError("Cannot format: " + (err instanceof Error ? err.message : "Invalid JSON"));
    }
  }, [jsonText]);

  const handleSave = useCallback(() => {
    if (!error && onSave) {
      onSave(parsed);
      setHasUnsavedChanges(false);
    }
  }, [error, onSave, parsed]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab → insert 2 spaces
      if (e.key === "Tab") {
        e.preventDefault();
        const start = e.currentTarget.selectionStart;
        const end = e.currentTarget.selectionEnd;
        const spaces = "  ";
        const newText = jsonText.substring(0, start) + spaces + jsonText.substring(end);
        setJsonText(newText);
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = start + spaces.length;
            textareaRef.current.selectionEnd = start + spaces.length;
          }
        });
        return;
      }

      // Ctrl+Shift+P → command palette
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCommandOpen(true);
        setCommandFilter("");
        requestAnimationFrame(() => {
          document.getElementById("command-palette-input")?.focus();
        });
        return;
      }

      // Ctrl+Shift+D → toggle diff
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setShowDiff((prev) => !prev);
        return;
      }

      // Ctrl+Shift+F → format
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handleFormat();
        return;
      }

      // Ctrl+S → save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
    },
    [jsonText, handleFormat, handleSave]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = e.clipboardData.getData("text");
      try {
        const parsed = JSON.parse(pasted);
        const formatted = JSON.stringify(parsed, null, 2);
        e.preventDefault();
        const start = e.currentTarget.selectionStart;
        const end = e.currentTarget.selectionEnd;
        const newText = jsonText.substring(0, start) + formatted + jsonText.substring(end);
        setJsonText(newText);
        if (isValidResume(parsed)) {
          setParsed(parsed);
          setError(null);
          setHasUnsavedChanges(true);
        }
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
            const cursorPos = start + formatted.length;
            textareaRef.current.selectionStart = cursorPos;
            textareaRef.current.selectionEnd = cursorPos;
          }
        });
      } catch {
        // Not valid JSON — let default paste happen
      }
    },
    [jsonText]
  );

  const handleCommand = useCallback(
    (cmdId: string) => {
      const cmd = EDITOR_COMMANDS.find((c) => c.id === cmdId);
      if (!cmd) return;

      if (cmd.type === "modify") {
        try {
          const result = executeCommand(cmdId, parsed);
          setJsonText(JSON.stringify(result, null, 2));
          setParsed(result);
          setHasUnsavedChanges(true);
          setError(null);
        } catch (err) {
          setError("Command failed: " + (err instanceof Error ? err.message : String(err)));
        }
      } else if (cmdId === "format") {
        handleFormat();
      } else if (cmdId === "one-page") {
        const info = pageStatus(parsed);
        setMessage(`Page estimate: ${info.label}`);
        setTimeout(() => setMessage(null), 3000);
      } else if (cmdId === "diff") {
        setShowDiff((prev) => !prev);
      } else if (cmdId === "reset" && originalContent) {
        setJsonText(JSON.stringify(originalContent, null, 2));
        setParsed(originalContent);
        setHasUnsavedChanges(false);
        setError(null);
        setMessage("Reset to original version");
        setTimeout(() => setMessage(null), 2000);
      }
      setCommandOpen(false);
    },
    [parsed, handleFormat, originalContent]
  );

  const handleCommandInput = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        setCommandOpen(false);
        return;
      }
      if (e.key === "Enter") {
        const matches = EDITOR_COMMANDS.filter(
          (c) =>
            !commandFilter ||
            c.label.toLowerCase().includes(commandFilter.toLowerCase()) ||
            c.id.includes(commandFilter)
        );
        if (matches.length > 0) {
          handleCommand(matches[0].id);
        }
        return;
      }
    },
    [commandFilter, handleCommand]
  );

  const pageInfo = pageStatus(parsed);
  const highlighted = highlightJSON(jsonText);

  const filteredCommands = EDITOR_COMMANDS.filter(
    (c) =>
      !commandFilter ||
      c.label.toLowerCase().includes(commandFilter.toLowerCase()) ||
      c.id.includes(commandFilter)
  );

  return (
    <div className="flex flex-col h-screen bg-[#1e1e1e] text-[#d4d4d4] overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {backLink && (
            <Link href={backLink} className="text-xs text-[#cccccc] hover:text-white shrink-0">
              ← Back
            </Link>
          )}
          <span className="text-sm font-medium text-white truncate">{title}</span>
          {hasUnsavedChanges && <span className="text-xs text-[#cca700] shrink-0">● Modified</span>}
          {saveStatus === "saving" && <span className="text-xs text-[#cccccc] shrink-0">Saving…</span>}
          {saveStatus === "saved" && <span className="text-xs text-[#89d185] shrink-0">Saved</span>}
          {saveStatus === "error" && <span className="text-xs text-[#f48771] shrink-0">Error</span>}
          {message && <span className="text-xs text-[#89d185] shrink-0">{message}</span>}
          {error && <span className="text-xs text-[#f48771] shrink-0 ml-2">● {error}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              showDiff
                ? "bg-[#094771] border-[#007acc] text-white"
                : "bg-[#3c3c3c] border-[#555555] text-[#cccccc] hover:bg-[#505050]"
            } ${!originalContent ? "opacity-50 cursor-not-allowed" : ""}`}
            onClick={() => originalContent && setShowDiff((prev) => !prev)}
            disabled={!originalContent}
            title="Ctrl+Shift+D"
          >
            Diff
          </button>
          <button
            className="px-2 py-1 text-xs rounded border bg-[#3c3c3c] border-[#555555] text-[#cccccc] hover:bg-[#505050] transition-colors"
            onClick={handleFormat}
            title="Ctrl+Shift+F"
          >
            Format
          </button>
          <button
            className="px-2 py-1 text-xs rounded border bg-[#0e639c] border-[#007acc] text-white hover:bg-[#1177bb] disabled:opacity-50 transition-colors"
            onClick={handleSave}
            disabled={isSaving || !!error || !hasUnsavedChanges}
            title="Ctrl+S"
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* ── Main split pane ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left pane: Editor ── */}
        <div className="flex flex-col w-[40%] border-r border-[#3c3c3c] min-w-[300px]">
          {/* Tab */}
          <div className="flex items-center px-3 py-1 bg-[#2d2d30] text-xs text-[#cccccc] border-b border-[#3c3c3c] shrink-0">
            <span className="px-2 py-0.5 bg-[#1e1e1e] border-t-2 border-[#007acc]">resume.json</span>
            <span className="ml-auto text-[#858585]">{error ? "● JSON Error" : "● JSON OK"}</span>
          </div>
          {/* Editor body */}
          <div className="flex flex-1 overflow-hidden">
            {/* Line numbers */}
            <div
              ref={lineNumbersRef}
              className="flex flex-col bg-[#1e1e1e] text-[#858585] text-right px-2 py-4 font-mono text-sm select-none border-r border-[#3c3c3c] overflow-hidden shrink-0"
              style={{ minWidth: "3rem" }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i + 1} className="leading-5">
                  {i + 1}
                </div>
              ))}
            </div>
            {/* Editor area */}
            <div className="flex-1 overflow-auto relative" ref={containerRef} onScroll={syncScroll}>
              <div className="relative min-w-full min-h-full">
                <pre
                  ref={preRef}
                  className="absolute inset-0 m-0 p-4 font-mono text-sm whitespace-pre pointer-events-none leading-5"
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
                <textarea
                  ref={textareaRef}
                  className="relative z-10 w-full min-h-full p-4 font-mono text-sm bg-transparent text-transparent caret-white resize-none border-none outline-none whitespace-pre leading-5"
                  value={jsonText}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  spellCheck={false}
                  style={{ tabSize: 2 }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Right pane: Preview / Diff ── */}
        <div className="flex flex-col w-[60%] overflow-auto bg-[#f7f7f8] min-w-[400px]">
          {showDiff && originalContent ? (
            <div className="p-6">
              <h3 className="text-sm font-semibold text-[#1a1d23] mb-4">Diff: Original → Current</h3>
              <ResumeDiffViewer original={originalContent} current={parsed} />
            </div>
          ) : (
            <div className="p-6 max-w-[800px] mx-auto w-full">
              <ResumePreview content={parsed} />
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom status bar ── */}
      <div className="flex items-center px-3 py-1 bg-[#007acc] text-white text-xs shrink-0">
        <div className="flex items-center gap-4">
          <span>{pageType === "base" ? "Base Resume" : "Application Resume"}</span>
          <span>{pageInfo.label}</span>
          <span>{lineCount} lines</span>
          <span>{estimatePages(parsed).toFixed(1)} pages</span>
          {error ? (
            <span className="text-[#f48771]">● {error}</span>
          ) : (
            <span className="text-[#89d185]">● Valid JSON</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="hover:underline" onClick={() => setCommandOpen(true)}>
            Ctrl+Shift+P
          </button>
          <span>Command Palette</span>
        </div>
      </div>

      {/* ── Command Palette Modal ── */}
      {commandOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/30">
          <div className="w-[600px] max-w-[90vw] bg-[#252526] border border-[#3c3c3c] rounded shadow-2xl overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-[#3c3c3c]">
              <input
                id="command-palette-input"
                className="w-full bg-[#3c3c3c] text-white text-sm px-3 py-2 rounded border border-[#555555] outline-none focus:border-[#007acc]"
                placeholder="Type a command (e.g., add experience, sort skills)…"
                value={commandFilter}
                onChange={(e) => setCommandFilter(e.target.value)}
                onKeyDown={handleCommandInput}
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              {filteredCommands.map((cmd) => (
                <button
                  key={cmd.id}
                  className="w-full text-left px-3 py-2 text-sm text-[#cccccc] hover:bg-[#094771] hover:text-white flex items-center justify-between transition-colors"
                  onClick={() => handleCommand(cmd.id)}
                >
                  <span>{cmd.label}</span>
                  <span className="text-xs text-[#858585]">/{cmd.id}</span>
                </button>
              ))}
              {commandFilter && filteredCommands.length === 0 && (
                <div className="px-3 py-2 text-sm text-[#858585]">No commands found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resume Preview subcomponent ───

function ResumePreview({ content }: { content: ResumeDocument }) {
  return (
    <div className="bg-white border border-[#e2e4e8] rounded-lg p-8 shadow-sm">
      {/* Header */}
      <div className="text-center mb-4">
        <h2 className="text-xl font-bold text-[#1a1d23] mb-1">{content.header.fullName}</h2>
        <p className="text-sm text-[#5a5f6b]">
          {[
            content.header.location,
            content.header.phone,
            content.header.email,
            content.header.linkedin,
            content.header.github,
            content.header.portfolio,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      {/* Summary */}
      {content.summary?.text && (
        <div className="mb-4">
          <p className="text-sm text-[#1a1d23] leading-relaxed">{content.summary.text}</p>
        </div>
      )}

      {/* Skills */}
      {content.skills.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[#1a1d23] mb-2 border-b border-[#e2e4e8] pb-1">
            Technical Skills
          </h4>
          {content.skills.map((s) => (
            <p key={s.id} className="text-xs text-[#1a1d23] my-1">
              <strong>{s.title}:</strong> {s.skills.join(", ")}
            </p>
          ))}
        </div>
      )}

      {/* Experience */}
      {content.experience.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[#1a1d23] mb-2 border-b border-[#e2e4e8] pb-1">
            Professional Experience
          </h4>
          {content.experience.map((exp) => (
            <div key={exp.id} className="mb-3">
              <p className="text-sm font-semibold text-[#1a1d23]">
                {exp.title} — {exp.company} {exp.location ? `(${exp.location})` : ""}
              </p>
              <p className="text-xs text-[#5a5f6b]">
                {exp.startDate} – {exp.endDate ?? "Present"}
              </p>
              <ul className="text-xs text-[#1a1d23] mt-1 pl-4 list-disc">
                {exp.bullets.map((b) => (
                  <li key={b.id}>{b.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Projects */}
      {(content.projects ?? []).length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[#1a1d23] mb-2 border-b border-[#e2e4e8] pb-1">
            Projects
          </h4>
          {(content.projects ?? []).map((proj) => (
            <div key={proj.id} className="mb-2">
              <p className="text-sm font-semibold text-[#1a1d23]">{proj.name}</p>
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
          ))}
        </div>
      )}

      {/* Education */}
      {content.education.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[#1a1d23] mb-2 border-b border-[#e2e4e8] pb-1">
            Education
          </h4>
          {content.education.map((edu) => (
            <p key={edu.id} className="text-xs text-[#1a1d23] my-1">
              {edu.degree} — {edu.school} {edu.graduationDate ? `(${edu.graduationDate})` : ""}
            </p>
          ))}
        </div>
      )}

      {/* Certifications */}
      {(content.certifications ?? []).length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-semibold text-[#1a1d23] mb-2 border-b border-[#e2e4e8] pb-1">
            Certifications
          </h4>
          {(content.certifications ?? []).map((cert) => (
            <p key={cert.id} className="text-xs text-[#1a1d23] my-1">
              {cert.name} {cert.issuer ? `— ${cert.issuer}` : ""} {cert.date ? `(${cert.date})` : ""}
            </p>
          ))}
        </div>
      )}

      {/* Custom Sections */}
      {(content.customSections ?? []).length > 0 && (
        <div className="mb-4">
          {(content.customSections ?? []).map((section) => (
            <div key={section.id} className="mb-3">
              <h4 className="text-sm font-semibold text-[#1a1d23] mb-2 border-b border-[#e2e4e8] pb-1">
                {section.title}
              </h4>
              <ul className="text-xs text-[#1a1d23] pl-4 list-disc">
                {section.bullets.map((b) => (
                  <li key={b.id}>{b.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Formatting footer */}
      <div className="mt-6 pt-4 border-t border-[#e2e4e8] text-[10px] text-[#5a5f6b]">
        Style: {content.formatting.styleId} · Font: {content.formatting.fontFamily} · Size: {content.formatting.fontSize}pt · Page: {content.formatting.pageFormat}
      </div>
    </div>
  );
}
