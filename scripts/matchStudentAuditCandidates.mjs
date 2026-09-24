// One-off helper: reports (and, for exact matches only, applies) candidate <->
// student-audit links by name. Only case-insensitive, whitespace-normalized
// EXACT name matches are auto-linked — zero ambiguity. Everything else is
// reported for manual review via each candidate's Training Audit tab, since a
// wrong link would show one real person's mock-interview data under another
// candidate's name.
import { getDbClient } from "./lib/db.mjs";

const norm = (s) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

async function main() {
  const db = await getDbClient();
  try {
    const { rows: candidates } = await db.query(`SELECT id, name FROM candidates`);
    const { rows: students } = await db.query(`SELECT id, name FROM student_audit_students`);
    const { rows: existingLinks } = await db.query(`SELECT candidate_id FROM student_audit_links`);
    const alreadyLinked = new Set(existingLinks.map((l) => l.candidate_id));

    const studentByNorm = new Map();
    for (const s of students) {
      const key = norm(s.name);
      if (!studentByNorm.has(key)) studentByNorm.set(key, []);
      studentByNorm.get(key).push(s);
    }

    const exactMatches = [];
    const fuzzyCandidates = [];
    const noMatch = [];

    for (const c of candidates) {
      if (alreadyLinked.has(c.id)) continue;
      const key = norm(c.name);
      const exact = studentByNorm.get(key);
      if (exact && exact.length === 1) {
        exactMatches.push({ candidate: c, student: exact[0] });
        continue;
      }
      if (exact && exact.length > 1) {
        fuzzyCandidates.push({ candidate: c, candidates: exact, reason: "multiple exact-name matches" });
        continue;
      }
      const partial = students.filter(
        (s) => norm(s.name).includes(key) || key.includes(norm(s.name))
      );
      if (partial.length > 0) {
        fuzzyCandidates.push({ candidate: c, candidates: partial, reason: "partial name match" });
      } else {
        noMatch.push(c);
      }
    }

    console.log(`\n=== EXACT MATCHES (auto-linking ${exactMatches.length}) ===`);
    for (const m of exactMatches) {
      console.log(`  ${m.candidate.name}  ->  ${m.student.name} (${m.student.id})`);
      await db.query(
        `INSERT INTO student_audit_links (candidate_id, audit_student_id) VALUES ($1, $2)
         ON CONFLICT (candidate_id) DO NOTHING`,
        [m.candidate.id, m.student.id]
      );
    }

    console.log(`\n=== NEEDS MANUAL REVIEW (${fuzzyCandidates.length}) — link via each candidate's Training Audit tab ===`);
    for (const f of fuzzyCandidates) {
      console.log(`  Candidate "${f.candidate.name}" (${f.reason}):`);
      for (const s of f.candidates) console.log(`      -> "${s.name}" (${s.id})`);
    }

    console.log(`\n=== NO MATCH FOUND (${noMatch.length}) — likely not in the student-audit roster ===`);
    for (const c of noMatch) console.log(`  ${c.name}`);

    console.log(`\nAlready linked before this run: ${alreadyLinked.size}`);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Match failed:", err);
  process.exit(1);
});
