// One-off: populate scheduled_candidate_logging_candidate_rules.preferences.
// citizenshipStatus for 15 real candidates, from the "Current Visa Type" /
// citizenship line of an internal HR doc the user provided directly in
// chat. Deliberately extracts ONLY citizenship/visa-eligibility text -
// birth dates, disability status, veteran status, driving license, home
// addresses, phone numbers, and an unrelated plaintext password found in
// the same doc are never read into this script or stored anywhere.
//
// Uses a jsonb merge (||), not an overwrite, so any already-saved
// preferences (locations/roles/employmentTypes/salaryExpectation) for these
// candidates are preserved.
//
// Run with: npx tsx --env-file=.env.local scripts/backfill-scheduled-logging-citizenship-status.ts

import { query } from "../src/server/db/neon";

const ENTRIES: { candidateId: string; name: string; citizenshipStatus: string }[] = [
  { candidateId: "04dbd347-055e-4621-a68a-44fc690b8f5f", name: "Mir Najiur Rahman", citizenshipStatus: "Work Authorization - EAD" },
  { candidateId: "b893a59c-6c2f-43aa-bb1e-922808ce1a57", name: "Md Mahbubul Alam", citizenshipStatus: "F1 OPT with EAD" },
  { candidateId: "8e7ab09b-3270-49a2-ba62-d05676c5b97b", name: "Saddam H.", citizenshipStatus: "F1 (OPT)" },
  { candidateId: "f5adea13-a323-4d92-b530-3efe29654741", name: "Ahmed Chowdhury", citizenshipStatus: "F1 waiting for OPT" },
  { candidateId: "de7e5a26-4aa5-4396-ac5d-28af04cec582", name: "Abrar Zahin", citizenshipStatus: "F1-OPT" },
  { candidateId: "5c563034-edcc-4161-bedb-497f6290517e", name: "Rayda Noor", citizenshipStatus: "Green Card" },
  { candidateId: "1b3ec193-9740-402c-90c7-b2a84b696ddd", name: "Adnan Tarif", citizenshipStatus: "Green Card holder" },
  { candidateId: "bb5889c2-9b6c-45f5-b98b-8f821623e01a", name: "Hija Tovi", citizenshipStatus: "US Citizen" },
  { candidateId: "0479b7db-f4fc-445e-af13-389f055209c2", name: "Nujhat Khan", citizenshipStatus: "F-1 student visa / Optional Practical Training (OPT)" },
  { candidateId: "9af155d5-ec3e-4dc0-a4e1-c063a83cb787", name: "Akib Zaman", citizenshipStatus: "US Citizen" },
  { candidateId: "d42c5dca-0cc5-469f-8b53-736357c66c61", name: "Geetha Ragiphani", citizenshipStatus: "F-1 STEM OPT" },
  { candidateId: "862d2da2-a01b-45bf-a873-f1f4f640e28a", name: "Aniruddha Chowdhury", citizenshipStatus: "Stem OPT" },
  { candidateId: "690bfd98-841f-47e5-ba7f-d50358313fb0", name: "Md Rashed Imtiouz", citizenshipStatus: "F1 UOT" },
  { candidateId: "992f6e4d-1fab-40af-8084-669426bd68e5", name: "Moumiza Hasan", citizenshipStatus: "F1 (waiting on OPT EAD card)" },
  { candidateId: "88324609-0ce4-4372-9d76-43a52df1d156", name: "MD Fahim Mostazir", citizenshipStatus: "F1 (Applied for OPT)" },
  { candidateId: "5f2bd58f-525a-4791-88a3-43ad82733fc8", name: "Atonu Dey", citizenshipStatus: "Post Graduate Work Permit (PGWP)" },
];

async function main() {
  console.log(`Backfilling citizenshipStatus for ${ENTRIES.length} candidates...`);
  for (const entry of ENTRIES) {
    await query(
      `INSERT INTO scheduled_candidate_logging_candidate_rules (candidate_id, preferences, updated_at)
       VALUES ($1, jsonb_build_object('citizenshipStatus', $2::text), NOW())
       ON CONFLICT (candidate_id) DO UPDATE SET
         preferences = scheduled_candidate_logging_candidate_rules.preferences
                       || jsonb_build_object('citizenshipStatus', EXCLUDED.preferences->'citizenshipStatus'),
         updated_at = NOW()`,
      [entry.candidateId, entry.citizenshipStatus],
    );
    console.log(`  ✓ ${entry.name} (${entry.candidateId}) -> "${entry.citizenshipStatus}"`);
  }
  console.log("Done.");
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
