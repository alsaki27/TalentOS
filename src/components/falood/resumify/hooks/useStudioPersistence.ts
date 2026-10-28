// src/components/falood/resumify/hooks/useStudioPersistence.ts
//
// Shared load-gating / debounced-autosave / exit-flush safety net for the
// Falood resume studio pages (base-resume and tailored-resume). Extracted
// after a 2026-10-15 data-loss incident was fixed on the tailored-resume
// studio page but never ported to the sibling base-resume studio page, which
// carried an independently hand-written copy of the exact same vulnerable
// pattern. See src/lib/falood/resumeEmptyCheck.ts for the full incident
// writeup and the shared guard this hook is built on.
//
// The rule this hook exists to make structurally unskippable: nothing is
// ever sent to the server through this hook without first passing
// shouldPersistResumeSnapshot() - not "the page is supposed to check this
// itself," but save()/flush() below call it before ever invoking the
// caller-supplied save/flush functions. A page using this hook cannot bypass
// the guard by forgetting to call it, which is exactly how the original bug
// happened (both pages had their own copy of the same check, and one of them
// simply never got updated when the other was fixed).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { shouldPersistResumeSnapshot, type PersistGuardResult, type PersistGuardReason } from "@/lib/falood/resumeEmptyCheck";
import type { ResumeData } from "@/components/falood/resumify/types/resume";

export type StudioSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseStudioPersistenceOptions<T> {
  /** False while there is nothing persistable yet (e.g. a not-yet-created resume) - the hook does nothing at all while disabled. */
  enabled: boolean;
  /** The current persistable snapshot, as a plain value - construct it fresh on every render (a cheap object literal), not memoized. */
  snapshot: T;
  /** Extracts the resume-content portion of a snapshot, for the empty-content guard. Does not need to be memoized. */
  getResumeData: (snapshot: T) => Partial<ResumeData> | null | undefined;
  /** Performs the real PATCH. Resolve false (never throw) on failure. Does not need to be memoized. */
  save: (snapshot: T) => Promise<boolean>;
  /** Fire-and-forget PATCH for the exit-flush path (keepalive/best-effort). Does not need to be memoized. */
  flush: (snapshot: T) => void;
  /** Autosave debounce window, ms. */
  debounceMs?: number;
}

export interface UseStudioPersistenceResult<T> {
  hasLoadedInitialData: boolean;
  /**
   * Call exactly once, immediately after a load genuinely succeeds, with the
   * snapshot that was just loaded - arms the hook. Never call this on a
   * failed, invalid, or partial load; show a dedicated error/retry state
   * instead of the normal editable UI in that case, so there is nothing on
   * screen that could accidentally be saved before a real load completes.
   */
  markLoaded: (loadedSnapshot: T) => void;
  isSaving: boolean;
  saveStatus: StudioSaveStatus;
  /** Why the most recent persist() call returned false, if it did. */
  lastBlockReason: PersistGuardReason | null;
  /**
   * Guarded explicit save - wire to a Save button, or call with no UI
   * attached from any other code path that wants to persist right now.
   * Resolves true once the snapshot is persisted (including "already
   * up to date," a no-op save), false if blocked or failed.
   */
  persist: () => Promise<boolean>;
}

