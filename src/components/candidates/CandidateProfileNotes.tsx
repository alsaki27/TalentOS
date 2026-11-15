"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  APPLICATION_PROFILE_NOTES_SECTION,
  normalizeApplicationQuestion,
  parseApplicationFactDraft,
  type CandidateApplicationFact,
} from "@/lib/candidateApplicationFacts";
import styles from "./CandidateApplicationFactsPanel.module.css";

interface Props {
  notes: CandidateApplicationFact[];
  busy: boolean;
  write: (method: "POST" | "PATCH", body: object) => Promise<boolean>;
}

interface NoteForm {
  title: string;
  text: string;
  sourceRef: string;
  original: CandidateApplicationFact | null;
}

export function CandidateProfileNotes({ notes, busy, write }: Props) {
  const [form, setForm] = useState<NoteForm | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const formHeading = useRef<HTMLHeadingElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const isFormOpen = Boolean(form);
  const removedCount = notes.filter((note) => note.reviewState === "revoked").length;
  const searchKey = normalizeApplicationQuestion(search);
  const visibleNotes = notes.filter((note) => (showRemoved || note.reviewState !== "revoked") &&
    normalizeApplicationQuestion([note.question, note.value, note.sourceRef].join(" ")).includes(searchKey))
    .sort((left, right) => left.question.localeCompare(right.question, undefined, { numeric: true }));

  useEffect(() => {
    if (isFormOpen) formHeading.current?.focus();
  }, [isFormOpen]);

  function openNote(original: CandidateApplicationFact | null = null) {
    setError("");
    setForm({
      title: original?.question ?? "",
      text: typeof original?.value === "string" ? original.value : "",
      sourceRef: original?.sourceRef ?? "Staff profile note",
      original,
    });
  }

  function closeNote() {
    setForm(null);
    requestAnimationFrame(() => addButton.current?.focus());
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || busy) return;
    setError("");
    const draft = parseApplicationFactDraft({
      section: APPLICATION_PROFILE_NOTES_SECTION,
      question: form.title,
      jobId: null,
      disposition: "known",
      valueKind: "text",
      value: form.text,
      sourceKind: "document",
      sourceRef: form.sourceRef,
    });
    if (!draft) {
      setError("Enter a title, note, and source before saving.");
      return;
    }
    const title = normalizeApplicationQuestion(draft.question);
    const hasActiveTitle = notes.some((note) => note.id !== form.original?.id && note.reviewState !== "revoked" &&
      normalizeApplicationQuestion(note.question) === title);
    if (hasActiveTitle) {
      setError("A profile note already has this title. Edit the existing note or choose a different title.");
      return;
    }
    const saved = form.original
      ? await write("PATCH", { operation: "revise", factId: form.original.id, expectedRevision: form.original.revision, draft })
      : await write("POST", draft);
    if (saved) closeNote();
  }

  return (
    <div>
      {!isFormOpen && <div className={styles.toolbar}>
        {notes.length > 0 && <label className={styles.searchField}>Find a note
          <input type="search" className="input" placeholder="Search notes" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </label>}
        {removedCount > 0 && <label className={styles.historyToggle}>
          <input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />
          {" "}Show removed notes ({removedCount})
        </label>}
        <button type="button" ref={addButton} className="btn-primary btn-sm" disabled={busy} onClick={() => openNote()}>
          Add profile note
        </button>
      </div>}
      {form && <form className={styles.editor} onSubmit={(event) => void saveNote(event)}>
        <h4 ref={formHeading} tabIndex={-1}>{form.original ? "Edit profile note" : "Add profile note"}</h4>
        {error && <p className={styles.feedback} role="alert">{error}</p>}
        <div className={styles.noteFields}>
          <label>Title
            <input className="input" required maxLength={400} readOnly={!!form.original} value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>Note
            <textarea className="input" required rows={8} maxLength={1500} value={form.text}
              onChange={(event) => setForm({ ...form, text: event.target.value })} />
          </label>
          <label>Source
            <input className="input" required maxLength={300} value={form.sourceRef}
              onChange={(event) => setForm({ ...form, sourceRef: event.target.value })} />
          </label>
        </div>
        <div className={styles.editorActions}>
          <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? "Saving…" : "Save note"}</button>
          <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={closeNote}>Cancel</button>
        </div>
      </form>}
      {!isFormOpen && !visibleNotes.length && <p className={styles.emptyState}>
        {searchKey ? "No notes match your search." : "No active profile notes."}
      </p>}
      {!isFormOpen && visibleNotes.length > 0 && <ul className={styles.answerList}>
        {visibleNotes.map((note) => <li key={note.id} className={styles.answerRow}>
          <div className={styles.answerHeading}>
            <strong>{note.question}</strong>
            {note.reviewState === "revoked" && <span className="badge badge-review-not_required">Removed</span>}
          </div>
          <p className={styles.answerText}>{note.value}</p>
          <p className={styles.answerMeta}>{note.sourceRef}</p>
          <div className={styles.rowActions}>
            <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => openNote(note)}>
              {note.reviewState === "revoked" ? "Restore note" : "Edit note"}
            </button>
            {note.reviewState !== "revoked" && <button type="button" className="btn-outline btn-sm" disabled={busy}
              onClick={() => void write("PATCH", { operation: "revoke", factId: note.id, expectedRevision: note.revision })}>
              Remove note
            </button>}
          </div>
        </li>)}
      </ul>}
    </div>
  );
}
