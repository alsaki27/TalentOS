#!/usr/bin/env node
/**
 * scripts/seed-keyword-groups.ts
 *
 * Seeds the job_agent_keyword_groups table with the new keyword tracks.
 * Safe to run multiple times — will UPDATE if the label already exists, INSERT if new.
 *
 * Run: npx tsx scripts/seed-keyword-groups.ts
 */

import fs from "fs";
import path from "path";

// Load env
const envFile = fs.readFileSync(path.resolve(".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const eqIdx = line.indexOf("=");
  if (eqIdx === -1) continue;
  const key = line.slice(0, eqIdx).trim();
  const val = line.slice(eqIdx + 1).trim();
  if (key === "DATABASE_URL") process.env.DATABASE_URL = val;
  if (key === "NEON_DATABASE_URL") process.env.NEON_DATABASE_URL = val;
}

import { query, execute } from "../src/server/db/neon.ts";

// ─── Keyword Groups to seed ───────────────────────────────────────────────────

const GROUPS: { label: string; keywords: string[] }[] = [
  {
    label: "Data Center / Colocation",
    keywords: [
      "Data Center Technician",
      "Senior Data Center Technician",
      "Senior Data Technician",
      "Smart Hands Technician",
      "Remote Hands Technician",
      "Colocation Technician",
      "Colocation Engineer",
      "Data Center Operations Technician",
      "Data Center Operations Specialist",
      "Data Center Hardware Technician",
      "Data Center Network Engineer",
      "Field Service Technician",
      "Structured Cabling Technician",
      "Network Technician",
      "IT Infrastructure Technician",
      "Server Hardware Technician",
      "AI Accelerator Engineer",
    ],
  },
  {
    label: "ISP / Network Operations",
    keywords: [
      "Network Engineer",
      "Senior Network Engineer",
      "Network Operations Engineer",
      "Senior Network Operations Engineer",
      "ISP Network Engineer",
      "IP Network Engineer",
      "Service Provider Network Engineer",
      "Core Network Engineer",
      "Broadband Network Engineer",
      "Network Support Engineer",
      "Network Support Specialist",
      "Telecom Network Engineer",
      "WAN Engineer",
      "Network Infrastructure Engineer",
      "Network Technician",
      "L2 Network Support",
      "CCIE",
      "Interconnection Engineer",
    ],
  },
  {
    label: "NOC / Network Monitoring",
    keywords: [
      "NOC Engineer",
      "Senior NOC Engineer",
      "24x7 NOC Engineer",
      "NOC Analyst",
      "Network Operations Center Engineer",
      "Network Monitoring Engineer",
      "Incident Response Engineer",
      "IT Operations Engineer",
      "Systems Monitoring Engineer",
      "Major Incident Engineer",
      "Operational Performance Engineer",
    ],
  },
  {
    label: "Solar PV / Battery Storage Engineering",
    keywords: [
      "Solar Applications Engineer",
      "Senior Applications Engineer – Solar PV & Battery Storage Systems",
      "Solar Design Engineer",
      "Solar Electrical Design Engineer",
      "Solar PV Design Engineer",
      "PV Design Engineer",
      "PV Systems Engineer",
      "Photovoltaic Design Engineer",
      "C&I Solar Design Engineer",
      "Solar Project Engineer",
      "Solar Engineer",
      "Renewable Energy Design Engineer",
      "Operational Performance Engineer",
      "Solar CAD Designer",
    ],
  },
  {
    label: "Hardware / Chip / Embedded Design",
    keywords: [
      "FPGA Engineer",
      "FPGA Design Engineer",
      "FPGA & VLSI Design Engineer",
      "VLSI Design Engineer",
      "RTL Design Engineer",
      "ASIC Design Engineer",
      "SoC Design Engineer",
      "Digital Design Engineer",
      "Hardware Design Engineer",
      "Embedded Hardware Engineer",
      "Embedded Systems Engineer",
      "Electronics Engineer",
    ],
  },
  {
    label: "Field Service / Estimating",
    keywords: [
      "Field Service Technician",
      "Cost Estimator",
      "Geospatial Analyst",
    ],
  },
  {
    label: "OSP / Fiber Extended",
    keywords: [
      "OSP CAD Drafter",
      "OSP Design Engineering Apprentice",
      "OSP Design Engineering Specialist",
      "OSP Engineering Technician",
      "Permit Design Engineer",
      "Permit Drafter",
      "Fiber Design Engineer",
      "Fiber Optic Design Engineer",
      "Telecom Design Engineer",
    ],
  },
];

// ─── Upsert logic ─────────────────────────────────────────────────────────────

async function run() {
  console.log("Seeding keyword groups...\n");

  // Fetch existing groups by label
  const existing = await query<{ id: string; label: string }>(
    `SELECT id, label FROM job_agent_keyword_groups`
  );
  const existingByLabel = new Map(existing.map((g) => [g.label.toLowerCase(), g.id]));

  let inserted = 0;
  let updated = 0;

  for (const group of GROUPS) {
    const existingId = existingByLabel.get(group.label.toLowerCase());
    if (existingId) {
      // UPDATE: merge existing keywords with new ones (no duplicates)
      const existingRow = await query<{ keywords: string[] }>(
        `SELECT keywords FROM job_agent_keyword_groups WHERE id = $1`,
        [existingId]
      );
      const existingKeywords: string[] = existingRow[0]?.keywords ?? [];
      const merged = [...new Set([...existingKeywords, ...group.keywords])];
      await execute(
        `UPDATE job_agent_keyword_groups SET keywords = $1, updated_at = NOW() WHERE id = $2`,
        [merged, existingId]
      );
      console.log(`  ✓ Updated  "${group.label}" — ${merged.length} keywords (${merged.length - existingKeywords.length} new)`);
      updated++;
    } else {
      // INSERT new group
      await execute(
        `INSERT INTO job_agent_keyword_groups (label, keywords) VALUES ($1, $2)`,
        [group.label, group.keywords]
      );
      console.log(`  ✓ Inserted "${group.label}" — ${group.keywords.length} keywords`);
      inserted++;
    }
  }

  console.log(`\nDone! Inserted: ${inserted}, Updated: ${updated}`);
}

run().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
