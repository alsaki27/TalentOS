"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalLogo from "../../PortalLogo";

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

export default function PortalInvitePage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "ready" | "invalid" | "claimed">("loading");
  const [name, setName] = useState("");
  const [defaultEmail, setDefaultEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/portal/invite/${params.token}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) {
          setStatus("invalid");
          return;
        }
        if (data.alreadyClaimed) {
          setStatus("claimed");
          return;
        }
        setName(data.name || "");
        setDefaultEmail(data.email || "");
        setEmail(data.email || "");
        setStatus("ready");
      })
      .catch(() => setStatus("invalid"));
  }, [params.token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    const res = await fetch(`/api/portal/invite/${params.token}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not set up your account.");
      return;
    }

    router.push("/portal");
    router.refresh();
  }

  if (status === "loading") {
    return (
      <div className="portal-auth-shell">
        <div className="portal-auth-card">
          <div className="portal-skeleton" style={{ height: 20, width: "60%" }} />
          <div className="portal-skeleton" style={{ height: 14, width: "80%" }} />
          <div className="portal-skeleton" style={{ height: 44 }} />
          <div className="portal-skeleton" style={{ height: 44 }} />
          <div className="portal-skeleton" style={{ height: 44 }} />
        </div>
      </div>
    );
  }
  if (status === "invalid") {
    return (
      <div className="portal-auth-shell">
        <div className="portal-auth-card">
          <div className="portal-logo"><PortalLogo /><span className="portal-logo-text">Skarion</span></div>
          <h1 className="portal-h1">Invite link not found</h1>
          <p className="portal-sub">This link is invalid or has expired. Ask your recruiter for a new one.</p>
        </div>
      </div>
    );
  }
  if (status === "claimed") {
    return (
      <div className="portal-auth-shell">
        <div className="portal-auth-card">
          <div className="portal-logo"><PortalLogo /><span className="portal-logo-text">Skarion</span></div>
          <h1 className="portal-h1">Account already set up</h1>
          <p className="portal-sub">This invite has already been used.</p>
          <a href="/portal/login" className="portal-btn portal-btn-primary">Go to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="portal-auth-shell">
      <form className="portal-auth-card" onSubmit={submit}>
        <div className="portal-logo">
          <PortalLogo />
          <span className="portal-logo-text">Skarion</span>
        </div>

        <div>
          <h1 className="portal-h1">Welcome{name ? `, ${name}` : ""}</h1>
          <p className="portal-sub">Set up your account to track your applications, interviews, and updates in one place.</p>
        </div>

        <div className="portal-field">
          <label>Email</label>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div className="portal-field">
          <label>Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="portal-field">
          <label>Confirm password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="portal-error">{error}</p>}

        <button className="portal-btn portal-btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Setting up…" : "Create account"}
        </button>

        <div className="portal-divider"><span>or</span></div>

        <a href={`/api/portal/auth/google/start?invite=${params.token}`} className="portal-btn portal-btn-google">
          <GoogleIcon />
          Continue with Google instead
        </a>

        <p className="portal-footnote">
          Default email on file: {defaultEmail || "none"}. You can use a different one above.
        </p>
      </form>
    </div>
  );
}
