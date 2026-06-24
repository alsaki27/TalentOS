"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/portal")
  );
}

export default function AuthGate() {
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const [checked, setChecked] = useState(false);

  const search = useMemo(() => {
    const raw = searchParams?.toString();
    return raw ? `?${raw}` : "";
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (isPublicPath(pathname)) {
        if (!cancelled) setChecked(true);
        return;
      }

      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        if (cancelled) return;
        if (res.ok) {
          setChecked(true);
          return;
        }
      } catch {
        if (cancelled) return;
      }

      const nextPath = `${pathname}${search}`;
      window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [pathname, search]);

  if (!checked && !isPublicPath(pathname)) return null;
  return null;
}
