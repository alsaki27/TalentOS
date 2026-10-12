"use client";

import { FormEvent, UIEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLogo from "../PortalLogo";

interface OnboardingData {
  required: boolean;
  candidateName: string;
  agreementVersion: string;
  privacyNoticeVersion: string;
  agreementText?: string;
}

export default function PortalOnboardingPage() {
  const router = useRouter();
  const agreementRef = useRef<HTMLDivElement | null>(null);
  const [data, setData] = useState<OnboardingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullyRead, setFullyRead] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [dataProcessingConsent, setDataProcessingConsent] = useState(false);
  const [hasSsn, setHasSsn] = useState<boolean | null>(null);
  const [ssnLast4, setSsnLast4] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/portal/me/onboarding", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) router.replace("/portal/login");
          throw new Error(payload.error || "Could not load the agreement.");
        }
        if (!active) return;
        const onboarding = payload as OnboardingData;
        if (!onboarding.required) {
          router.replace("/portal");
          return;
        }
        setData(onboarding);
        setLoading(false);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the agreement.");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!data?.agreementText || !agreementRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = agreementRef.current;
      if (panel && panel.scrollHeight <= panel.clientHeight + 4) setFullyRead(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data?.agreementText]);

  function trackAgreementScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (element.scrollHeight - element.clientHeight - element.scrollTop <= 8) setFullyRead(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!data || !fullyRead || !termsAccepted || !dataProcessingConsent || hasSsn === null) {
      setError("Read the full agreement and complete each required choice.");
      return;
    }
    if (hasSsn && !/^\d{4}$/.test(ssnLast4)) {
      setError("Enter exactly the last four digits of your SSN.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/portal/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          agreementVersion: data.agreementVersion,
          privacyNoticeVersion: data.privacyNoticeVersion,
          termsAccepted,
          agreementScrolledToEnd: fullyRead,
          dataProcessingConsent,
          hasSsn,
          ...(hasSsn ? { ssnLast4 } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save your choices.");
      setSsnLast4("");
      router.replace("/portal");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save your choices.");
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.replace("/portal/login");
  }

  if (loading) {
    return <div className="portal-onboarding-gate" role="status">Loading the required agreement…</div>;
  }

  return (
    <div className="portal-onboarding-page">
      <section className="portal-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-onboarding-title">
        <header className="portal-onboarding-header">
          <div className="portal-logo"><PortalLogo /><span className="portal-logo-text">Skarion</span></div>
          <span className="portal-onboarding-step">Required before portal access</span>
          <h1 id="portal-onboarding-title">Welcome{data?.candidateName ? `, ${data.candidateName}` : ""}</h1>
          <p>Review the complete agreement and submit the required onboarding choices to continue.</p>
        </header>

        <div
          ref={agreementRef}
          className="portal-agreement-scroll"
          tabIndex={0}
          aria-label="Career Coaching, Training, and Placement Service Agreement. Scroll to the end to continue."
          onScroll={trackAgreementScroll}
        >
          <pre>{data?.agreementText}</pre>
        </div>
        <p className={`portal-agreement-read-status${fullyRead ? " is-complete" : ""}`} aria-live="polite">
          {fullyRead ? "You reached the end of the agreement." : "Scroll to the end of the agreement to enable the required choices."}
        </p>

        <form className="portal-onboarding-form" onSubmit={submit}>
          <fieldset className="portal-onboarding-choice" disabled={!fullyRead}>
            <legend>Do you currently have a Social Security Number (SSN)? <span aria-hidden="true">*</span></legend>
            <label><input type="radio" name="has-ssn" checked={hasSsn === true} onChange={() => { setHasSsn(true); setSsnLast4(""); }} /> Yes</label>
            <label><input type="radio" name="has-ssn" checked={hasSsn === false} onChange={() => { setHasSsn(false); setSsnLast4(""); }} /> No</label>
          </fieldset>

          {hasSsn === true && (
            <div className="portal-onboarding-field">
              <label htmlFor="ssn-last-four">Input the last 4 digits of your SSN <span aria-hidden="true">*</span></label>
              <input
                id="ssn-last-four"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                pattern="[0-9]{4}"
                value={ssnLast4}
                onChange={(event) => setSsnLast4(event.target.value.replace(/\D/g, "").slice(0, 4))}
                disabled={!fullyRead}
                aria-describedby="ssn-last-four-help"
                required
              />
              <small id="ssn-last-four-help">Only four digits are requested. The full SSN is never collected.</small>
            </div>
          )}

          <div className="portal-onboarding-privacy">
            <strong>How this information is handled</strong>
            <p>Only the last four digits are collected when you answer Yes. They are encrypted before storage and are not displayed in the portal or staff candidate profile. A third-party verification service is not connected yet.</p>
          </div>

          <label className="portal-onboarding-checkbox">
            <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} disabled={!fullyRead} />
            <span>I have read and agree to the full Career Coaching, Training, and Placement Service Agreement above.</span>
          </label>
          <label className="portal-onboarding-checkbox">
            <input type="checkbox" checked={dataProcessingConsent} onChange={(event) => setDataProcessingConsent(event.target.checked)} disabled={!fullyRead} />
            <span>I consent to Skarion processing the onboarding information I submit, including the last four SSN digits only if I answered Yes.</span>
          </label>

          {error && <p className="portal-error" role="alert">{error}</p>}
          <footer className="portal-onboarding-actions">
            <button type="button" className="portal-btn portal-btn-secondary" onClick={signOut} disabled={submitting}>Sign out</button>
            <button
              type="submit"
              className="portal-btn portal-btn-primary"
              disabled={!fullyRead || !termsAccepted || !dataProcessingConsent || hasSsn === null || submitting || (hasSsn && ssnLast4.length !== 4)}
            >
              {submitting ? "Saving securely…" : "Agree and continue"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
