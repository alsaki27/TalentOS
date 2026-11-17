"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { classifyWorkflowFailure } from "@/lib/ai/application-agents/workflowFailureClassifier";
import { qualificationFitScoreText } from "@/lib/qualificationFitDisplay";
import { formatPageFitSummary, formatScoreOutOfTen } from "@/lib/scoreScale";

type WorkflowDetails = {
  workflow?: { status?: string; last_error?: string | null };
  artifacts?: { automation_id: string; data: any }[];
};

function Findings({ details }: { details: WorkflowDetails }) {
  const artifacts = details.artifacts ?? [];
  const panel = artifacts.find(artifact => artifact.automation_id === "application_hiring_panel")?.data;
  const qualification = artifacts.find(artifact => artifact.automation_id === "application_qualification_fit")?.data;
  const finalPolish = artifacts.find(artifact => artifact.automation_id === "application_final_polish")?.data;
  const release = artifacts.find(artifact => artifact.automation_id === "application_release_editor")?.data;
  const releaseCheck = release ?? finalPolish;
  const pageFit = finalPolish?.pageFit ?? panel?.pageFit;
  const lastError = details.workflow?.status === "failed" ? details.workflow.last_error : null;
  const failure = lastError ? classifyWorkflowFailure(lastError) : null;
  const qualificationScore = qualificationFitScoreText(qualification?.score, qualification?.scoreRange);
  const scores = [
    { label: "ATS", value: panel?.atsScore },
    { label: "Recruiter", value: panel?.recruiterScore },
    { label: "Role fit", value: panel?.roleFitScore },
    { label: "Truth", value: typeof panel?.truthfulnessRisk === "number" ? Math.max(0, 10 - panel.truthfulnessRisk) : null },
  ];
  const section = "min-w-0 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 sm:p-5";
  const heading = "text-base font-semibold text-[var(--ink)]";

  return (
    <div className="grid gap-4 break-words">
      {lastError && (
        <section className={section}>
          <h3 className={heading}>Workflow failure</h3>
          <p className="text-danger">{failure?.reason ?? lastError}</p>
          {failure && failure.category !== "other" && (
            <details><summary className="cursor-pointer">Technical details</summary><p>{lastError}</p></details>
          )}
        </section>
      )}
      <section className={section}>
        <h3 className={heading}>Hiring Panel</h3>
        {panel ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {scores.map(({ label, value }) => {
                const score = formatScoreOutOfTen(value);
                return (
                  <div key={label} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3">
                    <dt className="text-xs text-[var(--ink-soft)]">{label}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">{score === null ? "—" : `${score}/10`}</dd>
                  </div>
                );
              })}
            </dl>
            {panel.overallComment && <p>{panel.overallComment}</p>}
            {panel.disposition && (
              <div className="flex flex-wrap items-start gap-2">
                <span className={`badge badge-${panel.disposition === "pursue" ? "success" : panel.disposition === "review" ? "info" : panel.disposition === "deprioritize" ? "warning" : "danger"} capitalize`}>
                  {panel.disposition}
                </span>
                {Array.isArray(panel.dispositionReasons) && <p>{panel.dispositionReasons.join(" · ")}</p>}
              </div>
            )}
            {panel.requiredEdits?.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold">Required edits</h4>
                <ul className="grid gap-2">
                  {panel.requiredEdits.map((edit: { severity: string; description: string }, index: number) => (
                    <li key={index} className="flex flex-wrap items-start gap-2">
                      <span className={`badge badge-${edit.severity === "critical" ? "danger" : edit.severity === "major" ? "warning" : "info"}`}>
                        {edit.severity}
                      </span>
                      <p className="min-w-0 flex-1">{edit.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : <p>Hiring Panel findings are pending.</p>}
      </section>
      {qualification && (
        <section className={section}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={heading}>Qualification fit · {qualificationScore}</h3>
            <span className={`badge ${qualification.status === "scored" ? "badge-success" : "badge-warning"}`}>
              {qualification.status === "scored" ? "Evidence scored" : String(qualification.status).replaceAll("_", " ")}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-soft)]">
            {typeof qualification.evidenceCoverage === "number" && <span>{qualification.evidenceCoverage}% candidate evidence</span>}
            {typeof qualification.jobGroundingCoverage === "number" && <span>{qualification.jobGroundingCoverage}% job requirements grounded</span>}
          </div>
          {qualification.summary && <p>{qualification.summary}</p>}
          {Array.isArray(qualification.criteria) && qualification.criteria.length > 0 && (
            <ul className="divide-y divide-[var(--border)]">
              {qualification.criteria.map((criterion: any, index: number) => (
                <li key={index} className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium">{criterion.requirement}</div>
                    {criterion.jobEvidence && <p className="text-xs text-[var(--ink-soft)]">Job evidence · {criterion.jobEvidence}</p>}
                    {criterion.evidenceExcerpts?.length > 0 && <p className="text-xs text-[var(--ink-soft)]">Candidate evidence · {criterion.evidenceExcerpts.join(" · ")}</p>}
                    {criterion.evidence?.length > 0 && <p className="text-xs text-[var(--ink-soft)]">Source · {criterion.evidence.join(", ")}</p>}
                    {criterion.explanation && <p className="text-xs text-[var(--ink-soft)]">{criterion.explanation}</p>}
                  </div>
                  <div className="text-xs tabular-nums text-[var(--ink-soft)]">
                    {String(criterion.status).replaceAll("_", " ")} · {criterion.points}/{criterion.weight}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <details className="text-xs text-[var(--ink-soft)]">
            <summary className="cursor-pointer">How the score is calculated</summary>
            <p className="mt-2">The lower end uses confirmed earned weight. The upper end includes unresolved requirement weight. A verified hard experience gap caps the score at 4.0. Rubric {qualification.rubricVersion}.</p>
            {typeof qualification.rawScore === "number" && typeof qualification.score === "number" && qualification.score < qualification.rawScore && (
              <p className="mt-1">Raw score {formatScoreOutOfTen(qualification.rawScore)} was capped to {formatScoreOutOfTen(qualification.score)}.</p>
            )}
          </details>
        </section>
      )}
      {(releaseCheck || pageFit) && (
        <section className={section}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={heading}>Release checks</h3>
            {releaseCheck && <span className={`badge badge-${releaseCheck.exportReady ? "success" : "warning"}`}>{releaseCheck.exportReady ? "Ready at AI review" : "Flagged at AI review"}</span>}
          </div>
          {Array.isArray(releaseCheck?.unresolvedWarnings) && releaseCheck.unresolvedWarnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5">
              {releaseCheck.unresolvedWarnings.map((warning: string, index: number) => <li key={index}>{warning}</li>)}
            </ul>
          )}
          {pageFit && <p className="text-[var(--ink-soft)]">Page fit at AI review · {formatPageFitSummary(pageFit)}</p>}
          {release && <p className="text-xs text-[var(--ink-soft)]">Approval checks the latest saved Studio PDF.</p>}
        </section>
      )}
    </div>
  );
}

export function WorkflowFindingsDialog({
  workflowId, ticketNumber, candidate, job, company, onClose, restoreFocus,
}: {
  workflowId: string | null;
  ticketNumber: number | null;
  candidate?: string | null;
  job?: string | null;
  company?: string | null;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const [result, setResult] = useState<{ id: string; details?: WorkflowDetails; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!workflowId) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/application-ai-workflows/${workflowId}?action=status`, {
          cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load findings.");
        const details = await response.json();
        if (!controller.signal.aborted) setResult({ id: workflowId!, details });
      } catch {
        if (!controller.signal.aborted) setResult({ id: workflowId!, error: "Could not load findings." });
      }
    }
    void load();
    return () => controller.abort();
  }, [workflowId, attempt]);

  const current = result?.id === workflowId ? result : null;
  return (
    <Dialog open={Boolean(workflowId)} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="max-h-[88dvh] w-[90vw] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--ink)]"
        onCloseAutoFocus={event => { event.preventDefault(); restoreFocus(); }}
      >
        <header className="min-w-0 border-b border-[var(--border)] px-4 py-4 pr-12 sm:px-6 sm:pr-12">
          <DialogTitle className="text-xl leading-tight">Review findings{ticketNumber ? ` · A#${ticketNumber}` : ""}</DialogTitle>
          <DialogDescription className="mt-2 break-words text-[var(--ink-soft)]">
            {[candidate, job, company].filter(Boolean).join(" · ") || "Application workflow details"}
          </DialogDescription>
        </header>
        <div className="min-w-0 overflow-y-auto overscroll-contain px-4 py-4 text-sm sm:px-6">
          {current?.details ? <Findings details={current.details} /> : current?.error ? (
            <div role="alert" className="space-y-3">
              <p>{current.error}</p>
              <button className="btn-compact btn-sm" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Try again</button>
            </div>
          ) : <p role="status">Loading findings…</p>}
        </div>
        <footer className="border-t border-[var(--border)] px-4 py-3 text-sm sm:px-6">
          <Link href="/resume-parsing-status" className="underline underline-offset-4">View pipeline status</Link>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
