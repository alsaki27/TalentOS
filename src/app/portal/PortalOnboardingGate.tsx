"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

function isPublicPortalPath(pathname: string) {
  return pathname === "/portal/login"
    || pathname === "/portal/onboarding"
    || pathname.startsWith("/portal/invite/")
    || pathname === "/portal/reset-password";
}

function isLegacyTokenPath(pathname: string) {
  return /^\/portal\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pathname);
}

export default function PortalOnboardingGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/portal";
  const router = useRouter();
  const [state, setState] = useState<"checking" | "allowed" | "blocked">("checking");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (isPublicPortalPath(pathname) || isLegacyTokenPath(pathname)) {
      setState("allowed");
      return;
    }

    let active = true;
    setState("checking");
    fetch("/api/portal/me/onboarding", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) {
            router.replace("/portal/login");
            setState("checking");
          }
          return;
        }
        if (!response.ok) throw new Error("Could not confirm portal access.");
        const payload = await response.json();
        if (!active) return;
        if (payload.required) {
          router.replace("/portal/onboarding");
          return;
        }
        setState("allowed");
      })
      .catch(() => { if (active) setState("blocked"); });

    return () => { active = false; };
  }, [pathname, retryNonce, router]);

  if (state === "allowed") return <>{children}</>;
  if (state === "blocked") {
    return (
      <div className="portal-onboarding-gate" role="alert">
        <div className="portal-onboarding-gate-card">
          <h1>We couldn&apos;t confirm portal access</h1>
          <p>Please retry. Your portal stays locked until this check succeeds.</p>
          <button className="portal-btn portal-btn-primary" type="button" onClick={() => setRetryNonce((value) => value + 1)}>
            Retry access check
          </button>
        </div>
      </div>
    );
  }
  return <div className="portal-onboarding-gate" role="status" aria-live="polite">Checking your portal access…</div>;
}
