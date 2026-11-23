"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  APPLICATION_FACT_DISPOSITIONS,
  APPLICATION_FACT_KINDS,
  APPLICATION_FACT_PROFILE_FIELDS,
  APPLICATION_PROFILE_NOTES_SECTION,
  applicationQuestionKey,
  formatApplicationFactValue,
  normalizeApplicationQuestion,
  profileMatchesApplicationFact,
  resolveApplicationFacts,
  type ApplicationFactDisposition,
  type ApplicationFactProfile,
  type ApplicationFactProfileField,
  type ApplicationFactSource,
  type ApplicationFactValueKind,
  type CandidateApplicationFact,
} from "@/lib/candidateApplicationFacts";
import { CandidateProfileNotes } from "./CandidateProfileNotes";
import { CandidateSectionPagination } from "./CandidateSectionPagination";
import styles from "./CandidateApplicationFactsPanel.module.css";

interface Props {
  candidateId: string;
  canManage: boolean;
  profile: ApplicationFactProfile;
  hasPrimaryResume: boolean;
  jobs: { id: string; title: string; company: string | null }[];
}

interface FactForm {
  section: string;
  question: string;
  disposition: ApplicationFactDisposition;
  valueKind: ApplicationFactValueKind;
  value: string;
  sourceKind: ApplicationFactSource;
  sourceRef: string;
  expiryDate: string;
}

interface MissingQuestion {
  question: string;
  jobId: string;
  jobTitle?: string;
  detectedAt: string;
}

const emptyForm: FactForm = {
  section: "Screening", question: "", disposition: "known", valueKind: "text",
  value: "", sourceKind: "document", sourceRef: "", expiryDate: "",
};
const sourceNames: Record<ApplicationFactSource, string> = {
  profile: "Candidate profile", candidate_attested: "Candidate attestation", document: "Document",
};
const kindNames: Record<ApplicationFactValueKind, string> = {
  text: "Text", boolean: "Yes or No", integer: "Whole number", decimal: "Decimal number",
  date: "Date", option: "Exact option label",
};

