"use client";

import { useEffect, useRef, useState } from "react";
import { agreementMarkup, type AgreementRun } from "@/lib/candidateAgreementTerms";

function readEditor(root: HTMLElement) {
  const runs: AgreementRun[] = [];
  function append(text: string, bold: boolean, italic: boolean) {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold && !!last.italic === italic) last.text += text;
    else runs.push({ text, bold, italic });
  }
  function walk(node: Node, bold: boolean, italic: boolean) {
    if (node.nodeType === Node.TEXT_NODE) return append(node.textContent ?? "", bold, italic);
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") return append("\n", bold, italic);
    const block = ["DIV", "P"].includes(node.tagName);
    if (block && node.previousSibling) append("\n", false, false);
    if (block && node.childNodes.length === 1 && node.firstChild?.nodeName === "BR") return;
    node.childNodes.forEach(child => walk(child,
      bold || ["B", "STRONG"].includes(node.tagName) || node.style.fontWeight === "bold",
      italic || ["I", "EM"].includes(node.tagName) || node.style.fontStyle === "italic"));
  }
  root.childNodes.forEach(node => walk(node, false, false));
  return runs;
}

export function CandidateAgreementEditor({ candidateId }: { candidateId: string }) {
  const editor = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("Loading agreement…");
  const url = `/api/candidates/${candidateId}/contracts/terms`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const terms = await response.json();
        if (controller.signal.aborted || !editor.current) return;
        editor.current.innerHTML = agreementMarkup(terms.runs);
        setVersion(terms.version);
        setMessage("");
      } catch {
        if (!controller.signal.aborted) setMessage("Could not load agreement. Reload to try again.");
      }
    }
    void load();
    return () => controller.abort();
  }, [url]);

  async function save() {
    if (!editor.current) return;
    setSaving(true);
    try {
      const response = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, runs: readEditor(editor.current) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save agreement.");
      setVersion(result.version);
      setDirty(false);
      setMessage("Agreement saved for this candidate.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save agreement.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="candidate-contract-status-control">
    <strong id="agreement-editor-label">Candidate agreement terms</strong>
    <p className="muted">Save the terms this candidate will review and sign during signup.</p>
    <div>{(["bold", "italic"] as const).map(command =>
      <button key={command} type="button" disabled={!version || saving}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          editor.current?.focus();
          document.execCommand(command);
        }}>{command === "bold" ? "Bold" : "Italic"}</button>)}</div>
    <div ref={editor} role="textbox" aria-multiline="true" aria-labelledby="agreement-editor-label"
      contentEditable={!!version && !saving} suppressContentEditableWarning
      style={{ whiteSpace: "pre-wrap", overflowY: "auto", maxHeight: "24rem", padding: "0.75rem", border: "1px solid currentColor" }}
      onPaste={event => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }}
      onDrop={event => event.preventDefault()}
      onInput={() => { setDirty(true); setMessage("Unsaved changes"); }} />
    <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={save}>
      {saving ? "Saving…" : "Save agreement terms"}
    </button>
    <span role="status">{message}</span>
  </section>;
}
