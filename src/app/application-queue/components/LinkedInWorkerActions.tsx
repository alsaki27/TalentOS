"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const jobsEndpoint = "/api/browser-worker/v3/jobs";
const workersEndpoint = "/api/browser-worker/v3/workers";

export interface RegisteredBrowserWorker {
  id: string;
  label: string;
}

interface LinkedInWorkerJob {
  status: "queued" | "leased" | "prepared" | "needs_human" | "failed" | "submission_unknown";
  completedAt: string | null;
  result: { reason: string; missingQuestions?: string[] } | null;
}

const jobLabels: Record<LinkedInWorkerJob["status"], string> = {
  queued: "Waiting for worker",
  leased: "Preparing LinkedIn application",
  prepared: "LinkedIn Review reached",
  needs_human: "Needs staff attention",
  failed: "Worker stopped",
  submission_unknown: "Check the application on LinkedIn",
};

const blockerLabels: Record<string, string> = {
  missing_verified_contact: "Confirm the contact details in the candidate’s Overview.",
  missing_required_answers: "Answer the required questions in the candidate’s Overview.",
  chrome_connection_required: "Check the candidate’s Chrome profile on the worker PC.",
  linkedin_sign_in_required: "Sign in to LinkedIn in the candidate’s Chrome profile on the worker PC.",
  candidate_identity_not_verified: "The worker could not verify the LinkedIn account.",
  candidate_email_not_verified: "The LinkedIn email did not match the approved email.",
  posting_unavailable: "The worker could not open the approved LinkedIn posting.",
  invalid_approved_answer: "Check whether the approved answer matches the options shown by LinkedIn.",
  source_changed: "Recheck the job, résumé, and application readiness before retrying.",
  lease_expired: "The worker lost its connection before it could report a result.",
};

export function LinkedInWorkerSetup({ workers, onRegistered }: {
  workers: RegisteredBrowserWorker[];
  onRegistered: () => void;
}) {
  const [label, setLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function register(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(workersEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.credential !== "string") throw new Error(body.error || "Worker registration failed.");
      setCredential(body.credential);
      setLabel("");
      onRegistered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Worker registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="card" style={{ marginBottom: 12 }}>
    <summary>LinkedIn worker setup</summary>
    <p className="muted">{workers.length ? workers.map(worker => worker.label).join(", ") : "No worker registered."}</p>
    <form onSubmit={register}>
      <label>Worker PC name <input className="input" required maxLength={80} value={label} onChange={event => setLabel(event.target.value)} /></label>
      <button type="submit" className="btn-compact" disabled={busy || !label.trim()}>Register worker</button>
    </form>
    {credential && <div>
      <p>On the worker PC, run <code>&amp; '.\scripts\run-dedicated-worker.ps1' -SaveKey</code> from the worker checkout, then paste this key into the prompt.</p>
      <input aria-label="New worker key" className="input" readOnly value={credential} />
      <button type="button" className="btn-compact" onClick={() => setCredential("")}>Hide key</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </details>;
}

export function LinkedInWorkerActions({ applicationId, candidateId, workers }: {
  applicationId: string;
  candidateId: string;
  workers: RegisteredBrowserWorker[];
}) {
  const [job, setJob] = useState<LinkedInWorkerJob | null>(null);
  const [workerId, setWorkerId] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nextRequest = useRef<string | null>(null);
  const active = job?.status === "queued" || job?.status === "leased";

  useEffect(() => {
    if (!open || busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const reply = await fetch(`${jobsEndpoint}?applicationId=${encodeURIComponent(applicationId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const body = await reply.json();
        if (!reply.ok) throw new Error(body.error || "Could not read preparation status.");
        if (controller.signal.aborted) return;
        setJob(body.job);
        if (body.job?.status === "queued" || body.job?.status === "leased") timer = setTimeout(refresh, 5000);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not read preparation status.");
      }
    }
    void refresh();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [applicationId, open, busy]);

  async function prepare() {
    if (busy || active || workers.length === 0) return;
    const target = workers.length === 1 ? workers[0].id : workerId;
    if (!target) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setOpen(true);
    setError("");
    nextRequest.current ??= crypto.randomUUID();
    try {
      const reply = await fetch(jobsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": nextRequest.current },
        body: JSON.stringify({ applicationId, workerId: target }),
      });
      if (reply.ok || reply.status < 500) nextRequest.current = null;
      const body = await reply.json();
      if (!reply.ok) throw new Error(body.error || "Could not queue LinkedIn preparation.");
      setJob(body.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue LinkedIn preparation.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="action-group">
    {workers.length === 1 && <button type="button" className="btn-compact btn-sm" disabled={busy || active} onClick={() => void prepare()}>
      Prepare LinkedIn
    </button>}
    <button type="button" className="btn-compact btn-sm" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      {job ? jobLabels[job.status] : "LinkedIn preparation status"}
    </button>
    {open && <div className="muted" style={{ width: "100%" }}>
      {workers.length > 1 && <>
        <label>Worker PC <select className="input" value={workerId} disabled={busy || active}
          onChange={event => { setWorkerId(event.target.value); nextRequest.current = null; }}>
          <option value="">Select a worker</option>
          {workers.map(worker => <option key={worker.id} value={worker.id}>{worker.label}</option>)}
        </select></label>
        <button type="button" className="btn-compact btn-sm" disabled={busy || active || !workerId} onClick={() => void prepare()}>
          Prepare LinkedIn
        </button>
      </>}
      {job?.status === "queued" && <p>Keep the worker running with this candidate registered on that PC.</p>}
      {job?.completedAt && <p>Finished {new Date(job.completedAt).toLocaleString()}</p>}
      {job?.result && (blockerLabels[job.result.reason] || job.status !== "prepared") && <p>
        {blockerLabels[job.result.reason] || `Worker result: ${job.result.reason.replaceAll("_", " ")}`}
      </p>}
      {!!job?.result?.missingQuestions?.length && <>
        <ul>{job.result.missingQuestions.map(question => <li key={question}>{question}</li>)}</ul>
        <p>Open the <Link href={`/candidates/${candidateId}`}>candidate profile</Link>, then choose Profile Overview to answer the required questions.</p>
      </>}
      {job?.status === "prepared" && <p>The worker reached Review and closed its Chrome window before submission.</p>}
      {error && <div role="alert">{error}</div>}
    </div>}
  </div>;
}
