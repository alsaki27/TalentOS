// Test-side mock provider helpers for deterministic E2E pipeline tests.
// Re-exports the server-side createMockProvider for convenience, plus schema snapshots
// that tests can use to assert against expected pipeline outputs.

import type { AiProvider } from "@/lib/ai/provider";

export async function createMockProvider(automationId: string): Promise<AiProvider> {
  const { createMockProvider: serverCreateMock } = await import("@/lib/ai/mockProvider");
  return serverCreateMock();
}

export const EXPECTED_JOB_ANALYSIS = {
  title: "Senior Software Engineer",
  company: "Acme Corp",
  location: "Remote",
  requiredSkills: ["TypeScript", "React", "Node.js", "PostgreSQL"],
  preferredSkills: ["GraphQL", "Docker", "AWS"],
  atsKeywords: ["TypeScript", "React", "Node.js", "PostgreSQL", "GraphQL", "AWS", "CI/CD", "Agile"],
  seniority: "Senior",
};

export const EXPECTED_REVIEW = {
  passFail: "pass" as const,
  atsScore: 9.0,
};

export const EXPECTED_FINAL = {
  exportReady: true,
  finalQaScore: 9.2,
};
