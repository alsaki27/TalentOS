"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, ShieldAlert } from "lucide-react";

interface Props {
  pdfUrl: string;
  title: string;
  /** Shown in the tiled watermark so any capture is attributable to a person. */
  viewerLabel: string;
  onClose: () => void;
}

// Screen-capture deterrence for the in-page PDF viewer.
//
// IMPORTANT, and deliberately not overstated anywhere in the UI: no web page
// can actually *prevent* an operating-system screenshot. There is no browser
// API for it. Print Screen, the Windows Snipping Tool, macOS Cmd+Shift+4,
// phone screenshots, OBS and a phone camera pointed at the monitor all operate
// below the browser and cannot be intercepted by page JavaScript. The only web
// mechanism that truly blocks capture is DRM-protected <video> via EME/HDCP,
// which applies to protected media streams, not to documents.
//
// So this layer does what document-security products actually do:
//   1. Deter the easy paths - Print Screen, right-click, drag-out, Ctrl+P.
//   2. Blank the content whenever the page is not the user's focused,
//      visible surface, which is when most capture utilities and overlays
//      take over.
//   3. Make any capture that does get through *attributable*, by tiling the
//      viewer's identity and a timestamp across the document.
// (3) is the part that carries real weight; (1) and (2) raise the effort.
export default function ResumePdfModal({ pdfUrl, title, viewerLabel, onClose }: Props) {
  const [obscured, setObscured] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const conceal = useCallback(() => setObscured(true), []);
  const reveal = useCallback(() => setObscured(false), []);

  useEffect(() => {
    // Lock background scroll while the modal owns the screen.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const onVisibility = () => (document.hidden ? conceal() : reveal());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      // Ctrl/Cmd+P (print to PDF) and Ctrl/Cmd+S (save) are capture paths too.
      const meta = event.ctrlKey || event.metaKey;
      if (meta && ["p", "s"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        conceal();
        window.setTimeout(reveal, 1200);
      }
      if (event.key === "PrintScreen") conceal();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "PrintScreen") return;
      // The screenshot is already taken by the time this fires; overwriting
      // the clipboard is a best-effort spoil of the copied image, and only
      // works where the document has clipboard permission.
      navigator.clipboard?.writeText("").catch(() => undefined);
      conceal();
      window.setTimeout(reveal, 1200);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", conceal);
    window.addEventListener("focus", reveal);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", conceal);
      window.removeEventListener("focus", reveal);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [conceal, reveal, onClose]);

  const watermark = `${viewerLabel} · ${new Date().toLocaleString()}`;

  return (
    <div className="portal-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="portal-modal portal-modal-protected"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — protected preview`}
        ref={dialogRef}
        tabIndex={-1}
        onContextMenu={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
      >
        <header className="portal-modal-header">
          <div className="portal-modal-heading">
            <h2>{title}</h2>
            <p><ShieldAlert size={12} aria-hidden="true" /> Protected preview · view only</p>
          </div>
          <button type="button" className="portal-icon-btn" onClick={onClose} aria-label="Close preview">
            <X size={17} />
          </button>
        </header>

        <div className="portal-modal-body">
          {/* #toolbar=0 hides the built-in PDF viewer's download/print controls
              in Chromium's viewer (a PDF Open Parameter; Firefox's pdf.js
              ignores it, hence the layers above rather than relying on it). */}
          <iframe
            className="portal-pdf-frame"
            src={`${pdfUrl}#toolbar=0&navpanes=0&statusbar=0`}
            title={`${title} preview`}
          />
          <div className="portal-pdf-watermark" aria-hidden="true">
            {Array.from({ length: 36 }).map((_, index) => <span key={index}>{watermark}</span>)}
          </div>
          {obscured && (
            <div className="portal-pdf-blackout" role="status">
              <ShieldAlert size={26} aria-hidden="true" />
              <strong>Preview hidden</strong>
              <span>The document is only shown while this window is focused.</span>
            </div>
          )}
        </div>

        <footer className="portal-modal-footer">
          This tailored resume is confidential and view-only. Copies are watermarked with your name and the time you opened it.
        </footer>
      </div>
    </div>
  );
}
