// Client helper: every "open in studio" entry point across the app now
// routes through here to the Resumify-based chatbot studio
// (/falood/studio/tailor/[id]) instead of the old
// /falood/studio/application/[id] and /falood/studio/base/[id] pages.
// Bridges real data in via POST /api/falood/applications/from-source first,
// since the tailor studio's backing table has no link to
// candidates/applications/base_resumes on its own.

export type StudioSource = "application_resume_version" | "base_resume";

async function bridgeToTailorStudio(source: StudioSource, id: string): Promise<string> {
  const res = await fetch("/api/falood/applications/from-source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? "Failed to open studio");
  const params = new URLSearchParams();
  if (data.jobTitle) params.set("jobTitle", data.jobTitle);
  if (data.companyName) params.set("company", data.companyName);
  const qs = params.toString();
  return `/falood/studio/tailor/${data.id}${qs ? `?${qs}` : ""}`;
}

/** Opens the tailor studio in a new tab for the given source record. */
export async function openFaloodStudio(source: StudioSource, id: string): Promise<void> {
  try {
    const url = await bridgeToTailorStudio(source, id);
    window.open(url, "_blank");
  } catch (err: any) {
    alert(err?.message ?? "Failed to open studio");
  }
}

/** Resolves the tailor studio URL for the given source record, for callers that navigate via router.push. */
export async function resolveFaloodStudioUrl(source: StudioSource, id: string): Promise<string> {
  return bridgeToTailorStudio(source, id);
}
