// Client helper: every "open in studio" entry point routes through here to
// the Resumify-based chatbot studio (/falood/studio/tailor/[id]).

export type StudioSource = "application_resume_version" | "base_resume";

function currentPagePath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Reject external or malformed return URLs before using them in Studio navigation. */
export function safeStudioReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/falood";
  }

  try {
    const url = new URL(value, "https://talentos.invalid");
    if (url.origin !== "https://talentos.invalid") return "/falood";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/falood";
  }
}

async function bridgeToTailorStudio(source: StudioSource, id: string, returnTo: string): Promise<string> {
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
  params.set("returnTo", returnTo);
  return `/falood/studio/tailor/${encodeURIComponent(data.id)}?${params.toString()}`;
}

/** Opens the tailor studio in a new tab whose browser history returns to this page. */
export async function openFaloodStudio(source: StudioSource, id: string): Promise<void> {
  const returnTo = currentPagePath();
  // Start the new tab on the source URL synchronously. Navigating it to Studio
  // after the bridge completes gives that tab a real, context-specific Back entry.
  const studioTab = window.open(returnTo, "_blank");
  if (!studioTab) {
    alert("Allow pop-ups for TalentOS to open Resume Studio in a new tab.");
    return;
  }

  try {
    const url = await bridgeToTailorStudio(source, id, returnTo);
    studioTab.location.assign(url);
  } catch (err: any) {
    studioTab.close();
    alert(err?.message ?? "Failed to open studio");
  }
}

/** Opens an existing Falood saved session in a new tab with source-page history. */
export function openFaloodSavedApplicationStudio(id: string): void {
  const returnTo = currentPagePath();
  const studioTab = window.open(returnTo, "_blank");
  if (!studioTab) {
    alert("Allow pop-ups for TalentOS to open Resume Studio in a new tab.");
    return;
  }

  const params = new URLSearchParams({ returnTo });
  studioTab.location.assign(`/falood/studio/tailor/${encodeURIComponent(id)}?${params.toString()}`);
}

/** Resolves a tailor-studio URL for callers that navigate with router.push. */
export async function resolveFaloodStudioUrl(source: StudioSource, id: string): Promise<string> {
  return bridgeToTailorStudio(source, id, currentPagePath());
}
