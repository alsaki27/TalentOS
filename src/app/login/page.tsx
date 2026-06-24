"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-shell"><div className="auth-card">Loading...</div></div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams?.get("next") || "/jobs", [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
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

    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h1>Skarion Tracker</h1>
          <p className="muted">Sign in to manage candidates, jobs, and application tickets.</p>
        </div>

        <div className="field-group">
          <label>Email</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="field-group">
          <label>Password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error && <p className="form-error">{error}</p>}

        <button className="btn-primary auth-submit" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
