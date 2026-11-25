"use client";

import { ArrowRight, Check, Download } from "lucide-react";

export function ContractSigningConfirmation({
  email,
  onContinue,
}: {
  email: string;
  onContinue: () => void;
}) {
  return (
    <div className="portal-onboarding-page portal-contract-complete">
      <section className="portal-contract-complete-card" aria-labelledby="contract-complete-title">
        <div className="portal-contract-complete-icon" aria-hidden="true">
          <Check size={28} strokeWidth={2.5} />
        </div>
        <h1 id="contract-complete-title">Your agreement is signed</h1>
        <p>
          A PDF copy is queued for delivery to{" "}
          <span className="portal-contract-complete-email">{email}</span>
        </p>
        <div className="portal-contract-complete-actions">
          <button type="button" className="portal-btn portal-btn-primary" onClick={onContinue}>
            Continue to portal <ArrowRight size={18} aria-hidden="true" />
          </button>
          <a className="portal-btn portal-btn-secondary" href="/api/portal/me/signed-contract">
            <Download size={18} aria-hidden="true" /> Download signed PDF
          </a>
        </div>
      </section>
    </div>
  );
}
