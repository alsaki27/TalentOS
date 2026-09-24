// One-off: applies the next 4 user-confirmed candidate <-> student-audit
// links (2026-09-24, second batch — rows 1-4 of the "no match found" list).
import { getDbClient } from "./lib/db.mjs";

const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

const CONFIRMED = [
  { candidateName: "TAHSIN MUHTADY MAHI", studentId: "skr-206", studentName: "Tahsin Mahi" },
  { candidateName: "Md Rashed Imtiouz", studentId: "skr-1788918423267", studentName: "Imtiouz, Md Rashed" },
  { candidateName: "Saddam H.", studentId: "skr-1785661675827", studentName: "Saddam Hossain" },
  { candidateName: "Dm Ahsanul Arefin Arnob", studentId: "skr-1785405970326", studentName: "Ahasanul Arefin Arnob" },
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
