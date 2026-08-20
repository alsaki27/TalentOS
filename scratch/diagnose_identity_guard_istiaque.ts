// READ-ONLY diagnostic. No writes. Run with:
//   npx tsx --env-file=.env.local scratch/diagnose_identity_guard_istiaque.ts
//
// Finds candidate "Istiaque", their base resumes, and up to 4 applications
// with a completed AI-tailored resume. For each, pulls every per-stage
// artifact (Job Lens / Resume Forge / Hiring Panel / Final Polish raw output)
// plus the final persisted application_resume_versions.content, and diffs
// personal-info / experience-identity / education-identity fields against
// the base resume that was actually used for that application.

import { query, queryOne } from "../src/server/db/neon";

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (isRec(v)) {
    for (const k of ["text", "value", "name", "label", "title"]) {
      if (typeof v[k] === "string") return (v[k] as string).trim();
    }
  }
  return "";
}
function baseHeader(baseContent: any): Rec {
  if (isRec(baseContent?.header)) return baseContent.header as Rec;
  if (isRec(baseContent?.personalInfo)) return baseContent.personalInfo as Rec;
  return {};
}
function diffField(label: string, baseVal: string, gotVal: string, out: string[]) {
  const b = baseVal.trim();
  const g = gotVal.trim();
  if (b && g && b.toLowerCase() !== g.toLowerCase()) {
    out.push(`    MISMATCH ${label}: base="${b}"  stage-output="${g}"`);
  }
}
function diffExperienceArray(label: string, baseEntries: any[], gotEntries: any[], out: string[]) {
  const gArr = Array.isArray(gotEntries) ? gotEntries : [];
  baseEntries.forEach((b, i) => {
    const bi = isRec(b) ? b : {};
    // best-effort positional compare; good enough to reveal AI drift before any guard runs
    const g = gArr[i];
    const gi = isRec(g) ? g : {};
    const tag = `${label}[${i}] "${text(bi.title)}" @ "${text(bi.company)}"`;
    diffField(`${tag} title`, text(bi.title), text(gi.title), out);
    diffField(`${tag} company`, text(bi.company), text(gi.company), out);
    diffField(`${tag} location`, text(bi.location), text(gi.location), out);
    diffField(`${tag} startDate`, text(bi.startDate), text(gi.startDate), out);
    diffField(`${tag} endDate`, text(bi.endDate), text(gi.endDate), out);
  });
  if (gArr.length !== baseEntries.length) {
    out.push(`    COUNT MISMATCH ${label}: base has ${baseEntries.length} entries, stage-output has ${gArr.length}`);
  }
}
function diffEducationArray(label: string, baseEntries: any[], gotEntries: any[], out: string[]) {
  const gArr = Array.isArray(gotEntries) ? gotEntries : [];
  baseEntries.forEach((b, i) => {
    const bi = isRec(b) ? b : {};
    const g = gArr[i];
    const gi = isRec(g) ? g : {};
    const tag = `${label}[${i}] "${text(bi.degree)}" @ "${text(bi.institution ?? bi.school)}"`;
    diffField(`${tag} degree`, text(bi.degree), text(gi.degree), out);
    diffField(`${tag} school/institution`, text(bi.institution ?? bi.school), text(gi.school ?? gi.institution), out);
    diffField(`${tag} graduationDate/Year`, text(bi.graduationYear ?? bi.graduationDate), text(gi.graduationDate ?? gi.graduationYear), out);
  });
}
function diffPersonalInfo(baseContent: any, candidatePersonalInfo: any, out: string[]) {
  const base = baseHeader(baseContent);
  const got = isRec(candidatePersonalInfo) ? candidatePersonalInfo : {};
  if (Object.keys(got).length === 0) {
    out.push(`    (no personalInfo/header field present on this stage's output — expected, agents don't carry identity data)`);
    return;
  }
  diffField("fullName/name", text(base.fullName ?? base.name), text(got.fullName ?? got.name), out);
  diffField("email", text(base.email), text(got.email), out);
  diffField("phone", text(base.phone), text(got.phone), out);
  diffField("github", text(base.github), text(got.github), out);
  diffField("linkedin", text(base.linkedin), text(got.linkedin), out);
  diffField("location", text(base.location), text(got.location), out);
}

