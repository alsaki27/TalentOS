"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type BridgeResponse = {
  id?: string;
  jobTitle?: string;
  companyName?: string;
  error?: string;
};

/**
 * Opens an application resume version in the current Falood tailor studio.
 * The CRM stores application_resume_versions ids, while the tailor studio
 * loads falood_saved_applications ids, so the existing bridge must run first.
 */
export default function OpenApplicationResumeVersionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const resumeVersionId = typeof params?.id === "string" ? params.id : "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const openStudio = async () => {
      if (!resumeVersionId) {
        setError("A tailored resume version was not provided.");
        return;
      }

      try {
        const response = await fetch("/api/falood/applications/from-source", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "application_resume_version",
            id: resumeVersionId,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as BridgeResponse;
        if (!response.ok || !data.id) {
          throw new Error(data.error || "Unable to open the tailored resume.");
        }

        const searchParams = new URLSearchParams();
        if (data.jobTitle) searchParams.set("jobTitle", data.jobTitle);
        if (data.companyName) searchParams.set("company", data.companyName);
        const query = searchParams.toString();
        if (!cancelled) {
          router.replace(`/falood/studio/tailor/${encodeURIComponent(data.id)}${query ? `?${query}` : ""}`);
        }
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to open the tailored resume.");
        }
      }
    };

    void openStudio();
    return () => {
      cancelled = true;
    };
  }, [resumeVersionId, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 px-6 py-7 shadow-2xl">
        <p className="text-lg font-semibold">Opening the updated Falood resume builder</p>
        {error ? (
          <p className="mt-3 text-sm leading-6 text-rose-300">{error}</p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-300">Loading the current tailored resume and job context…</p>
        )}
      </div>
    </main>
  );
}
