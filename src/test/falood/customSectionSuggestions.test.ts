import { describe, it, expect } from "vitest";
import { applySuggestionToResumeData, type Suggestion } from "@/lib/falood/applySuggestionToResumeData";
import type { ResumeData } from "@/components/falood/resumify/types/resume";

function baseResumeData(customSections: ResumeData["customSections"] = []): ResumeData {
  return {
    personalInfo: { fullName: "Jane Doe" } as any,
    summary: "",
    experience: [],
    education: [],
    projects: [],
    skills: { categorized: [] } as any,
    customSections,
    sections: [],
    colors: {} as any,
    template: "business-professional" as any,
    pageFormat: "letter",
    fontSize: 10,
    fontFamily: "Inter",
    pagePadding: 0.5,
  };
}

describe("applySuggestionToResumeData - custom sections", () => {
  it("adds a new custom section via custom_section_add", () => {
    const resumeData = baseResumeData();
    const suggestion: Suggestion = {
      id: "s1",
      type: "custom_section_add",
      title: "Add Languages section",
      description: "",
      suggested: { title: "Languages", content: "English (native)\nSpanish (fluent)", type: "bullets" },
    };
    const result = applySuggestionToResumeData(resumeData, suggestion);
    expect(result.customSections).toHaveLength(1);
    expect(result.customSections[0].title).toBe("Languages");
    expect(result.customSections[0].content).toBe("English (native)\nSpanish (fluent)");
    expect(result.customSections[0].visible).toBe(true);
  });

  it("does not add a duplicate custom section (case-insensitive title match)", () => {
    const resumeData = baseResumeData([
      { id: "cs1", title: "Languages", content: "English", type: "bullets", visible: true, order: 1 },
    ]);
    const suggestion: Suggestion = {
      id: "s2",
      type: "custom_section_add",
      title: "Add Languages section",
      description: "",
      suggested: { title: "languages", content: "Spanish" },
    };
    const result = applySuggestionToResumeData(resumeData, suggestion);
    expect(result.customSections).toHaveLength(1);
    expect(result.customSections[0].content).toBe("English");
  });

  it("edits an existing custom section by targetId", () => {
    const resumeData = baseResumeData([
      { id: "cs1", title: "Awards", content: "Old award", type: "bullets", visible: true, order: 1 },
    ]);
    const suggestion: Suggestion = {
      id: "s3",
      type: "custom_section_edit",
      title: "Update Awards",
      description: "",
      targetId: "cs1",
      suggested: { content: "Employee of the Year 2023" },
    };
    const result = applySuggestionToResumeData(resumeData, suggestion);
    expect(result.customSections[0].content).toBe("Employee of the Year 2023");
    expect(result.customSections[0].title).toBe("Awards");
  });

  it("falls back to matching by contextTitle when targetId is missing (mirrors the experience-branch resilience pattern)", () => {
    const resumeData = baseResumeData([
      { id: "cs1", title: "Publications", content: "Paper A", type: "bullets", visible: true, order: 1 },
    ]);
    const suggestion: Suggestion = {
      id: "s4",
      type: "custom_section_edit",
      title: "Update Publications",
      description: "",
      contextTitle: "Publications",
      suggested: { content: "Paper A, Paper B" },
    };
    const result = applySuggestionToResumeData(resumeData, suggestion);
    expect(result.customSections[0].content).toBe("Paper A, Paper B");
  });

  it("no-ops (returns resumeData unchanged) when no custom section matches", () => {
    const resumeData = baseResumeData([
      { id: "cs1", title: "Awards", content: "Old award", type: "bullets", visible: true, order: 1 },
    ]);
    const suggestion: Suggestion = {
      id: "s5",
      type: "custom_section_edit",
      title: "Update nonexistent section",
      description: "",
      targetId: "does-not-exist",
      suggested: { content: "New text" },
    };
    const result = applySuggestionToResumeData(resumeData, suggestion);
    expect(result).toBe(resumeData);
  });
});
