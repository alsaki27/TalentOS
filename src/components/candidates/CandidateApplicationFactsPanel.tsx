"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronRight, ClipboardList, X } from "lucide-react";
import {
  APPLICATION_FACT_DISPOSITIONS,
  APPLICATION_FACT_KINDS,
  APPLICATION_FACT_PROFILE_FIELDS,
  APPLICATION_FACT_SOURCES,
  APPLICATION_PROFILE_NOTES_SECTION,
  formatApplicationFactValue,
  normalizeApplicationQuestion,
  parseApplicationFactDraft,
  profileMatchesApplicationFact,
  type ApplicationFactDisposition,
  type ApplicationFactProfile,
  type ApplicationFactProfileField,
  type ApplicationFactSource,
  type ApplicationFactValueKind,
  type CandidateApplicationFact,
} from "@/lib/candidateApplicationFacts";
import { CandidateProfileNotes } from "./CandidateProfileNotes";
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
  jobId: string;
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

type ReadinessTab = "answers" | "notes";

const emptyForm: FactForm = {
  section: "Screening", question: "", jobId: "", disposition: "known", valueKind: "text",
  value: "", sourceKind: "candidate_attested", sourceRef: "", expiryDate: "",
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
  const [activeTab, setActiveTab] = useState<ReadinessTab>("answers");
  const formHeading = useRef<HTMLHeadingElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogBody = useRef<HTMLDivElement>(null);
  const answersTab = useRef<HTMLButtonElement>(null);
  const notesTab = useRef<HTMLButtonElement>(null);
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
        setMissingQuestions(body.missingQuestions ?? []);
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
  const sections = new Map<string, CandidateApplicationFact[]>();
  for (const fact of matches) {
    const sectionFacts = sections.get(fact.section);
    if (sectionFacts) sectionFacts.push(fact);
    else sections.set(fact.section, [fact]);
  }
  const groups = new Map<string, number>();
  function scopeKey(record: Pick<CandidateApplicationFact, "jobId" | "question">) {
    return JSON.stringify([record.jobId, normalizeApplicationQuestion(record.question)]);
  }
  for (const fact of answers) {
    if (fact.reviewState === "revoked") continue;
    const key = scopeKey(fact);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const conflict = (fact: CandidateApplicationFact) =>
    fact.reviewState !== "revoked" && (groups.get(scopeKey(fact)) ?? 0) > 1;

  function openDialog() {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    dialogHeading.current?.focus();
  }

  function selectTab(next: ReadinessTab) {
    if (next !== activeTab && dialogBody.current) dialogBody.current.scrollTop = 0;
    setActiveTab(next);
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, current: ReadinessTab) {
    let next: ReadinessTab;
    switch (event.key) {
      case "Home": next = "answers"; break;
      case "End": next = "notes"; break;
      case "ArrowLeft":
      case "ArrowRight": next = current === "answers" ? "notes" : "answers"; break;
      default: return;
    }
    event.preventDefault();
    selectTab(next);
    (next === "answers" ? answersTab : notesTab).current?.focus();
  }

  function update<K extends keyof FactForm>(key: K, value: FactForm[K]) {
    setForm((current) => current && ({ ...current, [key]: value }));
  }

  function edit(fact: CandidateApplicationFact) {
    setEditing(fact);
    setAnsweringMissingQuestion(false);
    setForm({
      section: fact.section, question: fact.question, jobId: fact.jobId ?? "",
      disposition: fact.disposition, valueKind: fact.valueKind, value: fact.value === null ? "" : String(fact.value),
      sourceKind: fact.sourceKind, sourceRef: fact.sourceRef, expiryDate: fact.expiresAt?.slice(0, 10) ?? "",
    });
    setError("");
    setNotice("");
  }

  function addDraft(question?: MissingQuestion) {
    setEditing(null);
    setAnsweringMissingQuestion(Boolean(question));
    setForm(question ? { ...emptyForm, question: question.question, jobId: question.jobId } : { ...emptyForm });
    setError("");
    setNotice("");
  }

  function closeDraft() {
    setForm(null);
    setEditing(null);
    setAnsweringMissingQuestion(false);
    answersTab.current?.focus();
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
    const draft = parseApplicationFactDraft({
      ...form, value, jobId: form.jobId || null,
      expiresAt: form.expiryDate ? `${form.expiryDate}T23:59:59.999Z` : null,
    });
    if (!draft) {
      setError("Enter a valid question, typed answer, source reference, and expiry.");
      return;
    }
    if (draft.section === APPLICATION_PROFILE_NOTES_SECTION) {
      setError("Use Add profile note to save text for staff review.");
      return;
    }
    const saved = editing
      ? await write("PATCH", { operation: "revise", factId: editing.id, expectedRevision: editing.revision, draft })
      : await write("POST", draft);
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
    <section aria-label="Application Readiness and Answers" style={{ marginBottom: 20 }}>
      <button type="button" ref={trigger} className={styles.trigger} aria-haspopup="dialog"
        aria-controls={`${id}-dialog`} aria-labelledby={`${id}-trigger-title`} aria-describedby={`${id}-summary`}
        onClick={openDialog}>
        <span className={styles.triggerIcon}><ClipboardList size={22} aria-hidden="true" /></span>
        <span className={styles.triggerText}>
          <span className={styles.triggerTitle} id={`${id}-trigger-title`}>Application Readiness and Answers</span>
          <span className={styles.triggerSummary} id={`${id}-summary`}>
            <span>{summary}</span>
            {missingQuestions.length > 0 && <span className={styles.pendingCount}>
              {missingQuestions.length} {missingQuestions.length === 1 ? "answer" : "answers"} needed
            </span>}
          </span>
        </span>
        <ChevronRight className={styles.triggerArrow} size={20} aria-hidden="true" />
      </button>
      <dialog ref={dialog} id={`${id}-dialog`} className={styles.dialog} aria-labelledby={`${id}-title`}
        onClose={() => trigger.current?.focus()}>
        <header className={styles.dialogHeader}>
          <div>
            <h2 className={styles.dialogTitle} id={`${id}-title`} ref={dialogHeading} tabIndex={-1}>
              Application Readiness and Answers
            </h2>
            {profile.name?.trim() && <p className={styles.candidateName}>{profile.name}</p>}
          </div>
          <button type="button" className={styles.closeButton} aria-label="Close application readiness and answers"
            onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
        </header>
        <div className={styles.tabList} role="tablist" aria-label="Candidate application information">
          <button type="button" className={styles.tab} role="tab" ref={answersTab} id={`${id}-answers-tab`}
            aria-selected={activeTab === "answers"} aria-controls={`${id}-answers-panel`}
            tabIndex={activeTab === "answers" ? 0 : -1} onClick={() => selectTab("answers")}
            onKeyDown={(event) => navigateTabs(event, "answers")}>
            Questions and answers
            {!loading && <span className={styles.tabCount} aria-hidden="true">{answerCount}</span>}
          </button>
          <button type="button" className={styles.tab} role="tab" ref={notesTab} id={`${id}-notes-tab`}
            aria-selected={activeTab === "notes"} aria-controls={`${id}-notes-panel`}
            tabIndex={activeTab === "notes" ? 0 : -1} onClick={() => selectTab("notes")}
            onKeyDown={(event) => navigateTabs(event, "notes")}>
            Profile notes
            {!loading && <span className={styles.tabCount} aria-hidden="true">{noteCount}</span>}
          </button>
        </div>
        <div className={styles.dialogBody} ref={dialogBody}>
          {loading && <p className={styles.feedback} role="status">Loading application answers…</p>}
          {error && <p className={styles.feedback} role="alert">{error}</p>}
          {notice && <p className={styles.feedback} role="status">{notice}</p>}
          <section role="tabpanel" id={`${id}-answers-panel`} aria-labelledby={`${id}-answers-tab`}
            hidden={activeTab !== "answers"} tabIndex={0}>
            {!loading && !form && (
              <>
                {missingQuestions.length > 0 && (
                  <div className={styles.attention}>
                    <h4>Questions needing an approved answer</h4>
                    <p className="muted">Approve these answers before retrying the application.</p>
                    <ul className={styles.attentionList}>
                      {missingQuestions.map((question) => {
                        const key = scopeKey(question);
                        const sameScope = answers.filter((fact) => fact.reviewState !== "revoked" && scopeKey(fact) === key);
                        const job = jobs.find((item) => item.id === question.jobId);
                        return (
                          <li key={key} className={styles.attentionRow}>
                            <div>
                              <strong>{question.question}</strong>
                              <p className={styles.answerMeta}>
                                {job ? `${job.title}${job.company ? ` at ${job.company}` : ""}` : question.jobTitle || "Specific job"}
                              </p>
                            </div>
                            {sameScope.length > 1 ? (
                              <p className="muted">Resolve the conflicting answers below.</p>
                            ) : sameScope[0]?.reviewState === "draft" ? (
                              <button type="button" className="btn-outline btn-sm" disabled={busy}
                                onClick={() => edit(sameScope[0])}>Edit existing draft</button>
                            ) : (
                              <button type="button" className="btn-outline btn-sm" disabled={busy}
                                onClick={() => sameScope[0] ? edit(sameScope[0]) : addDraft(question)}>
                                {sameScope[0] ? "Edit answer" : "Add answer"}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className={styles.toolbar}>
                  {answers.length > 0 && <label className={styles.searchField}>Find an answer
                    <input type="search" className="input" value={search} placeholder="Search questions or answers"
                      onChange={(event) => setSearch(event.target.value)} />
                  </label>}
                  {removedCount > 0 && <label className={styles.historyToggle}>
                    <input type="checkbox" checked={includeRemoved} onChange={(event) => setIncludeRemoved(event.target.checked)} />
                    {" "}Show removed answers ({removedCount})
                  </label>}
                  <button type="button" className="btn-primary btn-sm" disabled={busy}
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
                        const job = jobs.find((item) => item.id === fact.jobId);
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
                            <p className={styles.answerMeta}>
                              {job ? `${job.title}${job.company ? ` at ${job.company}` : ""}` : fact.jobId ? "Specific job" : "All candidate applications"}
                              {stale && " · Source profile changed"}
                              {expired && " · Expired"}
                              {conflict(fact) && " · Conflicts with another answer in this scope"}
                            </p>
                            <details className={styles.answerMeta}>
                              <summary>Source and review</summary>
                              <p style={{ margin: "4px 0" }}>
                                {sourceNames[fact.sourceKind]}: {fact.sourceRef} · Revision {fact.revision}
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
              </>
            )}
            {!loading && form && (
              <form className={styles.editor} onSubmit={(event) => void save(event)}>
                <h4 ref={formHeading} tabIndex={-1}>{editing ? "Edit custom answer" : "Add custom answer"}</h4>
                <div className={styles.editorFields}>
                  <label>Section
                    <input required maxLength={80} value={form.section} onChange={(event) => update("section", event.target.value)} />
                  </label>
                  <label>Application question or field label
                    <textarea required maxLength={400} readOnly={!!editing || answeringMissingQuestion}
                      value={form.question} onChange={(event) => update("question", event.target.value)} />
                  </label>
                  <label>Scope
                    <select disabled={!!editing || answeringMissingQuestion} value={form.jobId} onChange={(event) => update("jobId", event.target.value)}>
                      <option value="">All candidate applications</option>
                      {form.jobId && !jobs.some((job) => job.id === form.jobId) && <option value={form.jobId}>Specific job</option>}
                      {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}{job.company ? ` at ${job.company}` : ""}</option>)}
                    </select>
                  </label>
                  <label>Source
                    <select value={form.sourceKind} onChange={(event) => {
                      const sourceKind = event.target.value as ApplicationFactSource;
                      setForm({ ...form, sourceKind, sourceRef: sourceKind === "profile" ? "name" : "",
                        ...(sourceKind === "profile" ? { valueKind: "text" as const, disposition: "known" as const } : {}) });
                    }}>
                      {APPLICATION_FACT_SOURCES.map((source) => <option key={source} value={source}>{sourceNames[source]}</option>)}
                    </select>
                  </label>
                  {form.sourceKind === "profile" ? (
                    <label>Profile field
                      <select value={form.sourceRef} onChange={(event) => update("sourceRef", event.target.value)}>
                        {Object.entries(APPLICATION_FACT_PROFILE_FIELDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label>Source reference
                      <input required maxLength={300} value={form.sourceRef} placeholder="Attestation or document record ID"
                        onChange={(event) => update("sourceRef", event.target.value)} />
                    </label>
                  )}
                  <label>Answer status
                    <select disabled={form.sourceKind === "profile"} value={form.disposition}
                      onChange={(event) => update("disposition", event.target.value as ApplicationFactDisposition)}>
                      {APPLICATION_FACT_DISPOSITIONS.map((disposition) => <option key={disposition} value={disposition}>{disposition}</option>)}
                    </select>
                  </label>
                  <label>Value type
                    <select disabled={form.sourceKind === "profile"} value={form.valueKind}
                      onChange={(event) => setForm({ ...form, valueKind: event.target.value as ApplicationFactValueKind, value: "" })}>
                      {APPLICATION_FACT_KINDS.map((kind) => <option key={kind} value={kind}>{kindNames[kind]}</option>)}
                    </select>
                  </label>
                  {form.disposition === "known" && (
                    <label>Answer
                      {form.sourceKind === "profile" ? (
                        <input readOnly value={profile[form.sourceRef as ApplicationFactProfileField] ?? ""} />
                      ) : form.valueKind === "boolean" ? (
                        <select required value={form.value} onChange={(event) => update("value", event.target.value)}>
                          <option value="">Choose Yes or No</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : form.valueKind === "text" || form.valueKind === "option" ? (
                        <textarea required maxLength={1500} value={form.value} onChange={(event) => update("value", event.target.value)} />
                      ) : (
                        <input required type={form.valueKind === "date" ? "date" : "number"}
                          step={form.valueKind === "decimal" ? "any" : undefined}
                          value={form.value} onChange={(event) => update("value", event.target.value)} />
                      )}
                    </label>
                  )}
                  <label>Expiry date (UTC, optional)
                    <input type="date" value={form.expiryDate} onChange={(event) => update("expiryDate", event.target.value)} />
                  </label>
                </div>
                <div className={styles.editorActions}>
                  <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
                  <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={closeDraft}>Cancel</button>
                </div>
              </form>
            )}
          </section>
          <section role="tabpanel" id={`${id}-notes-panel`} aria-labelledby={`${id}-notes-tab`}
            hidden={activeTab !== "notes"} tabIndex={0}>
            {!loading && <CandidateProfileNotes notes={notes} busy={busy} write={write} />}
          </section>
        </div>
      </dialog>
    </section>
  );
}
