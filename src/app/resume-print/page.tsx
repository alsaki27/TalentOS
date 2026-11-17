"use client";

import { useEffect, useState } from "react";
import { ResumePreview } from "@/components/falood/resumify/components/preview/ResumePreview";
import { ResumeProvider } from "@/components/falood/resumify/contexts/ResumeContext";
import type { ResumeData } from "@/components/falood/resumify/types/resume";

declare global {
  interface Window {
    loadResumeForPrint?: (resume: ResumeData) => void;
  }
}

// The authenticated approval request supplies the saved snapshot in browser
// memory. This page has no resume lookup, URL payload, or persisted state.
export default function ResumePrintPage() {
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    window.loadResumeForPrint = setResume;
    return () => { delete window.loadResumeForPrint; };
  }, []);

  if (!resume) return null;
  return (
    <div id="resume-print-area" data-studio-pages={pageCount} style={{ height: "100vh" }}>
      <ResumeProvider initialResume={resume}>
        <ResumePreview onPageCountChange={setPageCount} />
      </ResumeProvider>
    </div>
  );
}
