// Independent, final identity-integrity check + repair for a persisted
// tailored resume. Deliberately written independently of resumeIntegrity.ts's
// enforceExperienceIntegrity/enforceEducationIntegrity (which already run
// after Resume Forge, after Final Polish, and again at finalization) rather
// than calling that same code a 4th time - the point of this layer is to
// catch a bug IN that logic, or a base_resumes.content change made between
// finalization and whenever this runs, not to re-trust the same function by
// construction. Called once, live, at the end of finalizeWorkflow(); also
// safe to call standalone (e.g. from an audit script) against any resume
// version id, in dry-run mode.
//
// Compares the PERSISTED application_resume_versions row against the CURRENT
// (live) base_resumes row on exactly the fields that must never be
// AI-authored: header/personalInfo (fullName, email, phone, github,
// linkedin, location), each experience entry's title/company/location/
// startDate, and each education entry's degree/school/graduationDate. Any
// mismatch is repaired in place. Never touches bullets, skills, summary, or
// projects - those are legitimately AI-authored content, not identity facts.
// Experience/education COUNT mismatches are reported but never
// auto-repaired (that needs a human - see mismatches in the result).

import { queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export interface IdentityAuditResult {
  checked: boolean;
  changed: boolean;
  mismatches: string[];
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function readText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isRec(v)) {
    for (const key of ["text", "value", "name", "label", "title"]) {
      const nested = v[key];
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return "";
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase("en-US") === b.trim().toLocaleLowerCase("en-US");
}

function baseHeader(baseContent: any): Rec {
  if (isRec(baseContent?.header) && readText((baseContent.header as Rec).fullName)) return baseContent.header as Rec;
  if (isRec(baseContent?.personalInfo)) return baseContent.personalInfo as Rec;
  return {};
}

/**
 * Audits (and, unless dryRun, repairs) one persisted resume version against
 * its base resume. Returns { checked: false } if either row can't be
 * resolved (nothing to compare against - not an error, just a no-op).
 */
export async function auditAndRepairResumeVersionIdentity(
  resumeVersionId: string,
  opts: { dryRun?: boolean } = {}
): Promise<IdentityAuditResult> {
  const dryRun = opts.dryRun ?? false;

  const version = await queryOne<{ content: any; base_resume_id: string | null; application_id: string | null }>(
    "SELECT content, base_resume_id, application_id FROM application_resume_versions WHERE id = $1",
    [resumeVersionId]
  );
  if (!version || !version.base_resume_id) {
    return { checked: false, changed: false, mismatches: [] };
  }
  const baseRow = await queryOne<{ content: any }>(
    "SELECT content FROM base_resumes WHERE id = $1",
    [version.base_resume_id]
  );
  const baseContent = baseRow?.content;
  if (!isRec(baseContent)) {
    return { checked: false, changed: false, mismatches: [] };
  }

  const doc: Rec = isRec(version.content) ? { ...version.content } : {};
  const mismatches: string[] = [];
  let changed = false;

  // ── header / personalInfo ──
  const base = baseHeader(baseContent);
  const correctHeader: Rec = {
    fullName: readText(base.fullName ?? base.name),
    email: readText(base.email),
    phone: readText(base.phone),
    github: readText(base.github),
    linkedin: readText(base.linkedin),
    location: readText(base.location),
  };
  const docHeader: Rec = isRec(doc.header) ? doc.header : {};
  const nextHeader: Rec = { ...docHeader };
  for (const field of ["fullName", "email", "phone", "github", "linkedin", "location"] as const) {
    const want = readText(correctHeader[field]);
    const have = readText(docHeader[field]);
    if (want && !sameText(want, have)) {
      mismatches.push(`header.${field}: had "${have}", restored "${want}"`);
      nextHeader[field] = want;
      changed = true;
    }
  }
  if (changed) doc.header = nextHeader;

  // ── experience identity ──
  const baseExperience: unknown[] = Array.isArray(baseContent.experience) ? (baseContent.experience as unknown[]) : [];
  const docExperience: unknown[] = Array.isArray(doc.experience) ? (doc.experience as unknown[]) : [];
  if (baseExperience.length > 0) {
    if (docExperience.length !== baseExperience.length) {
      mismatches.push(
        `experience count: base has ${baseExperience.length}, resume has ${docExperience.length} (not auto-repaired - needs human review)`
      );
    } else {
      const nextExperience = docExperience.map((entry, i) => (isRec(entry) ? { ...entry } : {}));
      baseExperience.forEach((b, i) => {
        const bi: Rec = isRec(b) ? b : {};
        const gi: Rec = isRec(docExperience[i]) ? (docExperience[i] as Rec) : {};
        const checks: [string, string][] = [
          ["title", readText(bi.title)],
          ["company", readText(bi.company)],
          ["location", readText(bi.location)],
          ["startDate", readText(bi.startDate)],
        ];
        for (const [field, want] of checks) {
          const have = readText((gi as Rec)[field]);
          if (want && !sameText(want, have)) {
            mismatches.push(`experience[${i}].${field}: had "${have}", restored "${want}"`);
            (nextExperience[i] as Rec)[field] = want;
            changed = true;
          }
        }
      });
      if (changed) doc.experience = nextExperience;
    }
  }

  // ── education identity ──
  const baseEducation: unknown[] = Array.isArray(baseContent.education) ? (baseContent.education as unknown[]) : [];
  const docEducation: unknown[] = Array.isArray(doc.education) ? (doc.education as unknown[]) : [];
  if (baseEducation.length > 0) {
    if (docEducation.length !== baseEducation.length) {
      mismatches.push(
        `education count: base has ${baseEducation.length}, resume has ${docEducation.length} (not auto-repaired - needs human review)`
      );
    } else {
      const nextEducation = docEducation.map((entry) => (isRec(entry) ? { ...entry } : {}));
      baseEducation.forEach((b, i) => {
        const bi: Rec = isRec(b) ? b : {};
        const gi: Rec = isRec(docEducation[i]) ? (docEducation[i] as Rec) : {};
        const wantDegree = readText(bi.degree);
        const wantSchool = readText(bi.institution ?? bi.school);
        const wantGrad = readText(bi.graduationYear ?? bi.graduationDate);
        if (wantDegree && !sameText(wantDegree, readText(gi.degree))) {
          mismatches.push(`education[${i}].degree: had "${readText(gi.degree)}", restored "${wantDegree}"`);
          (nextEducation[i] as Rec).degree = wantDegree;
          changed = true;
        }
        if (wantSchool && !sameText(wantSchool, readText(gi.school))) {
          mismatches.push(`education[${i}].school: had "${readText(gi.school)}", restored "${wantSchool}"`);
          (nextEducation[i] as Rec).school = wantSchool;
          changed = true;
        }
        if (wantGrad && !sameText(wantGrad, readText(gi.graduationDate))) {
          mismatches.push(`education[${i}].graduationDate: had "${readText(gi.graduationDate)}", restored "${wantGrad}"`);
          (nextEducation[i] as Rec).graduationDate = wantGrad;
          changed = true;
        }
      });
      if (changed) doc.education = nextEducation;
    }
  }

  if (!changed) {
    return { checked: true, changed: false, mismatches: [] };
  }
  if (dryRun) {
    return { checked: true, changed: true, mismatches };
  }

  await execute(
    "UPDATE application_resume_versions SET content = $1::jsonb, updated_at = NOW() WHERE id = $2",
    [JSON.stringify(doc), resumeVersionId]
  );

  await logActivity({
    userId: undefined,
    actorName: "Identity Audit (post-finalization)",
    type: "update",
    description: `Repaired ${mismatches.length} identity-field mismatch(es) on the persisted resume`,
    entityType: "application",
    entityId: version.application_id ?? resumeVersionId,
    entityName: `Resume version ${resumeVersionId}`,
    metadata: { resumeVersionId, mismatches },
  }).catch((err: any) => {
    console.error("[postFinalizeIdentityAudit] Activity log failed (non-critical):", err?.message || err);
  });

  return { checked: true, changed: true, mismatches };
}
