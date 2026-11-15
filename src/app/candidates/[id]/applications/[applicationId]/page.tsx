import CandidateApplicationWorkspace from "@/components/candidates/CandidateApplicationWorkspace";

export default function CandidateApplicationPage({ params, searchParams }: {
  params: { id: string; applicationId: string };
  searchParams: { from?: string | string[]; tab?: string | string[] };
}) {
  const filters = new URLSearchParams(typeof searchParams.from === "string" ? searchParams.from : "");
  const backQuery = new URLSearchParams();
  for (const key of ["statusGroup", "search", "source", "sort", "order", "page"]) {
    const value = filters.get(key);
    if (value) backQuery.set(key, value);
  }
  const backFilters = backQuery.toString();
  if (searchParams.tab === "Custom Interview" || filters.get("tab") === "Custom Interview") {
    backQuery.set("tab", "Custom Interview");
  }
  const backHref = "/candidates/" + params.id + (backQuery.size ? "?" + backQuery.toString() : "");
  return <CandidateApplicationWorkspace key={params.applicationId} candidateId={params.id} applicationId={params.applicationId} backHref={backHref} />;
}
