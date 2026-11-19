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

type AuthMode = "signin" | "signup";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams?.get("next") || "/jobs", [searchParams]);
  const requestedMode = (searchParams?.get("mode") || "").toLowerCase() === "signup" ? "signup" : "signin";
  const [mode, setMode] = useState<AuthMode>("signin");
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loadingMode, setLoadingMode] = useState<AuthMode | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/signup", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!active) return;
        const available = data?.bootstrap_available === true;
        setBootstrapAvailable(available);
        setMode(available ? requestedMode : "signin");
      })
      .catch(() => {
        if (active) setMode("signin");
      });
    return () => { active = false; };
  }, [requestedMode]);

  useEffect(() => {
    const authError = searchParams?.get("error");
    if (authError) {
      setError(authError);
    }
  }, [searchParams]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoadingMode(mode);

    if (mode === "signup" && password !== confirmPassword) {
      setLoadingMode("");
      setError("Passwords do not match.");
      return;
    }

    let res: Response;
    try {
      res = await fetch(mode === "signin" ? "/api/signin" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          display_name: displayName,
        }),
      });
    } catch {
      setLoadingMode("");
      setError("The sign-in service could not be reached. Please disable browser blocking for this site and try again.");
      return;
    }

    setLoadingMode("");
    if (!res.ok) {
      // Candidate accounts use their isolated portal session. Trying this only
      // after staff auth fails preserves staff auth and keeps the two cookies
      // completely separate.
      if (mode === "signin") {
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
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || (mode === "signin" ? "Could not sign in." : "Could not sign up."));
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
            {mode === "signin"
              ? "Sign in to continue into the TalentOS workspace."
              : "Create your account to start using TalentOS."}
          </p>
        </div>

        <div className="action-group" style={{ justifyContent: "stretch", display: "grid", gridTemplateColumns: bootstrapAvailable ? "1fr 1fr" : "1fr" }}>
          <button
            type="button"
            className={mode === "signin" ? "btn-primary" : "btn"}
            onClick={() => {
              setMode("signin");
              setError("");
            }}
          >
            Sign in
          </button>
          {bootstrapAvailable && <button
            type="button"
            className={mode === "signup" ? "btn-primary" : "btn"}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            Sign up
          </button>}
        </div>

        {mode === "signup" && (
          <div className="field-group">
            <label>Full Name</label>
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required={mode === "signup"}
            />
          </div>
        )}

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

        {mode === "signup" && (
          <div className="field-group">
            <label>Confirm Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required={mode === "signup"}
            />
          </div>
        )}

        {error && <p className="form-error">{error}</p>}

        <button className="btn-primary auth-submit" type="submit" disabled={loadingMode !== ""}>
          {loadingMode === "signin" && "Signing in..."}
          {loadingMode === "signup" && "Creating account..."}
          {loadingMode === "" && (mode === "signin" ? "Sign in" : "Create account")}
        </button>

        <a href={googleHref} className="btn auth-submit" style={{ textAlign: "center" }}>
          Continue with Google
        </a>

        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {bootstrapAvailable
            ? "The first account becomes an administrator."
            : "Need staff access? Ask a TalentOS administrator to add your account."}
        </p>
      </form>
    </div>
  );
}
