// One-off script: apply migration 0004 and populate application-profile fields
// for named candidates. Matches the alter_eeo.ts pattern (direct DB via
// src/server/db/neon, needs DATABASE_URL / NEON_DATABASE_URL in env).
//
// Safety: looks up each candidate by name (ILIKE). If a name matches zero or
// more than one candidate, it SKIPS that candidate and reports it rather than
// guessing which row to update.
//
// Deliberately excludes any credential-like field (e.g. the LinkedIn password
// that was pasted in chat for Avirup) — that must never be stored in the DB.

import fs from "fs";
import { query, queryOne, execute } from "./src/server/db/neon";

interface CandidateUpdate {
  nameLike: string;
  fields: Record<string, unknown>;
}

const updates: CandidateUpdate[] = [
  {
    nameLike: "%Tahsin Muhtady Mahi%",
    fields: {
      home_address: "3433 S Indiana Ave, Chicago, IL 60616",
      salary_expectation: "70k-100k",
      birth_date: "1999-01-10",
      open_to_relocation: true,
      eeo_veteran: "No",
      eeo_disability: "None",
      driving_license: "No",
      pe_license_il: "No",
      education_gpa: "3.41",
      education_gpa_year: 2022,
    },
  },
  {
    nameLike: "%Avirup%",
    fields: {
      // Two addresses were given; stored together since the schema has one field.
      home_address:
        "848 W Mitchell, Apt 416, Arlington, TX 76013 | 13174 Polvera Avenue, San Diego, CA 92128",
      birth_date: "2001-11-26",
      open_to_relocation: true,
      eeo_veteran: "No",
      eeo_disability: "N/A",
      driving_license: "Yes",
      driving_license_state: "Florida",
      driving_license_expiry: "2028-01-01", // only expiry YEAR was given (2028); day/month unknown
      pe_license_il: "No",
      // NOTE: "Graduation start: May 2020" intentionally not stored anywhere structured —
      // no matching column, and it reads as an academic start date, not a GPA/grad date.
      // LinkedIn password intentionally NOT stored (security).
    },
  },
  {
    nameLike: "%Najiur%",
    fields: {
      home_address: "14217 Westway Ln, Apt 13, Woodbridge, VA 22193",
      birth_date: "1986-07-02",
      open_to_relocation: true,
      eeo_veteran: "No",
      driving_license: "Yes - Regular",
      work_authorization: "EAD",
      visa_status: "Work Authorization - EAD",
      pe_license_il: "No",
    },
  },
  {
    nameLike: "%Maahir%",
    fields: {
      home_address: "2916 Network Pl, Apt 102A, Lutz, FL 33559",
      driving_license: "Yes - Class E",
      open_to_relocation: true,
      pe_license_il: "No",
    },
  },
];

async function applyMigration() {
  const sql = fs.readFileSync("sql/neon_fixes/048_candidate_application_profile_fields.sql", "utf-8");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const stmt of statements) {
    await execute(stmt);
  }
  console.log("[migration] 0004 applied (or already present).");
}

async function main() {
  await applyMigration();

  for (const u of updates) {
    const matches = await query<{ id: string; name: string }>(
      `SELECT id, name FROM candidates WHERE name ILIKE $1`,
      [u.nameLike]
    );

    if (matches.length === 0) {
      console.warn(`[skip] No candidate matched "${u.nameLike}" — nothing updated.`);
      continue;
    }
    if (matches.length > 1) {
      console.warn(
        `[skip] "${u.nameLike}" matched ${matches.length} candidates (${matches
          .map((m) => m.name)
          .join(", ")}) — ambiguous, nothing updated.`
      );
      continue;
    }

    const candidate = matches[0];
    const keys = Object.keys(u.fields);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(u.fields);
    values.push(candidate.id);

    const row = await queryOne<{ id: string; name: string }>(
      `UPDATE candidates SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING id, name`,
      values
    );
    console.log(`[updated] ${row?.name} (${row?.id}) — fields: ${keys.join(", ")}`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
