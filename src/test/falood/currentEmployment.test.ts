import { describe, expect, it } from "vitest";
import { normalizeImportedResumeData } from "@/components/falood/resumify/utils/importedResumeData";
import { finalResumeToStudioDocument } from "@/lib/ai/application-agents/finalResumeToStudioDocument";
import { enforceExperienceIntegrity } from "@/lib/ai/application-agents/resumeIntegrity";
import { DEFAULT_FORMATTING, mergeResumifyEditorIntoBaseResume } from "@/lib/falood/resumeDocumentAdapters";
import { buildResumeDocumentFromParsedResume } from "@/lib/falood/seedFromParsedResume";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";

type Status = { current?: boolean; endDate?: string };
const cases: [string, Status[], number][] = [
  ["the second role selected", [{}, { current: true }], 1],
  ["legacy Present", [{ endDate: " pReSeNt " }, {}], 0],
  ["an explicit selection overrides legacy Present", [{ endDate: "Present" }, { current: true }], 1],
  ["an explicit false overrides Present", [{ current: false, endDate: "Present" }], -1],
  ["missing, blank and unrecognized dates", [{}, { endDate: "" }, { endDate: "TBD" }], -1],
  ["all former roles", [{ endDate: "2022" }, { current: false }], -1],
  ["multiple saved selections", [{}, { current: true }, { current: true }], 1],
  ["multiple legacy markers", [{}, { endDate: "Present" }, { endDate: "Present" }], 1],
  ["a selected role with an old end date", [{ current: true, endDate: "2022" }], 0],
  ["no experience", [], -1],
];

const finalContent = { summary: null, skills: [], education: [], projects: [], certifications: [] };

describe("current employment across base and tailored resumes", () => {
  it.each(cases)("preserves %s through import, save, generation and reopen", (_label, statuses, selected) => {
    const canonicalRoles = statuses.map(({ current, endDate }, index) => ({
      title: `Role ${index}`, company: "Example", startDate: "2020", endDate, isCurrent: current, bullets: [],
    }));
    const nativeRoles = canonicalRoles.map(({ title, isCurrent, ...role }) => ({ ...role, jobTitle: title, current: isCurrent }));
    const expected = statuses.map((_, index) => index === selected);
    const seeded = buildResumeDocumentFromParsedResume({ experience: canonicalRoles }, { name: "Fixture" }, DEFAULT_FORMATTING);
    expect(seeded.experience.map(role => role.isCurrent)).toEqual(expected);
    for (const base of [{ header: {}, experience: canonicalRoles }, { personalInfo: {}, experience: nativeRoles }]) {
      const editor = normalizeImportedResumeData(studioDocumentToResumeData(base));
      expect(editor.experience.map(role => role.current)).toEqual(expected);
      const saved = mergeResumifyEditorIntoBaseResume(base, editor);
      expect(studioDocumentToResumeData(saved).experience.map(role => role.current)).toEqual(expected);
      const experience = enforceExperienceIntegrity([], base.experience);
      expect(experience.map(role => role.endDate === "Present")).toEqual(expected);
      // Even a provider claiming every job is current cannot move the checkbox.
      const generated = finalResumeToStudioDocument({
        ...finalContent, experience: experience.map(role => ({ ...role, endDate: "Present" })),
      }, base);
      const reopened = studioDocumentToResumeData(generated);
      expect(reopened.experience.map(role => role.current)).toEqual(expected);
      expect(reopened.experience.every(role => role.endDate !== "Present")).toBe(true);
    }
  });

  it("matches repeated jobs by start date after reordering and preserves the selected duplicate in base order", () => {
    const role = { title: "Designer", company: "Example", startDate: "2021", bullets: [] };
    const experience = [role, { ...role, startDate: "2023", isCurrent: true }, { ...role, startDate: "2023" }];
    const base = { experience };
    const entries = enforceExperienceIntegrity([], experience);
    const ordered = [entries[1], entries[2], entries[0]];
    const doc = finalResumeToStudioDocument({ ...finalContent, experience: ordered }, base);
    expect(doc.experience.map(item => item.isCurrent)).toEqual([true, false, false]);
    const omitted = finalResumeToStudioDocument({ ...finalContent, experience: [entries[0]] }, base);
    expect(omitted.experience[0].isCurrent).toBe(false);
  });
});
