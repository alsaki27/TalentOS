import { describe, it, expect } from "vitest";
import { applyDeterministicTrim } from "@/lib/ai/application-agents/finalPolish";
import type { FinalResumeV1 } from "@/lib/ai/application-agents/schemas";

const JOB_ANALYSIS = { requiredSkills: ["TypeScript", "React"], atsKeywords: ["Kubernetes"] };

function makeResume(overrides: Partial<FinalResumeV1> = {}): FinalResumeV1 {
  return {
    summary: null,
    skills: [{ title: "Core", skills: ["TypeScript", "React", "Excel", "PowerPoint"] }],
    experience: [
      {
        title: "Engineer",
        company: "Acme",
        location: "Remote",
        startDate: "2020",
        endDate: "2022",
        bullets: [
          "Shipped a feature using TypeScript and React that improved conversion by 12%.",
          "Assisted with various team responsibilities and general support tasks.",
          "Helped coordinate cross-team meetings and communication efforts.",
          "Deployed services on Kubernetes for the platform team.",
          "Wrote miscellaneous documentation for internal tools.",
          "Contributed to general engineering best practices across the org.",
        ],
        evidenceIds: [],
      },
    ],
    education: [],
    certifications: [],
    projects: [],
    appliedIssueIds: [],
    rejectedIssueIds: [],
    unresolvedWarnings: [],
    finalQaScore: 8,
    exportReady: true,
    pageFit: null,
    ...overrides,
  };
}

describe("applyDeterministicTrim", () => {
  it("removes exactly one low-value bullet (no digit, no keyword match) from a role above its floor", () => {
    const resume = makeResume();
    const before = resume.experience[0].bullets.length; // 6, floor for role 0 is 6 -> no slack actually
    // Give it slack: 7 bullets so there's 1 above the floor of 6.
    resume.experience[0].bullets.push("Participated in general team activities without a clear outcome.");
    expect(resume.experience[0].bullets.length).toBe(before + 1);

    applyDeterministicTrim(resume, JOB_ANALYSIS);

    expect(resume.experience[0].bullets.length).toBe(before);
    // The removed bullet should be one of the genuinely low-value ones, not a quantified/keyword one.
    expect(resume.experience[0].bullets).toContain("Shipped a feature using TypeScript and React that improved conversion by 12%.");
    expect(resume.experience[0].bullets).toContain("Deployed services on Kubernetes for the platform team.");
  });

  it("never drops a role below its per-role bullet minimum", () => {
    const resume = makeResume({
      experience: [
        {
          title: "Engineer",
          company: "Acme",
          location: "Remote",
          startDate: "2020",
          endDate: "2022",
          bullets: [
            "Helped with general tasks.",
            "Assisted various teams.",
            "Supported miscellaneous initiatives.",
          ], // exactly at the floor for role index 0? no - role 0 floor is 6, this is below it already
          evidenceIds: [],
        },
      ],
    });
    const before = resume.experience[0].bullets.length;
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    // Already at/under the floor (3 < 6) - nothing should be removed since there's no slack.
    expect(resume.experience[0].bullets.length).toBe(before);
  });

  it("is a no-op when every bullet is quantified or keyword-matched, even with slack", () => {
    const resume = makeResume();
    resume.experience[0].bullets = [
      "Shipped a TypeScript feature that increased revenue by 20%.",
      "Built a React dashboard used by 500 daily users.",
      "Migrated Kubernetes clusters, cutting cost by 30%.",
      "Reduced TypeScript build time by 40% using React lazy loading.",
      "Automated Kubernetes deploys, saving 10 hours per week.",
      "Improved React app performance by 25% via TypeScript refactors.",
      "Increased Kubernetes uptime to 99.9% through TypeScript tooling.",
    ];
    const before = resume.experience[0].bullets.length;
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    expect(resume.experience[0].bullets.length).toBe(before);
  });

  it("never removes a role's only quantified bullet", () => {
    const resume = makeResume();
    resume.experience[0].bullets = [
      "Shipped a feature that improved conversion by 12%.", // the only quantified bullet
      "Helped with general team support.",
      "Assisted various initiatives without clear scope.",
      "Coordinated miscellaneous meetings.",
      "Provided general assistance to the team.",
      "Participated in team activities.",
      "Did some additional unspecified work.",
    ];
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    expect(resume.experience[0].bullets).toContain("Shipped a feature that improved conversion by 12%.");
  });

  it("dedupes skills case-insensitively within a group", () => {
    const resume = makeResume();
    resume.skills = [{ title: "Core", skills: ["TypeScript", "typescript", "React", "REACT"] }];
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    expect(resume.skills[0].skills.length).toBe(2);
  });

  it("removes at most one keyword-unmatched skill from the last group, never emptying it", () => {
    const resume = makeResume();
    resume.skills = [{ title: "Misc", skills: ["TypeScript", "SomethingUnrelated"] }];
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    expect(resume.skills[0].skills.length).toBe(1);
    expect(resume.skills[0].skills).toContain("TypeScript");
  });

  it("never empties a skill group even if every skill is unmatched", () => {
    const resume = makeResume();
    resume.skills = [{ title: "Misc", skills: ["Unrelated1", "Unrelated2"] }];
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    expect(resume.skills[0].skills.length).toBeGreaterThan(0);
  });

  it("never adds or rewrites content - only ever removes", () => {
    const resume = makeResume();
    resume.experience[0].bullets.push("Participated in general team activities without a clear outcome.");
    const skillsBefore = [...resume.skills[0].skills];
    applyDeterministicTrim(resume, JOB_ANALYSIS);
    for (const skill of resume.skills[0].skills) {
      expect(skillsBefore).toContain(skill);
    }
    for (const bullet of resume.experience[0].bullets) {
      expect(bullet).not.toMatch(/^$/);
    }
  });
});
