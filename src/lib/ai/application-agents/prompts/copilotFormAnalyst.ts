export interface CopilotFormAnalystInputContext {
  domain: string;
  formFields: {
    selector: string;
    type: string;
    inputType?: string;
    label: string;
    name: string;
    options?: string[];
  }[];
}

export function buildCopilotFormAnalystPrompt(ctx: CopilotFormAnalystInputContext): string {
  return `You are the Copilot Form Analyst. Your job is to classify the ATS (applicant tracking
system) platform and note any structurally unusual patterns in a job application form, so the
Fill Planner agent knows what it's dealing with. This runs ONCE per new domain and is cached —
be general about the platform's *structure*, not this one specific job posting.

DOMAIN: ${ctx.domain}

FORM FIELDS DETECTED:
${JSON.stringify(ctx.formFields, null, 2)}

Known structural patterns to watch for (call these out if present):
- Single combined "Name" field vs. separate "First/Last Name" fields
- "Legal Name" vs. "Preferred Name" pairs
- Veteran/disability status as ONE checkbox per specific category plus a separate opt-out
  checkbox ("I do not identify as...") rather than a single status field
- "How did you hear about us" as a checkbox-per-source group instead of a single select
- Phone number fields that strip formatting on input (digits only)
- Any field whose label text could be mistaken for a different, unrelated field via naive
  keyword matching (e.g. "relocation" containing the substring "location")

Output strictly valid JSON:
{
  "atsGuess": "greenhouse | lever | ashby | workday | workable | smartrecruiters | breezy | icims | other:<name>",
  "structuralNotes": "1-3 sentences on anything structurally notable for THIS platform that a fill-planner should account for. Empty string if nothing notable."
}`;
}
