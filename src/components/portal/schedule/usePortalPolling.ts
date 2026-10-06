"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface PortalPollingState<T> {
  data: T | null;
  loading: boolean;
  error: string;
  notFound: boolean;
  updatedAt: Date | null;
  refresh: () => void;
}

/**
 * Shared real-time fetch loop for the candidate portal: loads immediately,
 * then refreshes every `intervalMs` while the tab is visible, plus on focus
 * and on visibility change. One copy of the 401-redirect / skip-while-hidden
 * logic used by every polled portal surface (schedule, training audit, mock
 * interview detail).
 */
export function usePortalPolling<T>(url: string | null, intervalMs = 15000): PortalPollingState<T> {
  const router = useRouter();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!url) { setLoading(false); return; }
    let disposed = false;
    let inFlight = false;

    async function refresh() {
      if (disposed || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch(url as string, { cache: "no-store" });
        if (disposed) return;
        if (response.status === 401) { router.push("/portal/login"); return; }
        if (response.status === 404) {
          setNotFound(true);
          setData(null);
          setError("");
          return;
        }
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const json = (await response.json()) as T;
        if (!disposed) {
          setData(json);
          setError("");
          setNotFound(false);
          setUpdatedAt(new Date());
        }
      } catch {
        if (!disposed) setError("Could not load the latest data. Showing the last loaded view.");
      } finally {
        inFlight = false;
        if (!disposed) setLoading(false);
      }
    }

    refreshRef.current = () => void refresh();
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [url, intervalMs, router]);

  return { data, loading, error, notFound, updatedAt, refresh: () => refreshRef.current() };
}
