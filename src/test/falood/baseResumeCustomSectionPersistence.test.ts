import { describe, expect, it } from "vitest";
import {
  mergeResumifyEditorIntoBaseResume,
} from "@/lib/falood/resumeDocumentAdapters";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";

describe("base resume custom-section persistence", () => {
  const editorData = (customSections: unknown[]) => ({
    personalInfo: { fullName: "Jane Doe", email: "jane@example.com" },
    summary: "Summary",
    experience: [],
    education: [],
    projects: [],
    skills: { mode: "simple", simple: [], categorized: [] },
    customSections,
    sections: [],
    colors: {},
    template: "business-professional",
    pageFormat: "a4",
    fontSize: 10,
    fontFamily: "Inter",
    pagePadding: 24,
  });

  it("does not recreate a deleted Certifications section from the legacy field", () => {
    const existing = {
      header: { fullName: "Jane Doe" },
      summary: { text: "Summary" },
      skills: [],
      experience: [],
      education: [],
      projects: [],
      customSections: [],
      certifications: [{ name: "PMP", issuer: "PMI", date: "2024" }],
      formatting: { styleId: "original-style", pageFormat: "letter" },
    };

    const saved = mergeResumifyEditorIntoBaseResume(existing, editorData([]));
    const reopened = studioDocumentToResumeData(saved);

    expect(saved.certifications).toEqual([]);
    expect(saved.customSections).toEqual([]);
    expect(reopened.customSections).toEqual([]);
    expect(saved.formatting).toEqual(existing.formatting);
  });

  it("persists deletion of a legacy certificate while retaining other custom sections", () => {
    const existing = {
      header: { fullName: "Jane Doe" },
      certifications: [{ name: "PMP", issuer: "PMI" }],
      customSections: [],
    };
    const awards = {
      id: "awards",
      title: "Awards",
      content: "Employee of the Year",
      type: "bullets",
      visible: true,
      order: 1,
      placement: "right",
    };

    const saved = mergeResumifyEditorIntoBaseResume(existing, editorData([awards]));
    const reopened = studioDocumentToResumeData(saved);

    expect(saved.certifications).toEqual([]);
    expect(reopened.customSections.map((section) => section.title)).toEqual(["Awards"]);
    expect(reopened.customSections[0].content).toBe("Employee of the Year");
  });

  it("keeps native base-resume rows native and removes stale legacy certifications", () => {
    const existing = {
      personalInfo: { fullName: "Old Name" },
      summary: "Old summary",
      certifications: [{ name: "PMP" }],
      customSections: [{ id: "old", title: "Old", content: "Old content" }],
      formatting: { styleId: "native-style" },
    };
    const replacement = editorData([{ id: "new", title: "Languages", content: "English" }]);

    const saved = mergeResumifyEditorIntoBaseResume(existing, replacement);
    const reopened = studioDocumentToResumeData(saved);

    expect(saved.personalInfo).toEqual(replacement.personalInfo);
    expect(saved.certifications).toEqual([]);
    expect(reopened.customSections.map((section) => section.title)).toEqual(["Languages"]);
    expect(saved.formatting).toEqual(existing.formatting);
  });

  it("does not erase legacy sections for an older caller that omits customSections", () => {
    const existing = {
      header: { fullName: "Jane Doe" },
      certifications: [{ name: "PMP" }],
      customSections: [{ id: "old", title: "Awards", bullets: [{ text: "Winner" }] }],
    };

    const saved = mergeResumifyEditorIntoBaseResume(existing, {
      personalInfo: { fullName: "Jane Doe" },
      summary: "Updated summary",
    });

    expect(saved.certifications).toEqual(existing.certifications);
    expect(saved.customSections).toEqual(existing.customSections);
  });
});