export function CandidateApplicationFactsPanel({
  candidateId, canManage, profile, hasPrimaryResume, jobs,
}: Props) {
  const endpoint = `/api/candidates/${encodeURIComponent(candidateId)}/application-facts`;
  const [facts, setFacts] = useState<CandidateApplicationFact[]>([]);
  const [missingQuestions, setMissingQuestions] = useState<MissingQuestion[]>([]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FactForm | null>(null);
  const [editing, setEditing] = useState<CandidateApplicationFact | null>(null);
  const [answeringMissingQuestion, setAnsweringMissingQuestion] = useState(false);
  const [search, setSearch] = useState("");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [notice, setNotice] = useState("");
  const [answerPage, setAnswerPage] = useState(1);
  const [answerPageSize, setAnswerPageSize] = useState(6);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(6);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const addAnswerButton = useRef<HTMLButtonElement>(null);
  const hasLoaded = useRef(false);
  const id = useId();
  const isFormOpen = Boolean(form);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setLoading(!hasLoaded.current);
    setError("");
    void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load application answers.");
        if (controller.signal.aborted) return;
        setFacts(body.facts);
        const pending = new Map<string, MissingQuestion>();
        const observed: MissingQuestion[] = Array.isArray(body.missingQuestions) ? body.missingQuestions : [];
        for (const question of [...observed].sort((left, right) => Date.parse(right.detectedAt) - Date.parse(left.detectedAt))) {
          if (typeof question.question !== "string") continue;
          const key = applicationQuestionKey(question.question);
          if (key && !pending.has(key)) pending.set(key, question);
        }
        setMissingQuestions([...pending.values()]);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load application answers.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          hasLoaded.current = true;
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [canManage, endpoint, refreshVersion]);

  useEffect(() => {
    if (isFormOpen && !loading) formHeading.current?.focus();
  }, [isFormOpen, editing?.id, loading]);

  const searchKey = normalizeApplicationQuestion(search);
  const notes = facts.filter((fact) => fact.section === APPLICATION_PROFILE_NOTES_SECTION);
  const answers = facts.filter((fact) => fact.section !== APPLICATION_PROFILE_NOTES_SECTION);
  const removedCount = answers.filter((fact) => fact.reviewState === "revoked").length;
  const answerCount = answers.length - removedCount;
  const noteCount = notes.filter((note) => note.reviewState !== "revoked").length;
  const matches = answers.filter((fact) =>
    (includeRemoved || fact.reviewState !== "revoked") &&
    normalizeApplicationQuestion([fact.section, fact.question, fact.value === null ? "" : formatApplicationFactValue(fact.value)].join(" "))
      .includes(searchKey),
  ).sort((left, right) => left.section.localeCompare(right.section) || left.question.localeCompare(right.question));
  const visibleAnswerPage = Math.min(answerPage, Math.max(1, Math.ceil(matches.length / answerPageSize)));
  const visiblePendingPage = Math.min(pendingPage, Math.max(1, Math.ceil(missingQuestions.length / pendingPageSize)));
  const pageAnswers = matches.slice((visibleAnswerPage - 1) * answerPageSize, visibleAnswerPage * answerPageSize);
  const pageQuestions = missingQuestions.slice((visiblePendingPage - 1) * pendingPageSize, visiblePendingPage * pendingPageSize);
  useEffect(() => { setAnswerPage(visibleAnswerPage); }, [visibleAnswerPage]);
  useEffect(() => { setPendingPage(visiblePendingPage); }, [visiblePendingPage]);
  const sections = new Map<string, CandidateApplicationFact[]>();
  for (const fact of pageAnswers) {
    const sectionFacts = sections.get(fact.section);
    if (sectionFacts) sectionFacts.push(fact);
    else sections.set(fact.section, [fact]);
  }
  const conflictingQuestions = new Set(resolveApplicationFacts(answers, candidateId, "", profile).blocked
    .filter((blocked) => blocked.reason === "conflict").map((blocked) => applicationQuestionKey(blocked.question)));
  const conflict = (fact: CandidateApplicationFact) =>
    fact.reviewState !== "revoked" && conflictingQuestions.has(applicationQuestionKey(fact.question));

  function update<K extends keyof FactForm>(key: K, value: FactForm[K]) {
    setForm((current) => current && ({ ...current, [key]: value }));
  }

  function edit(fact: CandidateApplicationFact) {
    setEditing(fact);
    setAnsweringMissingQuestion(false);
    setForm({
      section: fact.section, question: fact.question,
      disposition: fact.disposition, valueKind: fact.valueKind, value: fact.value === null ? "" : String(fact.value),
      sourceKind: fact.sourceKind, sourceRef: fact.sourceRef, expiryDate: fact.expiresAt?.slice(0, 10) ?? "",
    });
    setError("");
    setNotice("");
  }

  function addDraft(question?: MissingQuestion) {
    setEditing(null);
    setAnsweringMissingQuestion(Boolean(question));
    setForm(question ? { ...emptyForm, question: question.question } : { ...emptyForm });
    setError("");
    setNotice("");
  }

  function closeDraft() {
    setForm(null);
    setEditing(null);
    setAnsweringMissingQuestion(false);
    requestAnimationFrame(() => addAnswerButton.current?.focus());
  }

  async function write(method: "POST" | "PATCH", body: object): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the answer.");
      const saved: CandidateApplicationFact = result.fact;
      setFacts((current) => [...current.filter((fact) => fact.id !== saved.id), saved]);
      if (saved.section === APPLICATION_PROFILE_NOTES_SECTION) {
        setNotice(saved.reviewState === "revoked" ? "Profile note removed." : "Profile note saved.");
      } else {
        setNotice(saved.reviewState === "revoked" ? "Answer removed." :
          saved.reviewState === "approved" ? "Answer approved." : "Draft saved.");
        setRefreshVersion((current) => current + 1);
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the answer.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || busy) return;
    const sourceProfile = form.sourceKind === "profile";
    const rawValue = sourceProfile ? profile[form.sourceRef as ApplicationFactProfileField] : form.value;
    let value: unknown = null;
    if (form.disposition === "known") {
      value = rawValue;
      if (form.valueKind === "boolean") value = rawValue === "true" ? true : rawValue === "false" ? false : null;
      else if (form.valueKind === "integer" || form.valueKind === "decimal") value = rawValue?.trim() ? Number(rawValue) : null;
    }
    const draft = {
      section: form.section || "Screening", question: form.question.trim(), value, jobId: null,
      disposition: form.disposition, valueKind: form.valueKind, sourceKind: form.sourceKind,
      ...(form.sourceRef.trim() ? { sourceRef: form.sourceRef.trim() } : {}),
      expiresAt: form.expiryDate ? `${form.expiryDate}T23:59:59.999Z` : null,
    };
    if (!draft.question || draft.question.length > 400 || (draft.disposition === "known" && (
      value === null || value === undefined || (typeof value === "string" && !value.trim()) ||
      (typeof value === "number" && (!Number.isFinite(value) || (draft.valueKind === "integer" && !Number.isInteger(value))))
    ))) {
      setError("Enter a question and an answer that matches the selected value type.");
      return;
    }
    if (draft.section === APPLICATION_PROFILE_NOTES_SECTION) {
      setError("Use Add profile note to save text for staff review.");
      return;
    }
    const approve = !editing && (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "approve";
    const saved = editing
      ? await write("PATCH", { operation: "revise", factId: editing.id, expectedRevision: editing.revision, draft })
      : await write("POST", approve ? { ...draft, approve: true } : draft);
    if (saved) closeDraft();
  }

  const readiness = [
    ["Name", Boolean(profile.name?.trim())],
    ["Email", Boolean(profile.email?.trim())],
    ["Primary résumé", hasPrimaryResume],
  ] as const;
  const summary = readiness.map(([label, ready]) => `${label} ${ready ? "on file" : "missing"}`).join(" · ");

  if (!canManage) {
    return (
      <section className="card" style={{ marginBottom: 20 }}>
        <h3>Application Readiness and Answers</h3>
        <p className="muted">{summary}</p>
        <p className="muted">Managers and admins can manage application answers.</p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
        <header className={styles.panelHeader}>
          <div>
            <h2 id={`${id}-title`}>
              Application Readiness and Answers
            </h2>
            <p>Answers apply to all job applications for this candidate.</p>
          </div>
          <button type="button" className="btn-outline btn-sm" disabled={busy || loading}
            onClick={() => setRefreshVersion((current) => current + 1)}>Refresh answers</button>
        </header>
        <div className={styles.readiness} aria-label="Application readiness checks">
          {readiness.map(([label, ready]) => <span key={label} className={ready ? styles.ready : styles.missing}>
            {label}: <strong>{ready ? "On file" : "Missing"}</strong>
          </span>)}
          {!loading && <span>{answerCount} saved {answerCount === 1 ? "answer" : "answers"}</span>}
          {!loading && missingQuestions.length > 0 && <span className={styles.missing}>
            <strong>{missingQuestions.length} {missingQuestions.length === 1 ? "answer" : "answers"} needed</strong>
          </span>}
        </div>
        <div className={styles.panelBody}>
          {loading && <p className={styles.feedback} role="status">Loading application answers…</p>}
          {error && <p className={styles.feedback} role="alert">{error}</p>}
          {notice && <p className={styles.feedback} role="status">{notice}</p>}
          <div className={styles.contentGrid}>
          <section className={styles.answersSection} aria-labelledby={`${id}-answers-title`}>
            <h3 className={styles.sectionTitle} id={`${id}-answers-title`}>Questions and answers</h3>
            {!loading && !form && (
              <>
                {missingQuestions.length > 0 && (
                  <div className={styles.attention}>
                    <h4>Questions needing an approved answer</h4>
                    <p className="muted">Approve these answers before retrying the application.</p>
                    <ul className={styles.attentionList}>
                      {pageQuestions.map((question) => {
                        const key = applicationQuestionKey(question.question);
                        const existingAnswers = answers.filter((fact) => fact.reviewState !== "revoked" && applicationQuestionKey(fact.question) === key);
                        const job = jobs.find((item) => item.id === question.jobId);
                        return (
                          <li key={key} className={styles.attentionRow}>
                            <div>
                              <strong>{question.question}</strong>
                              <p className={styles.answerMeta}>
                                {job ? `Detected while preparing ${job.title}${job.company ? ` at ${job.company}` : ""}` :
                                  question.jobTitle ? `Detected while preparing ${question.jobTitle}` : "Detected during application preparation"}
                              </p>
                            </div>
                            {existingAnswers.some(conflict) ? (
                              <p className="muted">Resolve the conflicting answers below.</p>
                            ) : existingAnswers[0]?.reviewState === "draft" ? (
                              <button type="button" className="btn-outline btn-sm" disabled={busy}
                                onClick={() => edit(existingAnswers[0])}>Edit existing draft</button>
                            ) : (
                              <button type="button" className="btn-outline btn-sm" disabled={busy}
                                onClick={() => existingAnswers[0] ? edit(existingAnswers[0]) : addDraft(question)}>
                                {existingAnswers[0] ? "Edit answer" : "Add answer"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <CandidateSectionPagination page={visiblePendingPage} pageSize={pendingPageSize} total={missingQuestions.length}
                      label="Pending questions" onPageChange={setPendingPage}
                      onPageSizeChange={(size) => { setPendingPageSize(size); setPendingPage(1); }} />
                  </div>
                )}
                <div className={styles.toolbar}>
                  {answers.length > 0 && <label className={styles.searchField}>Find an answer
                    <input type="search" className="input" value={search} placeholder="Search questions or answers"
                      onChange={(event) => { setSearch(event.target.value); setAnswerPage(1); }} />
                  </label>}
                  {removedCount > 0 && <label className={styles.historyToggle}>
                    <input type="checkbox" checked={includeRemoved} onChange={(event) => { setIncludeRemoved(event.target.checked); setAnswerPage(1); }} />
                    {" "}Show removed answers ({removedCount})
                  </label>}
                  <button type="button" ref={addAnswerButton} className="btn-primary btn-sm" disabled={busy}
                    onClick={() => addDraft()}>Add custom answer</button>
                </div>
                {!matches.length && !error && <p className={styles.emptyState}>
                  {searchKey ? "No answers match your search." : "No active custom answers."}
                </p>}
                {[...sections.entries()].map(([section, sectionFacts]) => (
                  <div key={section} className={styles.answerGroup}>
                    <h4>{section}</h4>
                    <ul className={styles.answerList}>
                      {sectionFacts.map((fact) => {
                        const stale = !profileMatchesApplicationFact(fact, profile);
                        const expired = Boolean(fact.expiresAt && Date.parse(fact.expiresAt) <= Date.now());
                        const warnings = [stale && "Source profile changed", expired && "Expired", conflict(fact) && "Conflicts with another answer"].filter(Boolean);
                        return (
                          <li key={fact.id} className={styles.answerRow}>
                            <div className={styles.answerHeading}>
                              <strong>{fact.question}</strong>
                              {fact.reviewState === "approved" ? <span className="badge badge-review-approved">Approved</span> :
                                fact.reviewState === "draft" ? <span className="badge badge-review-pending">Draft</span> :
                                  <span className="badge badge-review-not_required">Removed</span>}
                            </div>
                            <p className={styles.answerText}>
                              {fact.value === null ? (fact.disposition === "declined" ? "Declined" : "Unknown") : formatApplicationFactValue(fact.value)}
                            </p>
                            {warnings.length > 0 && <p className={styles.answerMeta}>{warnings.join(" · ")}</p>}
                            <details className={styles.answerMeta}>
                              <summary>Source and review</summary>
                              <p style={{ margin: "4px 0" }}>
                                {fact.sourceKind === "document" && fact.sourceRef.startsWith("staff-entry:") ? "Staff entry in TalentOS" : sourceNames[fact.sourceKind]}: {fact.sourceRef} · Revision {fact.revision}
                                {fact.expiresAt && ` · Expires ${fact.expiresAt.slice(0, 10)} UTC`}
                                {fact.reviewedAt && ` · Reviewed ${fact.reviewedAt.slice(0, 10)}`}
                                {fact.reviewedBy && ` by ${fact.reviewedBy}`}
                              </p>
                            </details>
                            <div className={styles.rowActions}>
                              <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => edit(fact)}>
                                {fact.reviewState === "revoked" ? "Restore as draft" : "Edit answer"}
                              </button>
                              {fact.reviewState === "draft" && (
                                <button type="button" className="btn-outline btn-sm" disabled={busy || stale || expired || conflict(fact)}
                                  onClick={() => void write("PATCH", { operation: "approve", factId: fact.id, expectedRevision: fact.revision })}>
                                  Approve answer
                                </button>
                              )}
                              {fact.reviewState !== "revoked" && (
                                <button type="button" className="btn-outline btn-sm" disabled={busy}
                                  onClick={() => void write("PATCH", { operation: "revoke", factId: fact.id, expectedRevision: fact.revision })}>
                                  Remove answer
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                <CandidateSectionPagination page={visibleAnswerPage} pageSize={answerPageSize} total={matches.length}
                  label="Answers" onPageChange={setAnswerPage}
                  onPageSizeChange={(size) => { setAnswerPageSize(size); setAnswerPage(1); }} />
              </>
            )}
            {!loading && form && (
              <form className={styles.editor} onSubmit={(event) => void save(event)}>
                <h4 ref={formHeading} tabIndex={-1}>{editing ? "Edit custom answer" : "Add custom answer"}</h4>
                <p className={styles.editorHelp}>Applies to all job applications for this candidate. TalentOS records who saves and approves it.</p>
                <div className={styles.mainFields}>
                  <label className={styles.questionField}>Question
                    <textarea aria-label="Question" required maxLength={400} rows={2} readOnly={!!editing || answeringMissingQuestion}
                      value={form.question} onChange={(event) => update("question", event.target.value)} />
                  </label>
                  <label>Value type
                    <select aria-label="Value type" disabled={form.sourceKind === "profile"} value={form.valueKind}
                      onChange={(event) => setForm({ ...form, valueKind: event.target.value as ApplicationFactValueKind, value: "" })}>
                      {APPLICATION_FACT_KINDS.map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}
                    </select>
                  </label>
                  {form.disposition === "known" && (
                    <label>Answer
                      {form.sourceKind === "profile" ? (
                        <input aria-label="Answer" readOnly value={profile[form.sourceRef as ApplicationFactProfileField] ?? ""} />
                      ) : form.valueKind === "boolean" ? (
                        <select aria-label="Answer" required value={form.value} onChange={(event) => update("value", event.target.value)}>
                          <option value="">Choose Yes or No</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : form.valueKind === "text" || form.valueKind === "option" ? (
                        <textarea aria-label="Answer" required maxLength={1500} rows={3} value={form.value} onChange={(event) => update("value", event.target.value)} />
                      ) : (
                        <input aria-label="Answer" required type={form.valueKind === "date" ? "date" : "number"}
                          step={form.valueKind === "decimal" ? "any" : undefined}
                          value={form.value} onChange={(event) => update("value", event.target.value)} />
                      )}
                    </label>
                  )}
                  {form.disposition !== "known" && <p className={styles.nonAnswer} role="status">
                    {form.disposition === "declined" ? "The candidate has declined to provide this answer." : "This answer is not known yet."}
                  </p>}
                </div>
                {form.sourceKind === "profile" && <p className={styles.editorHelp}>
                  This answer uses the current {APPLICATION_FACT_PROFILE_FIELDS[form.sourceRef as ApplicationFactProfileField] ?? "candidate profile"} value.
                  {" "}Update the candidate profile to change it.
                </p>}
                <details className={styles.answerOptions}>
                  <summary>Answer status and expiry (optional)</summary>
                  <div className={styles.editorFields}>
                    <label>Answer status
                      <select aria-label="Answer status" disabled={form.sourceKind === "profile"} value={form.disposition}
                        onChange={(event) => update("disposition", event.target.value as ApplicationFactDisposition)}>
                        {APPLICATION_FACT_DISPOSITIONS.map((disposition) => <option key={disposition} value={disposition}>{disposition}</option>)}
                      </select>
                    </label>
                    <label>Expiry date (UTC, optional)
                      <input aria-label="Expiry date (UTC, optional)" type="date" value={form.expiryDate} onChange={(event) => update("expiryDate", event.target.value)} />
                    </label>
                  </div>
                </details>
                <div className={styles.editorActions}>
                  <button type="submit" className="btn-outline btn-sm" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
                  {!editing && <button type="submit" value="approve" className="btn-primary" disabled={busy}>Save and approve</button>}
                  <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={closeDraft}>Cancel</button>
                </div>
              </form>
            )}
          </section>
          <section className={styles.notesSection} aria-labelledby={`${id}-notes-title`}>
            <h3 className={styles.sectionTitle} id={`${id}-notes-title`}>Profile notes <span>{loading ? "" : noteCount}</span></h3>
            <p className={styles.editorHelp}>Staff context, separate from application answers.</p>
            {!loading && <CandidateProfileNotes notes={notes} busy={busy} write={write} />}
          </section>
          </div>
        </div>
    </section>
  );
}