export function useStudioPersistence<T>(options: UseStudioPersistenceOptions<T>): UseStudioPersistenceResult<T> {
  const { enabled, debounceMs = 1000 } = options;

  // "Always latest" refs for the caller-supplied values/functions, assigned
  // during render (a standard, safe React pattern for this - never read
  // during the same render, only from effects/callbacks afterward). This
  // lets the effects below register their listeners once (stable dependency
  // arrays, not re-attached on every keystroke) while still always acting on
  // the freshest snapshot - the same guarantee each studio page's own
  // ref-mirroring effect achieved by hand before, now owned by the hook
  // instead of duplicated per page.
  const snapshotRef = useRef(options.snapshot);
  snapshotRef.current = options.snapshot;
  const getResumeDataRef = useRef(options.getResumeData);
  getResumeDataRef.current = options.getResumeData;
  const saveRef = useRef(options.save);
  saveRef.current = options.save;
  const flushRef = useRef(options.flush);
  flushRef.current = options.flush;

  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const hasLoadedInitialDataRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [saveStatus, setSaveStatus] = useState<StudioSaveStatus>("idle");
  const [lastBlockReason, setLastBlockReason] = useState<PersistGuardReason | null>(null);
  const lastSavedSnapshotRef = useRef<T | null>(null);
  // A save that arrives while one is already in flight is queued, not
  // dropped - retried the instant the in-flight one clears, with the
  // freshest snapshot at that moment (not the stale one from when it was
  // queued).
  const pendingSaveRef = useRef(false);

  const guardSnapshot = useCallback((snapshot: T): PersistGuardResult => {
    const last = lastSavedSnapshotRef.current;
    return shouldPersistResumeSnapshot({
      hasLoadedInitialData: hasLoadedInitialDataRef.current,
      nextResumeData: getResumeDataRef.current(snapshot),
      lastSavedResumeData: last !== null ? getResumeDataRef.current(last) : null,
    });
  }, []);

  const markLoaded = useCallback((loadedSnapshot: T) => {
    lastSavedSnapshotRef.current = loadedSnapshot;
    hasLoadedInitialDataRef.current = true;
    setHasLoadedInitialData(true);
  }, []);

  const persist = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return false;
    }

    const snapshot = snapshotRef.current;
    const guard = guardSnapshot(snapshot);
    if (!guard.allow) {
      setSaveStatus("error");
      setLastBlockReason(guard.reason);
      return false;
    }

    const last = lastSavedSnapshotRef.current;
    if (last !== null && JSON.stringify(snapshot) === JSON.stringify(last)) {
      setSaveStatus("saved");
      setLastBlockReason(null);
      return true;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveStatus("saving");
    try {
      const ok = await saveRef.current(snapshot);
      if (ok) {
        lastSavedSnapshotRef.current = snapshot;
        setSaveStatus("saved");
        setLastBlockReason(null);
      } else {
        setSaveStatus("error");
      }
      return ok;
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
      if (pendingSaveRef.current) {
        pendingSaveRef.current = false;
        window.setTimeout(() => { void persistRef.current(); }, 0);
      }
    }
    // guardSnapshot is stable (empty deps); enabled is the only real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, guardSnapshot]);

  const persistRef = useRef(persist);
  persistRef.current = persist;

  // Debounced autosave. snapshotJson is recomputed every render (cheap - the
  // same cost every prior version of this logic already paid per autosave
  // tick) and used as the effect's dependency, so the effect only actually
  // re-runs when the content genuinely changed, without requiring the caller
  // to list every watched field by hand.
  const snapshotJson = enabled ? JSON.stringify(options.snapshot) : "";
  useEffect(() => {
    if (!enabled || !hasLoadedInitialData || isSaving) return;
    const last = lastSavedSnapshotRef.current;
    if (last !== null && snapshotJson === JSON.stringify(last)) return;
    const timeoutId = window.setTimeout(() => { void persistRef.current(); }, debounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [enabled, hasLoadedInitialData, isSaving, debounceMs, snapshotJson]);

  // Exit-flush: beforeunload (real tab close/refresh) + visibilitychange
  // (tab-switch - a normal guarded save is enough, no need for the raw
  // beacon) + unmount cleanup (same-tab client-side navigation away, which
  // never fires beforeunload at all). Registered once per `enabled` value,
  // always reads the freshest snapshot/functions via the refs above - this
  // exact mechanism is what the Oct 15 incident broke, now with
  // hasLoadedInitialDataRef and shouldPersistResumeSnapshot both mandatory
  // and unconditional, not left to each page to remember.
  useEffect(() => {
    if (!enabled) return;

    const dirtySnapshot = (): T | null => {
      if (!hasLoadedInitialDataRef.current) return null;
      const snapshot = snapshotRef.current;
      const last = lastSavedSnapshotRef.current;
      if (last !== null && JSON.stringify(snapshot) === JSON.stringify(last)) return null;
      return snapshot;
    };

    const flushIfDirty = () => {
      const snapshot = dirtySnapshot();
      if (!snapshot) return;
      const guard = guardSnapshot(snapshot);
      if (!guard.allow) {
        console.error(`[Studio persistence] Skipped exit-flush: ${guard.reason}`);
        return;
      }
      flushRef.current(snapshot);
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtySnapshot()) return;
      flushIfDirty();
      event.preventDefault();
      event.returnValue = "";
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && dirtySnapshot()) void persistRef.current();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushIfDirty();
    };
  }, [enabled, guardSnapshot]);

  return { hasLoadedInitialData, markLoaded, isSaving, saveStatus, lastBlockReason, persist };
}
