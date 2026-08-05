"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
    return <div className="auth-shell"><div className="auth-card">Loading...</div></div>;
  }
  if (status === "invalid") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Invite link not found</h1>
          <p className="muted">This link is invalid or has expired. Ask your recruiter for a new one.</p>
        </div>
      </div>
    );
  }
  if (status === "claimed") {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Account already set up</h1>
          <p className="muted">This invite has already been used.</p>
          <a href="/portal/login" className="btn-primary auth-submit" style={{ textAlign: "center" }}>Go to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h1>Welcome{name ? `, ${name}` : ""}</h1>
          <p className="muted">Set up your account to track your applications.</p>
        </div>

        <div className="field-group">
          <label>Email</label>
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>

        <div className="field-group">
          <label>Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="field-group">
          <label>Confirm Password</label>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <button className="btn-primary auth-submit" type="submit" disabled={submitting}>
          {submitting ? "Setting up..." : "Create account"}
        </button>

        <p className="muted" style={{ textAlign: "center", margin: 0, fontSize: 12 }}>or</p>

        <a href={`/api/portal/auth/google/start?invite=${params.token}`} className="btn auth-submit" style={{ textAlign: "center" }}>
          Continue with Google instead
        </a>

        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Default email from your candidate record: {defaultEmail || "none on file"}. You can use a different one above.
        </p>
      </form>
    </div>
  );
}
