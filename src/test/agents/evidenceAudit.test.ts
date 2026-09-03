import { describe, it, expect } from "vitest";
import { validateEvidenceCitations } from "@/lib/ai/application-agents/evidenceAudit";

describe("validateEvidenceCitations", () => {
  const evidenceBank = [{ id: "ev-1" }, { id: "ev-2" }];

  it("keeps a citation that matches a real evidence-bank id", () => {
    const draft = {
      experience: [{ title: "Engineer", company: "Acme", location: null, startDate: null, endDate: null, bullets: [], evidenceIds: ["ev-1"] }],
      changeLog: [],
    };
    const result = validateEvidenceCitations(draft, evidenceBank);
    expect(result).toEqual({ citedCount: 1, danglingCount: 0 });
    expect(draft.experience[0].evidenceIds).toEqual(["ev-1"]);
  });

  it("strips a fabricated experience evidenceId and counts it as dangling", () => {
    const draft = {
      experience: [{ title: "Engineer", company: "Acme", location: null, startDate: null, endDate: null, bullets: [], evidenceIds: ["ev-1", "ev-fake"] }],
      changeLog: [],
    };
    const result = validateEvidenceCitations(draft, evidenceBank);
    expect(result).toEqual({ citedCount: 1, danglingCount: 1 });
    expect(draft.experience[0].evidenceIds).toEqual(["ev-1"]);
  });

  it("nulls out a dangling changeLog evidenceId instead of leaving the fake id in place", () => {
    const draft = {
      experience: [],
      changeLog: [{ change: "Added a skill", reason: "JD match", evidenceId: "ev-does-not-exist" }],
    };
    const result = validateEvidenceCitations(draft, evidenceBank);
    expect(result).toEqual({ citedCount: 0, danglingCount: 1 });
    expect(draft.changeLog[0].evidenceId).toBeNull();
  });

  it("treats a null changeLog evidenceId as neither cited nor dangling", () => {
    const draft = {
      experience: [],
      changeLog: [{ change: "Reworded a bullet", reason: "Tighter phrasing", evidenceId: null }],
    };
    const result = validateEvidenceCitations(draft, evidenceBank);
    expect(result).toEqual({ citedCount: 0, danglingCount: 0 });
  });

  it("handles an empty evidence bank - every citation becomes dangling", () => {
    const draft = {
      experience: [{ title: "Engineer", company: "Acme", location: null, startDate: null, endDate: null, bullets: [], evidenceIds: ["ev-1"] }],
      changeLog: [],
    };
    const result = validateEvidenceCitations(draft, []);
    expect(result).toEqual({ citedCount: 0, danglingCount: 1 });
    expect(draft.experience[0].evidenceIds).toEqual([]);
  });

  it("handles an empty draft safely", () => {
    const result = validateEvidenceCitations({ experience: [], changeLog: [] }, evidenceBank);
    expect(result).toEqual({ citedCount: 0, danglingCount: 0 });
  });
});
