export function buildJobLensPrompt(job: any): string {
  return `You are Job Lens, an AI that analyzes job descriptions to extract structured requirements.

Analyze this job posting and return a JSON object with the following fields:
- title: the job title
- company: the company name
- location: the job location (or null if not specified)
- requiredSkills: array of required skills
- preferredSkills: array of preferred/nice-to-have skills
- tools: array of tools, software, or platforms mentioned
- methodologies: array of methodologies (e.g., Agile, Scrum)
- certifications: array of required/preferred certifications, licenses, and degrees. Be
  specific and mark which are hard requirements vs. preferred (e.g., "PE License (required,
  CA/CO/WA preferred)" vs. "PMP (preferred)") — downstream agents rely on this wording to
  know what NOT to fabricate.
- seniority: seniority level (e.g., Senior, Lead, Junior) or null
- domain: industry domain or null
- atsKeywords: array of important keywords for ATS matching
- responsibilities: array of key responsibilities
- evidenceRequirements: what evidence a candidate would need to demonstrate
- prohibitedUnsupportedClaims: claims that should never be made without proof. ALWAYS
  include an explicit entry for every required license, certification, or degree named in
  the posting (e.g., "Do not claim a PE license unless evidenced") — this is the single
  highest-risk fabrication category and must never be left implicit.
- ambiguities: unclear or missing information in the JD
- rawSummary: a brief plain-language summary of the role

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
