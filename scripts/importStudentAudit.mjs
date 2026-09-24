// Historical, one-time import: copied the Skarion Student Audit roster
// (students + sticky_notes) from the separate candidate_db Postgres into
// TalentOS' own database (student_audit_students / student_audit_sticky_notes,
// see sql/neon_fixes/103_student_audit_data_tables.sql). Already run once
// (2026-09-24) — 26 students, 73 sticky notes imported.
//
// TalentOS is now the editing surface going forward (candidate_db /
// https://skarion-student-audit.vercel.app are legacy/read-only as of this
// decision): the Training Audit tab edits student_audit_students,
// student_audit_sticky_notes, and student_audit_mock_sessions directly.
// Because of that, this script is intentionally NON-destructive if it is
// ever run again — it only INSERTs rows for candidate_db ids that don't
// already exist locally (e.g. a genuinely new student added to the old
// roster later). It never UPDATEs or DELETEs an existing local row, so it
// can never clobber an edit made in TalentOS.
//
// Usage: node scripts/importStudentAudit.mjs
// Requires STUDENT_AUDIT_SOURCE_URL in the environment or .env.local.

import { readFileSync } from "fs";
import { resolve } from "path";
import { getDbClient } from "./lib/db.mjs";

function getSourceUrl() {
  if (process.env.STUDENT_AUDIT_SOURCE_URL) return process.env.STUDENT_AUDIT_SOURCE_URL;
  try {
    for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf-8").split("\n")) {
      if (line.startsWith("STUDENT_AUDIT_SOURCE_URL=")) return line.split("=").slice(1).join("=").trim();
    }
  } catch {
    /* absent .env.local is fine when the variable is already exported */
  }
  throw new Error("STUDENT_AUDIT_SOURCE_URL not set (checked process.env and .env.local).");
}

async function main() {
  const source = await getDbClient(getSourceUrl());
  const dest = await getDbClient(); // TalentOS' own DATABASE_URL

  try {
    const { rows: students } = await source.query(`
      SELECT id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
             placement_company, placement_role, placement_date, placement_readiness, created_at
      FROM students
    `);
    const { rows: notes } = await source.query(`
      SELECT id, student_id, date, content, category, author, accent, pinned, created_at
      FROM sticky_notes
    `);

    console.log(`Fetched ${students.length} students, ${notes.length} sticky notes from candidate_db.`);

    let studentsInserted = 0;
    let notesInserted = 0;

    await dest.query("BEGIN");
    try {
      for (const s of students) {
        const result = await dest.query(
          `INSERT INTO student_audit_students (
             id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
             placement_company, placement_role, placement_date, placement_readiness, source_created_at, synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
           ON CONFLICT (id) DO NOTHING`,
          [
            s.id, s.name, s.domain, s.target_role, s.joining_date, s.progress, s.mock_interviews, s.rating,
            s.placement_company, s.placement_role, s.placement_date, s.placement_readiness, s.created_at,
          ]
        );
        studentsInserted += result.rowCount;
      }

      for (const n of notes) {
        const result = await dest.query(
          `INSERT INTO student_audit_sticky_notes (
             id, student_id, date, content, category, author, accent, pinned, source_created_at, synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (id) DO NOTHING`,
          [n.id, n.student_id, n.date, n.content, n.category, n.author, n.accent, n.pinned, n.created_at]
        );
        notesInserted += result.rowCount;
      }

      await dest.query("COMMIT");
      console.log(
        `Inserted ${studentsInserted} new student(s), ${notesInserted} new sticky note(s). ` +
        `(${students.length - studentsInserted} students and ${notes.length - notesInserted} notes already existed locally and were left untouched.)`
      );
    } catch (err) {
      await dest.query("ROLLBACK");
      throw err;
    }
  } finally {
    await source.end();
    await dest.end();
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
