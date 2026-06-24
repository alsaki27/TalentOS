"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ResumeCliEditor from "@/components/ResumeCliEditor";
import type { ResumeDocument } from "@/lib/falood/types";

interface BaseResume {
  id: string;
  candidate_id: string;
  name: string;
  content: ResumeDocument;
  status: string;
}

interface ApplicationResumeVersion {
  id: string;
  candidate_id: string;
  base_resume_id: string;
  target_job_id: string;
  status: string;
  content: ResumeDocument;
  updated_at: string;
}

function CliEditorPage() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type") as "base" | "application" | null;
  const id = searchParams.get("id");

  const [content, setContent] = useState<ResumeDocument | null>(null);
  const [originalContent, setOriginalContent] = useState<ResumeDocument | null>(null);
  const [title, setTitle] = useState("Resume Editor");
  const [backLink, setBackLink] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");

  useEffect(() => {
    if (!id || !type) {
      setLoading(false);
      setError("Missing query parameters. Expected ?type=base|application&id=xxx");
      return;
    }

    async function load() {
      setLoading(true);
      setError("");
      try {
        const endpoint =
          type === "base"
            ? `/api/base-resumes/${id}`
            : `/api/application-resume-versions/${id}`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error("Failed to load resume");
        const data = await res.json();

        if (type === "base") {
          const br = data as BaseResume;
          setContent(br.content);
          setOriginalContent(JSON.parse(JSON.stringify(br.content)));
          setTitle(br.name);
          setBackLink(`/falood/studio/base/${br.id}`);
        } else {
          const ar = data as ApplicationResumeVersion;
          setContent(ar.content);
          setOriginalContent(JSON.parse(JSON.stringify(ar.content)));
          setTitle(`Application Resume — ${ar.status}`);
          setBackLink(`/falood/studio/application/${ar.id}`);
        }
      } catch (e: any) {
        setError(e.message || "Failed to load resume");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id, type]);

  async function handleSave(newContent: ResumeDocument) {
    if (!id || !type) return;
    setSaveStatus("saving");
    setError("");
    try {
      const endpoint =
        type === "base"
          ? `/api/base-resumes/${id}`
          : `/api/application-resume-versions/${id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Save failed");
      }
      const data = await res.json();
      const savedContent =
        type === "base"
          ? (data as BaseResume).content
          : (data as ApplicationResumeVersion).content;
      setContent(savedContent);
      setOriginalContent(JSON.parse(JSON.stringify(savedContent)));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (e: any) {
      setError(e.message || "Save failed");
      setSaveStatus("error");
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loading-panel">Loading CLI editor…</div>
      </div>
    );
  }

  if (error || !content || !originalContent) {
    return (
      <div className="page">
        <div className="toast toast-error">{error || "Unable to load resume data."}</div>
        <div className="flex gap-2 mt-4">
          <Link href="/falood" className="btn">
            ← Falood Home
          </Link>
          <button className="btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <ResumeCliEditor
      initialContent={content}
      originalContent={originalContent}
      onSave={handleSave}
      saveStatus={saveStatus}
      title={title}
      backLink={backLink}
      pageType={type ?? "base"}
    />
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="page">
          <div className="loading-panel">Loading CLI editor…</div>
        </div>
      }
    >
      <CliEditorPage />
    </Suspense>
  );
}
