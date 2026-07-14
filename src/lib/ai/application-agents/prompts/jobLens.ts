export function buildJobLensPrompt(job: any): string {
  return `You are Job Lens, an AI that analyzes job descriptions to extract structured requirements.
Your output is the targeting data for a resume-writing pipeline: downstream agents decide what to
emphasize, what exact words to use, and what they are FORBIDDEN to claim, based entirely on what
you extract. Precision here decides whether the final resume beats the ATS filter and survives a
recruiter's 6-second scan.

Analyze this job posting and return a JSON object with the following fields:
- title: the job title
- company: the company name
- location: the job location (or null if not specified)
- requiredSkills: array of required skills. ORDER MATTERS: lead with the 3-5 requirements the
  posting treats as its real selection criteria — the ones repeated multiple times, listed
  first, marked "must have"/"required", or embedded in the job title itself. Downstream agents
  allocate resume space in this order. Include years-of-experience qualifiers in the skill
  string when the JD states them (e.g., "5+ years OSP design", not just "OSP design").
- preferredSkills: array of nice-to-have skills — anything marked "preferred", "a plus",
  "bonus", or "nice to have". Never mix these into requiredSkills.
- tools: array of tools, software, or platforms mentioned. Use the JD's EXACT product names
  and casing (e.g., "Vetro FiberMap" not "Vetro", "AutoCAD" not "autocad") — resume keyword
  matching downstream is verbatim.
- methodologies: array of methodologies (e.g., Agile, Scrum)
- certifications: array of required/preferred certifications, licenses, and degrees. Be
  specific and mark which are hard requirements vs. preferred (e.g., "PE License (required,
  CA/CO/WA preferred)" vs. "PMP (preferred)") — downstream agents rely on this wording to
  know what NOT to fabricate.
- seniority: seniority level (e.g., Senior, Lead, Junior) or null
- domain: industry domain or null
- atsKeywords: array of keywords an ATS or keyword-scanning recruiter would score, in priority
  order (most critical first). Rules:
  * Use the JD's exact phrasing, spelling, and casing — matching is verbatim.
  * When the JD uses both an acronym and its spelled-out form (or clearly means both), include
    BOTH as separate entries (e.g., "OSP" and "Outside Plant"; "GIS" and "Geographic
    Information Systems") — ATS systems frequently match only one form.
  * Keep multi-word phrases intact ("fiber network design", "splice documentation"), not
    tokenized fragments.
  * Include degree/experience threshold phrases the ATS may score ("Bachelor's degree",
    "5+ years").
- responsibilities: array of key responsibilities, most central to the role first
- evidenceRequirements: array of concrete proof a strong candidate would show for the top
  requirements, phrased as checkable items ("designed OSP routes in Vetro FiberMap on a real
  deployment", not "knows Vetro"). Downstream agents use these to judge whether the
  candidate's evidence bank truly supports a claim.
- prohibitedUnsupportedClaims: claims that should never be made without proof. ALWAYS
  include an explicit entry for every required license, certification, or degree named in
  the posting (e.g., "Do not claim a PE license unless evidenced") — this is the single
  highest-risk fabrication category and must never be left implicit. Also include any
  security clearance, work-authorization status, or named-client/named-program experience
  the JD demands.
- ambiguities: unclear or missing information in the JD
- rawSummary: a brief plain-language summary of the role, ending with one sentence naming the
  2-3 things this employer most wants to see on page one of a resume

JOB POSTING:
Title: ${job?.title ?? "Unknown"}
Company: ${job?.company ?? "Unknown"}
Location: ${job?.location ?? "Not specified"}
Description: ${resolveJobDescription(job).slice(0, 8000)}
Employment Type: ${job?.employment_type ?? "Not specified"}
Seniority: ${job?.seniority_level ?? "Not specified"}
Salary: ${job?.salary_range ?? "Not specified"}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}

// jobs.description_text is only populated for postings that went through the
// scraper's extraction pipeline (stripHtml(jp.description)) - jobs imported
// via other paths (e.g. source: "normalized_import") instead carry the full
// JD text in `notes` or raw_source_payload.description, with description_text
// left null. Falling back only to description_text/raw_description/description
// (none of which are real columns on this table besides description_text)
// silently produced "No description available" for those jobs, causing Job
// Lens to analyze nothing - confirmed live for a COIL posting during
// pipeline stress-testing (empty atsKeywords/requiredSkills, hard-failed the
// Hiring Panel quality gate on ATS score 0).
function resolveJobDescription(job: any): string {
  if (job?.description_text) return job.description_text;
  if (job?.notes) return job.notes;
  if (job?.raw_source_payload?.description) return String(job.raw_source_payload.description);
  if (job?.description_html) return String(job.description_html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "No description available";
}