async function main() {
  console.log("=== Candidate lookup ===");
  const candidates = await query<{ id: string; name: string }>(
    "SELECT id, name FROM candidates WHERE name ILIKE $1 ORDER BY created_at DESC",
    ["%istiaque%"]
  );
  console.log(candidates);
  if (!candidates.length) {
    console.log("No candidate matching 'istiaque' found. Trying broader search...");
    const broader = await query<{ id: string; name: string }>(
      "SELECT id, name FROM candidates WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT 20",
      ["%ist%"]
    );
    console.log(broader);
    return;
  }

  for (const cand of candidates) {
    console.log(`\n\n########## CANDIDATE: ${cand.name} (${cand.id}) ##########`);

    const baseResumes = await query<{ id: string; content: any; created_at: string; updated_at: string }>(
      "SELECT id, content, created_at, updated_at FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC",
      [cand.id]
    );
    console.log(`\n-- Base resumes (${baseResumes.length}) --`);
    for (const br of baseResumes) {
      const hdr = isRec(br.content) ? (br.content as any).header ?? (br.content as any).personalInfo : null;
      const label = isRec(hdr) ? (hdr.fullName ?? hdr.name ?? "") : "";
      console.log(`  ${br.id}  header/personalInfo.fullName="${label}"  created=${br.created_at}  updated=${br.updated_at}`);
    }

    const apps = await query<any>(
      `SELECT a.id as application_id, a.job_id, a.base_resume_id, a.ai_workflow_id,
              a.tailored_resume_version_id, a.resume_generation_status, a.created_at,
              j.title as job_title, j.company
       FROM applications a
       LEFT JOIN jobs j ON j.id = a.job_id
       WHERE a.candidate_id = $1 AND a.tailored_resume_version_id IS NOT NULL
       ORDER BY a.created_at DESC
       LIMIT 4`,
      [cand.id]
    );
    console.log(`\n-- Applications with a tailored resume (${apps.length}, showing up to 4) --`);

    for (const app of apps) {
      console.log(`\n  === Application ${app.application_id} — "${app.job_title}" @ ${app.company} (status: ${app.resume_generation_status}) ===`);
      console.log(`  base_resume_id used for this run: ${app.base_resume_id}`);

      const baseRow = app.base_resume_id
        ? await queryOne<{ content: any }>("SELECT content FROM base_resumes WHERE id = $1", [app.base_resume_id])
        : null;
      const baseContent = baseRow?.content ?? null;
      if (!baseContent) {
        console.log("  (could not resolve base resume content for this application — skipping diff)");
        continue;
      }
      const baseExperience: any[] = Array.isArray(baseContent.experience) ? baseContent.experience : [];
      const baseEducation: any[] = Array.isArray(baseContent.education) ? baseContent.education : [];

      if (!app.ai_workflow_id) {
        console.log("  (no ai_workflow_id on this application — tailored resume predates the multi-agent pipeline or was created another way)");
      } else {
        const artifacts = await query<{ automation_id: string; sequence_number: number; data: any; created_at: string }>(
          "SELECT automation_id, sequence_number, data, created_at FROM application_ai_artifacts WHERE workflow_id = $1 ORDER BY sequence_number ASC",
          [app.ai_workflow_id]
        );
        console.log(`  -- Per-stage artifacts (${artifacts.length}) --`);
        for (const art of artifacts) {
          console.log(`\n   [Stage: ${art.automation_id} — seq ${art.sequence_number} — ${art.created_at}]`);
          const out: string[] = [];
          const d = art.data ?? {};
          if (Array.isArray((d as any).experience)) diffExperienceArray("experience", baseExperience, (d as any).experience, out);
          if (Array.isArray((d as any).education)) diffEducationArray("education", baseEducation, (d as any).education, out);
          if ("personalInfo" in (d as any) || "header" in (d as any)) {
            diffPersonalInfo(baseContent, (d as any).personalInfo ?? (d as any).header, out);
          }
          if (out.length === 0) {
            console.log("    no identity-field mismatch found in this stage's RAW output vs base resume");
          } else {
            out.forEach((line) => console.log(line));
          }
        }
      }

      // Final persisted resume
      const finalVersion = await queryOne<{ content: any }>(
        "SELECT content FROM application_resume_versions WHERE id = $1",
        [app.tailored_resume_version_id]
      );
      console.log(`\n   [FINAL PERSISTED application_resume_versions row ${app.tailored_resume_version_id}]`);
      const out: string[] = [];
      const doc = finalVersion?.content ?? {};
      const docExperience = Array.isArray((doc as any).experience) ? (doc as any).experience : [];
      const docEducation = Array.isArray((doc as any).education) ? (doc as any).education : [];
      diffExperienceArray("experience", baseExperience, docExperience, out);
      diffEducationArray("education", baseEducation, docEducation, out);
      diffPersonalInfo(baseContent, (doc as any).header ?? (doc as any).personalInfo, out);
      if (out.length === 0) {
        console.log("    FINAL DOCUMENT MATCHES BASE RESUME on all checked identity fields.");
      } else {
        out.forEach((line) => console.log(line));
      }
    }
  }
}

main().catch((err) => {
  console.error("Diagnostic script failed:", err);
  process.exit(1);
});
