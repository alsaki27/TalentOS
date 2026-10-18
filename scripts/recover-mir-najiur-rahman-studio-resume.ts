// One-off recovery for a specific falood_saved_applications row that got
// blanked by the exit-flush race (see AGENTS.md / the fix in
// src/app/falood/studio/tailor/[id]/page.tsx for the root cause).
//
// Restores it using the EXACT same conversion path the app itself uses to
// seed a Studio session in the first place (POST /api/falood/applications/
// from-source): application_resume_versions.content -> parse ->
// studioDocumentToResumeData(). This is not a guess at the old content - the
// pipeline's own tailored/applied resume (application_resume_versions,
// immutable, never touched by this bug) is still fully intact and is the
// authoritative source.
//
// Guarded: only writes if the target row's resume_data is still the blank
// shape right now, so this is safe to re-run and can never clobber a
// legitimate newer edit.
//
// Usage: npx tsx --env-file=.env scripts/recover-mir-najiur-rahman-studio-resume.ts

import { query, queryOne, execute } from "../src/server/db/neon";
import { studioDocumentToResumeData } from "../src/lib/falood/studioDocumentToResumeData";

const SAVED_APPLICATION_ID = "f321a025-4832-46a8-a357-38bc76a0dafe";
const SOURCE_RESUME_VERSION_ID = "63cf0923-f430-4fa8-b173-20ea50547bdc";

function isEffectivelyEmpty(data: any): boolean {
  if (!data) return true;
  const hasName = !!(data.personalInfo?.fullName || "").trim();
  const hasSummary = !!(data.summary || "").trim();
  const hasExperience = Array.isArray(data.experience) && data.experience.length > 0;
  return !hasName && !hasSummary && !hasExperience;
}

async function main() {
  const current = await queryOne<{ id: string; name: string; resume_data: any; candidate_id: string | null }>(
    `SELECT id, name, resume_data, candidate_id FROM falood_saved_applications WHERE id = $1`,
    [SAVED_APPLICATION_ID]
  );
  if (!current) throw new Error(`falood_saved_applications row ${SAVED_APPLICATION_ID} not found`);

  console.log("Current row name:", current.name);
  const currentData = typeof current.resume_data === "string" ? JSON.parse(current.resume_data) : current.resume_data;
  if (!isEffectivelyEmpty(currentData)) {
    console.log("Current resume_data is NOT blank - someone may have already recovered or edited it. Aborting without changes.");
    console.log("Current fullName:", currentData?.personalInfo?.fullName, "| experience entries:", currentData?.experience?.length);
    return;
  }
  console.log("Confirmed: current resume_data is blank (matches the reported bug). Proceeding with recovery.");

  const source = await queryOne<{ content: any }>(
    `SELECT content FROM application_resume_versions WHERE id = $1`,
    [SOURCE_RESUME_VERSION_ID]
  );
  if (!source) throw new Error(`application_resume_versions row ${SOURCE_RESUME_VERSION_ID} not found`);

  const parsedContent = typeof source.content === "string" ? JSON.parse(source.content) : source.content;
  const resumeData = studioDocumentToResumeData(parsedContent);

  if (isEffectivelyEmpty(resumeData)) {
    throw new Error("Converted resumeData is ALSO empty - the source application_resume_versions row may itself be damaged. Stopping before writing anything.");
  }

  console.log("\nConverted resume preview:");
  console.log("  fullName:", resumeData.personalInfo.fullName);
  console.log("  jobTitle:", resumeData.personalInfo.jobTitle);
  console.log("  summary:", resumeData.summary?.slice(0, 80));
  console.log("  experience entries:", resumeData.experience.length);
  console.log("  education entries:", resumeData.education.length);

  await execute(
    `UPDATE falood_saved_applications SET resume_data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(resumeData), SAVED_APPLICATION_ID]
  );

  const verify = await queryOne<{ resume_data: any; updated_at: string }>(
    `SELECT resume_data, updated_at FROM falood_saved_applications WHERE id = $1`,
    [SAVED_APPLICATION_ID]
  );
  const verifyData = typeof verify?.resume_data === "string" ? JSON.parse(verify.resume_data) : verify?.resume_data;
  console.log("\nVerified after write - fullName:", verifyData?.personalInfo?.fullName, "| experience entries:", verifyData?.experience?.length, "| updated_at:", verify?.updated_at);
  console.log("\nDone. The Studio session now matches the reviewed/applied pipeline resume.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Recovery failed:", err);
  process.exit(1);
});
