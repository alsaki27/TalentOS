"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  APPLICATION_FACT_DISPOSITIONS,
  APPLICATION_FACT_KINDS,
  APPLICATION_FACT_PROFILE_FIELDS,
  APPLICATION_FACT_SOURCES,
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

const emptyForm: FactForm = {
  section: "Screening", question: "", jobId: "", disposition: "known", valueKind: "text",
  value: "", sourceKind: "candidate_attested", sourceRef: "", expiryDate: "",
};
const sourceNames: Record<ApplicationFactSource, string> = {
  profile: "Candidate profile", candidate_attested: "Candidate attestation", document: "Reviewed document",
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

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setLoading(true);
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
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canManage, endpoint, refreshVersion]);

  const sorted = [...facts].sort((left, right) =>
    left.section.localeCompare(right.section) || left.question.localeCompare(right.question),
  );
  const sections = [...new Set(sorted.map((fact) => fact.section))];
  const groups = new Map<string, number>();
  function scopeKey(record: Pick<CandidateApplicationFact, "jobId" | "question">) {
    return JSON.stringify([record.jobId, normalizeApplicationQuestion(record.question)]);
  }
  for (const fact of facts) {
    if (fact.reviewState === "revoked") continue;
    const key = scopeKey(fact);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const conflict = (fact: CandidateApplicationFact) =>
    fact.reviewState !== "revoked" && (groups.get(scopeKey(fact)) ?? 0) > 1;

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
  }

  function addDraft(question?: MissingQuestion) {
    setEditing(null);
    setAnsweringMissingQuestion(Boolean(question));
    setForm(question ? { ...emptyForm, question: question.question, jobId: question.jobId } : { ...emptyForm });
    setError("");
  }

  function closeDraft() {
    setForm(null);
    setEditing(null);
    setAnsweringMissingQuestion(false);
  }

  async function write(method: "POST" | "PATCH", body: object): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save the answer.");
      const saved: CandidateApplicationFact = result.fact;
      setFacts((current) => [...current.filter((fact) => fact.id !== saved.id), saved]);
      setRefreshVersion((current) => current + 1);
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
    const saved = editing
      ? await write("PATCH", { operation: "revise", factId: editing.id, expectedRevision: editing.revision, draft })
      : await write("POST", draft);
    if (saved) closeDraft();
  }

  return (
    <section className="card" aria-label="Application Readiness and Answers" style={{ marginBottom: 20 }}>
      <h3>Application Readiness and Answers</h3>
      <p className="muted">
        Name {profile.name?.trim() ? "on file" : "missing"} · Email {profile.email?.trim() ? "on file" : "missing"} ·
        {" "}Primary résumé {hasPrimaryResume ? "on file" : "missing"}
      </p>
      <p className="muted">Review answers before the browser worker can use them. Approval covers the answer and its scope.</p>
      {!canManage && <p className="muted">Managers and admins can manage application answers.</p>}
      {canManage && loading && <p role="status">Loading application answers…</p>}
      {canManage && error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {canManage && !loading && (
        <>
          {missingQuestions.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4>Questions needing an approved answer</h4>
              <p className="muted">The browser worker found these questions while preparing applications. Verify each answer and approve its draft before retrying.</p>
              <ul style={{ display: "grid", gap: 12, listStyle: "none", padding: 0 }}>
                {missingQuestions.map((question) => {
                  const key = scopeKey(question);
                  const sameScope = facts.filter((fact) => fact.reviewState !== "revoked" && scopeKey(fact) === key);
                  const job = jobs.find((item) => item.id === question.jobId);
                  return (
                    <li key={key} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      <strong>{question.question}</strong>
                      <p className="muted" style={{ margin: "4px 0" }}>
                        {job ? `${job.title}${job.company ? ` at ${job.company}` : ""}` : question.jobTitle || "Specific job"}
                      </p>
                      {sameScope.length > 1 ? (
                        <p className="muted">Resolve the conflicting answers below.</p>
                      ) : sameScope[0]?.reviewState === "draft" ? (
                        <p className="muted">A draft already exists. Review or revise it below.</p>
                      ) : (
                        <button type="button" disabled={busy || !!form}
                          onClick={() => sameScope[0] ? edit(sameScope[0]) : addDraft(question)}>
                          {sameScope[0] ? "Create answer revision" : "Draft answer"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {!facts.length && !error && <p className="muted">No application answers have been recorded.</p>}
          {sections.map((section) => (
            <div key={section} style={{ marginTop: 16 }}>
              <h4>{section}</h4>
              <ul style={{ display: "grid", gap: 12, listStyle: "none", padding: 0 }}>
                {sorted.filter((fact) => fact.section === section).map((fact) => {
                  const stale = !profileMatchesApplicationFact(fact, profile);
                  const expired = Boolean(fact.expiresAt && Date.parse(fact.expiresAt) <= Date.now());
                  const job = jobs.find((item) => item.id === fact.jobId);
                  return (
                    <li key={fact.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      <strong>{fact.question}</strong>
                      <p style={{ margin: "4px 0" }}>
                        {fact.value === null ? (fact.disposition === "declined" ? "Declined" : "Unknown") : formatApplicationFactValue(fact.value)}
                        {" · "}{fact.reviewState} · Revision {fact.revision}
                        {stale && " · Source profile changed"}
                        {expired && " · Expired"}
                        {conflict(fact) && " · Conflicts with another answer in this scope"}
                      </p>
                      <p className="muted" style={{ margin: "4px 0" }}>
                        {job ? `${job.title}${job.company ? ` at ${job.company}` : ""}` : fact.jobId ? "Specific job" : "All candidate applications"}
                        {" · "}{sourceNames[fact.sourceKind]}: {fact.sourceRef}
                        {fact.expiresAt && ` · Expires ${fact.expiresAt.slice(0, 10)} UTC`}
                        {fact.reviewedAt && ` · Reviewed ${fact.reviewedAt.slice(0, 10)}`}
                        {fact.reviewedBy && ` by ${fact.reviewedBy}`}
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" disabled={busy} onClick={() => edit(fact)}>Create revision</button>
                        {fact.reviewState === "draft" && (
                          <button type="button" className="btn-primary" disabled={busy || stale || expired || conflict(fact)}
                            onClick={() => void write("PATCH", { operation: "approve", factId: fact.id, expectedRevision: fact.revision })}>
                            Approve revision
                          </button>
                        )}
                        {fact.reviewState !== "revoked" && (
                          <button type="button" disabled={busy}
                            onClick={() => void write("PATCH", { operation: "revoke", factId: fact.id, expectedRevision: fact.revision })}>
                            Revoke
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {!form && <button type="button" className="btn-primary" disabled={busy}
            onClick={() => addDraft()}>Add answer draft</button>}
          {form && (
            <form onSubmit={(event) => void save(event)} style={{ marginTop: 16 }}>
              <h4>{editing ? `New revision of answer ${editing.revision}` : "New answer draft"}</h4>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
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
                  <label>Approved answer value
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
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button>
                <button type="button" disabled={busy} onClick={closeDraft}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
