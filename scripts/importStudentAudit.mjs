// One-off / re-runnable import: copies the Skarion Student Audit roster
// (students + sticky_notes) from the separate candidate_db Postgres into
// TalentOS' own database (student_audit_students / student_audit_sticky_notes,
// see sql/neon_fixes/103_student_audit_data_tables.sql). TalentOS reads only
// the local copy at request time — there is no live cross-database connection
// in the app itself. Re-run this script whenever fresher data is wanted.
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

    await dest.query("BEGIN");
    try {
      for (const s of students) {
        await dest.query(
          `INSERT INTO student_audit_students (
             id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
             placement_company, placement_role, placement_date, placement_readiness, source_created_at, synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             domain = EXCLUDED.domain,
             target_role = EXCLUDED.target_role,
             joining_date = EXCLUDED.joining_date,
             progress = EXCLUDED.progress,
             mock_interviews = EXCLUDED.mock_interviews,
             rating = EXCLUDED.rating,
             placement_company = EXCLUDED.placement_company,
             placement_role = EXCLUDED.placement_role,
             placement_date = EXCLUDED.placement_date,
             placement_readiness = EXCLUDED.placement_readiness,
             source_created_at = EXCLUDED.source_created_at,
             synced_at = now()`,
          [
            s.id, s.name, s.domain, s.target_role, s.joining_date, s.progress, s.mock_interviews, s.rating,
            s.placement_company, s.placement_role, s.placement_date, s.placement_readiness, s.created_at,
          ]
        );
      }

      const currentStudentIds = students.map((s) => s.id);
      const removedStudents = currentStudentIds.length > 0
        ? await dest.query(`DELETE FROM student_audit_students WHERE id != ALL($1) RETURNING id`, [currentStudentIds])
        : { rows: [] };

      for (const n of notes) {
        await dest.query(
          `INSERT INTO student_audit_sticky_notes (
             id, student_id, date, content, category, author, accent, pinned, source_created_at, synced_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (id) DO UPDATE SET
             student_id = EXCLUDED.student_id,
             date = EXCLUDED.date,
             content = EXCLUDED.content,
             category = EXCLUDED.category,
             author = EXCLUDED.author,
             accent = EXCLUDED.accent,
             pinned = EXCLUDED.pinned,
             source_created_at = EXCLUDED.source_created_at,
             synced_at = now()`,
          [n.id, n.student_id, n.date, n.content, n.category, n.author, n.accent, n.pinned, n.created_at]
        );
      }

      const currentNoteIds = notes.map((n) => n.id);
      const removedNotes = currentNoteIds.length > 0
        ? await dest.query(`DELETE FROM student_audit_sticky_notes WHERE id != ALL($1) RETURNING id`, [currentNoteIds])
        : { rows: [] };

      await dest.query("COMMIT");
      console.log(
        `Synced ${students.length} students (${removedStudents.rows.length} removed), ` +
        `${notes.length} sticky notes (${removedNotes.rows.length} removed).`
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
