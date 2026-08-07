"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PortalLogo from "../PortalLogo";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.9v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.03l3.05-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58A8.6 8.6 0 0 0 9 0 9 9 0 0 0 .9 4.97l3.05 2.33C4.66 5.17 6.65 3.58 9 3.58Z" />
    </svg>
  );
}

export default function PortalLoginPage() {
  return (
    <Suspense fallback={<div className="portal-auth-shell"><div className="portal-auth-card"><div className="portal-skeleton" style={{ height: 200 }} /></div></div>}>
      <PortalLoginForm />
    </Suspense>
  );
}

function PortalLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    const err = searchParams?.get("error");
    if (searchParams?.get("mfa") === "1") setMfaRequired(true);
    if (err === "no_account") setError("No portal account is linked to that Google account. Use your invite link first.");
    else if (err) setError("Could not sign in with Google. Please try again.");
  }, [searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const res = await fetch("/api/portal/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not sign in.");
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (data.mfaRequired) { setMfaRequired(true); return; }
    router.push("/portal");
    router.refresh();
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/portal/auth/mfa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: mfaCode }),
    });
    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not verify authenticator code.");
      return;
    }
    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="portal-auth-shell">
      <form className="portal-auth-card" onSubmit={mfaRequired ? verifyMfa : submit}>
        <div className="portal-logo">
          <PortalLogo />
          <span className="portal-logo-text">Skarion</span>
        </div>

        <div>
          <h1 className="portal-h1">{mfaRequired ? "Verify your identity" : "Welcome back"}</h1>
          <p className="portal-sub">{mfaRequired ? "Enter the 6-digit code from Google Authenticator." : "Sign in to track your job search."}</p>
        </div>

        {!mfaRequired && <div className="portal-field">
          <label>Email</label>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>}

        {!mfaRequired ? <div className="portal-field">
          <label>Password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div> : <div className="portal-field"><label>Authenticator code</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} required /></div>}

        {error && <p className="portal-error">{error}</p>}

        <button className="portal-btn portal-btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {!mfaRequired && <div className="portal-divider"><span>or</span></div>}

        {!mfaRequired && <a href="/api/portal/auth/google/start" className="portal-btn portal-btn-google">
          <GoogleIcon />
          Continue with Google
        </a>}

        <p className="portal-footnote">
          Don&apos;t have access yet? Ask your recruiter for an invite link.
        </p>
      </form>
    </div>
  );
}
