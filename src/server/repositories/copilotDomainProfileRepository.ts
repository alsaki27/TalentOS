// src/server/repositories/copilotDomainProfileRepository.ts
// Caches Copilot Form Analyst's per-domain ATS classification so it only
// runs once per new domain instead of on every Analyze click.
// See neon_fixes/053_copilot_agents.sql for copilot_domain_profiles.

import { queryOne, execute } from "@/server/db/neon";

export interface CopilotDomainProfile {
  domain: string;
  ats_guess: string | null;
  structural_notes: string | null;
}

export async function getDomainProfile(domain: string): Promise<CopilotDomainProfile | null> {
  return queryOne<CopilotDomainProfile>(
    `SELECT domain, ats_guess, structural_notes FROM copilot_domain_profiles WHERE domain = $1`,
    [domain]
  );
}

export async function upsertDomainProfile(domain: string, atsGuess: string, structuralNotes: string): Promise<void> {
  await execute(
    `INSERT INTO copilot_domain_profiles (domain, ats_guess, structural_notes, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (domain) DO UPDATE SET ats_guess = $2, structural_notes = $3, updated_at = NOW()`,
    [domain, atsGuess, structuralNotes]
  );
}
