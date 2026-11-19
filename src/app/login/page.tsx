"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="auth-shell"><div className="auth-card">Loading...</div></div>}>
      <AuthForm />
    </Suspense>
  );
}

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams?.get("next") || "/jobs", [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const authError = searchParams?.get("error");
    if (authError) {
      setError(authError);
    }
  }, [searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    let res: Response;
    try {
      res = await fetch("/api/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setLoading(false);
      setError("The sign-in service could not be reached. Please disable browser blocking for this site and try again.");
      return;
    }

    setLoading(false);
    if (!res.ok) {
      // Candidate accounts use their isolated portal session. Trying this only
      // after staff auth fails preserves staff auth and keeps the two cookies
      // completely separate.
      try {
        const candidateRes = await fetch("/api/portal/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        if (candidateRes.ok) {
          router.push("/portal");
          router.refresh();
          return;
        }
      } catch {
        // Fall through to the normal staff sign-in error below.
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not sign in.");
      return;
    }

    router.push(nextPath);
    router.refresh();
  }

  const googleHref = useMemo(
    () => `/api/auth/google/start?next=${encodeURIComponent(nextPath)}`,
    [nextPath]
  );

  return (
    <div className="auth-shell">
      <form className="auth-card" onSubmit={submit}>
        <div>
          <h1>TalentOS</h1>
          <p className="muted">
            Sign in to continue into the TalentOS workspace.
          </p>
        </div>

        <div className="field-group">
          <label>Email</label>
          <input
            type="email"
            name="email"
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
            name="password"
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

        <a href={googleHref} className="btn auth-submit" style={{ textAlign: "center" }}>
          Continue with Google
        </a>

        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Staff accounts are created by a TalentOS administrator. The first administrator signs in with the verified Google account configured for initial setup.
        </p>
      </form>
    </div>
  );
}
