// One-off: applies the 6 user-confirmed candidate <-> student-audit links
// from the manual-review list (2026-09-24). Matches candidates by normalized
// name to avoid missing on stray whitespace, then upserts into
// student_audit_links exactly like the Training Audit tab's own link action.
import { getDbClient } from "./lib/db.mjs";

const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

const CONFIRMED = [
  { candidateName: "AKIB ZAMAN", studentId: "skr-1788849325272", studentName: "Al Akib Zaman" },
  { candidateName: "Mir Najiur Rahman", studentId: "skr-209", studentName: "Najiur Rahman" },
  { candidateName: "GEETHA RAGIPHANI", studentId: "skr-1788918557535", studentName: "Geetha" },
  { candidateName: "MD Arif", studentId: "skr-210", studentName: "Arif" },
  { candidateName: "Yulun Liu", studentId: "skr-1785339644309", studentName: "Yulun" },
  { candidateName: "Avirup Bhattacharjee", studentId: "skr-212", studentName: "Avirup" },
];

async function main() {
  const db = await getDbClient();
  try {
    const { rows: candidates } = await db.query(`SELECT id, name FROM candidates`);
    const candidateByNorm = new Map(candidates.map((c) => [norm(c.name), c]));

    for (const m of CONFIRMED) {
      const candidate = candidateByNorm.get(norm(m.candidateName));
      if (!candidate) {
        console.log(`SKIP: no candidate found matching "${m.candidateName}"`);
        continue;
      }
      const student = await db.query(`SELECT id FROM student_audit_students WHERE id = $1`, [m.studentId]);
      if (student.rows.length === 0) {
        console.log(`SKIP: student-audit record ${m.studentId} not found`);
        continue;
      }
      await db.query(
        `INSERT INTO student_audit_links (candidate_id, audit_student_id) VALUES ($1, $2)
         ON CONFLICT (candidate_id) DO UPDATE SET audit_student_id = EXCLUDED.audit_student_id, linked_at = now()`,
        [candidate.id, m.studentId]
      );
      console.log(`LINKED: "${candidate.name}" -> "${m.studentName}" (${m.studentId})`);
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Link failed:", err);
  process.exit(1);
});
