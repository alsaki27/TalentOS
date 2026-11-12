"use client";

import { useEffect, useState, type FormEvent } from "react";

const API = "/api/browser-worker/v2";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function readPairing(fragment: string, applicationId: string) {
  const params = new URLSearchParams(fragment.slice(1));
  const candidateId = params.get("candidateId") || "";
  const exportId = params.get("exportId") || "";
  const profileVersion = params.get("profileVersion") || "";
  const credentialHash = params.get("credentialHash") || "";
  const expiresAt = Number(params.get("expiresAt"));
  if (params.get("applicationId") !== applicationId || !UUID.test(candidateId) || !UUID.test(exportId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(profileVersion) || !/^[a-f0-9]{64}$/.test(credentialHash) ||
    !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  return { applicationId, candidateId, exportId, profileVersion, credentialHash, expiresAt };
}

export default function PilotPairing({ applicationId }: { applicationId: string }) {
  const [pairing, setPairing] = useState<ReturnType<typeof readPairing>>();
  const [ticket, setTicket] = useState<number>();
  const [pairingCode, setPairingCode] = useState("");
  const [enrollmentId, setEnrollmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const details = readPairing(window.location.hash, applicationId);
    setPairing(details);
    if (!details) return;
    const controller = new AbortController();
    fetch(`/api/applications/${applicationId}`, { cache: "no-store", redirect: "error", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const app = await response.json();
        if (app.id !== applicationId || app.candidate_id !== details.candidateId || !Number.isInteger(app.app_number)) {
          throw new Error();
        }
        setTicket(app.app_number);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("Could not verify this TalentOS ticket. Check your staff session and start a fresh pairing.");
      });
    return () => controller.abort();
  }, [applicationId]);

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pairing || !ticket || busy || enrollmentId) return;
    const code = pairingCode.replace(/[\s-]/g, "").toUpperCase();
    if (code !== pairing.credentialHash.slice(0, 8).toUpperCase()) {
      setMessage("The code does not match this local worker. Check the code in its terminal.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${API}/pilot/enroll`, {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
        body: JSON.stringify({ ...pairing, pairingCode: code }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.enrollmentId !== "string" || !UUID.test(result.enrollmentId)) {
        setMessage(typeof result.error === "string" ? result.error : "TalentOS could not approve this pilot.");
        return;
      }
      setEnrollmentId(result.enrollmentId);
      setPairingCode("");
      window.history.replaceState(window.history.state, "", window.location.pathname);
      setMessage("Worker approved. The terminal shows the preparation result and revokes access when the run ends.");
    } catch {
      setMessage("TalentOS did not confirm approval. Check the worker terminal for the outcome before retrying.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/enrollments/${enrollmentId}/revoke`, { method: "POST", redirect: "error" });
      if (!response.ok) throw new Error();
      setMessage((await response.json()).revoked ? "Worker access revoked." : "This enrollment is no longer active.");
    } catch {
      setMessage("TalentOS could not confirm revocation. Check the worker terminal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-xl space-y-5 rounded-xl border border-border bg-card p-6 text-card-foreground">
      <h1 className="text-xl font-semibold">TalentOS worker pilot</h1>
      {pairing === undefined && <p role="status">Checking the worker pairing link…</p>}
      {pairing === null && <p>Open a fresh pairing link from the worker terminal on this PC.</p>}
      {pairing && ticket !== undefined && <p>Ticket <strong>A#{ticket}</strong> will run on a simulated form up to Review.</p>}
      {pairing && ticket !== undefined && !enrollmentId && (
        <form onSubmit={approve} className="space-y-4">
          <p>Only approve a code from the worker terminal you started on this PC.</p>
          <label className="block">
            <span className="block">Local worker code</span>
            <input className="mt-1 rounded-md border border-border bg-background px-3 py-2" value={pairingCode}
              onChange={event => setPairingCode(event.target.value)} autoComplete="off" spellCheck={false} required maxLength={12} />
          </label>
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" disabled={busy}>Approve local worker</button>
        </form>
      )}
      {enrollmentId && <button type="button" className="rounded-md border border-border px-4 py-2" disabled={busy} onClick={revoke}>Revoke worker access</button>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
