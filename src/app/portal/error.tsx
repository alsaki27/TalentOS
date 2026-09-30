"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";

// Wraps every /portal/* route. Without this, ANY uncaught client exception
// anywhere in the candidate portal fell through to Next.js's bare default -
// "Application error: a client-side exception has occurred (see the browser
// console for more information)" - with no recovery but a manual reload and
// no detail surfaced anywhere we could see. This makes it recoverable and,
// if it happens again, actually diagnosable from what gets logged below.
//
// The single most common real-world trigger for that exact generic message
// is a stale tab: the page was open from before a deploy, the user clicks
// something, and the client tries to fetch a JS chunk by its old build hash
// - which the new deployment no longer serves. That's not an app bug, it's
// self-resolving with a reload, so it's handled here automatically instead
// of showing the user an error at all.
export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isStaleChunk =
    error.name === "ChunkLoadError" ||
    /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message || "");

  useEffect(() => {
    console.error("[portal] client-side exception:", error, error.digest ? `digest=${error.digest}` : "");
    if (isStaleChunk) {
      // One automatic reload picks up the current deployment's chunks. Guard
      // with a query param so a genuinely persistent chunk failure doesn't
      // reload-loop the tab forever.
      const alreadyRetried = new URLSearchParams(window.location.search).has("portal_reload");
      if (!alreadyRetried) {
        const url = new URL(window.location.href);
        url.searchParams.set("portal_reload", "1");
        window.location.replace(url.toString());
      }
    }
  }, [error, isStaleChunk]);

  if (isStaleChunk) {
    return (
      <div className="portal-empty portal-action-empty" style={{ marginTop: 40 }}>
        <div className="portal-empty-icon"><RefreshCcw size={26} /></div>
        <strong>Updating…</strong>
        <span>A newer version of this page is available. Reloading automatically.</span>
      </div>
    );
  }

  return (
    <div className="portal-empty portal-action-empty" style={{ marginTop: 40 }}>
      <div className="portal-empty-icon"><AlertTriangle size={26} /></div>
      <strong>Something went wrong.</strong>
      <span>This page hit an unexpected error. Try again, or reload if it keeps happening.</span>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" className="portal-btn portal-btn-primary portal-btn-small" onClick={() => reset()}>
          Try again
        </button>
        <button type="button" className="portal-btn portal-btn-secondary portal-btn-small" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}
