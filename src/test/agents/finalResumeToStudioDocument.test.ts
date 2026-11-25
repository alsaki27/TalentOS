import { describe, it, expect } from "vitest";
import { finalResumeToStudioDocument, type RenderableResumeContent } from "@/lib/ai/application-agents/finalResumeToStudioDocument";
import { mergeResumifyEditorIntoBaseResume } from "@/lib/falood/resumeDocumentAdapters";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import { renderEvidenceReleasePdf } from "@/lib/ai/application-agents/resumeReleasePdf";

const minimalFinal: RenderableResumeContent = {
  summary: "Tailored summary.",
  skills: [{ name: "Core", skills: ["AutoCAD"] } as any],
  experience: [
    { title: "Drafter", company: "Acme", location: "Erie, PA", startDate: "2020", endDate: "Present", bullets: ["Did the thing."] } as any,
  ],
  education: [{ degree: "B.S.", school: "State U", graduationDate: "2019" } as any],
  certifications: [],
  projects: [],
};

it("carries saved base formatting and education through the generated Studio document", () => {
  const base = mergeResumifyEditorIntoBaseResume({ header: { fullName: "Test Candidate" } }, {
    personalInfo: { fullName: "Test Candidate", jobTitle: "Design Specialist" },
    template: "modern-minimal", pageFormat: "letter", fontSize: 11, titleSpacing: 0.25,
    experience: [{ id: "role", jobTitle: "Drafter", company: "Acme", current: false }],
    education: [{ id: "edu", degree: "B.S.", institution: "State U", graduationYear: "2019", gpa: "3.7/4.0" }],
    skills: { mode: "simple", simple: ["CAD"], categorized: [{ id: "unused", name: "Saved list", skills: ["Prior category"] }] },
    customSections: [{ id: "notes", title: "Notes", type: "paragraph", content: "First line\nSecond line", placement: "left", visible: true, order: 2 }],
  });
  const reopened = studioDocumentToResumeData(base);
  expect(reopened.personalInfo.jobTitle).toBe("Design Specialist");
  expect(reopened.experience[0].current).toBe(false);
  expect(reopened.skills).toMatchObject({ mode: "simple", simple: ["CAD"], categorized: [{ name: "Saved list" }] });
  const tailored = studioDocumentToResumeData(finalResumeToStudioDocument(minimalFinal, base));
  expect(tailored).toMatchObject({
    template: "modern-minimal", pageFormat: "letter", fontSize: 11, titleSpacing: 0.25,
    personalInfo: { jobTitle: "Design Specialist" },
    education: [{ gpa: "3.7/4.0" }],
    skills: { mode: "simple", simple: ["AutoCAD"] },
    customSections: [{ id: "notes", type: "paragraph", content: "First line\nSecond line", placement: "left", order: 2 }],
  });
});

describe("finalResumeToStudioDocument custom sections pass-through", () => {
  it.each([true, false])("respects saved certification visibility (%s) in the generated document and release PDF", async (visible) => {
    const base = {
      header: { fullName: "Test Candidate" },
      sections: [{ id: "certifications", title: "Certifications", visible, order: 1 }],
      certifications: ["LegacyCredential", { id: "cert-2", name: "StoredCredential", issuer: "Example", date: "2024" }],
      customSections: [
        { id: "award", title: "Awards", type: "paragraph", content: "SavedAward", visible: true },
        { id: "private", title: "Hidden", type: "bullets", content: "HiddenAward", visible: false },
      ],
    };
    const before = JSON.stringify(base);
    const final = finalResumeToStudioDocument({ ...minimalFinal, certifications: [] }, base);
    expect(final.certifications).toEqual([
      expect.objectContaining({ name: "LegacyCredential" }),
      { id: "cert-2", name: "StoredCredential", issuer: "Example", date: "2024" },
    ]);
    expect(studioDocumentToResumeData(final).customSections.map(s => s.content))
      .toEqual(studioDocumentToResumeData(base).customSections.filter(s => s.visible).map(s => s.content));
    const pdf = new TextDecoder().decode((await renderEvidenceReleasePdf(final, 2)).bytes);
    for (const text of ["LegacyCredential", "StoredCredential", "SavedAward"]) {
      expect(pdf.includes(text)).toBe(visible);
    }
    expect(pdf).not.toContain("HiddenAward");
    expect(JSON.stringify(base)).toBe(before);
  });

  it("carries Resumify-native shaped custom sections (content string) through unchanged", () => {
    const baseContent = {
      customSections: [
        { id: "cs1", title: "Languages", content: "English (native)\nSpanish (fluent)", type: "bullets", visible: true, order: 1 },
      ],
    };
    const doc = finalResumeToStudioDocument(minimalFinal, baseContent);
    expect(doc.customSections).toHaveLength(1);
    expect(doc.customSections![0].title).toBe("Languages");
    expect(doc.customSections![0].bullets.map((b) => b.text)).toEqual(["English (native)", "Spanish (fluent)"]);
  });

  it("carries canonical bullets-shaped custom sections through unchanged", () => {
    const baseContent = {
      customSections: [
        { id: "cs2", title: "Awards", bullets: [{ id: "b1", text: "Employee of the Year 2023" }] },
      ],
    };
    const doc = finalResumeToStudioDocument(minimalFinal, baseContent);
    expect(doc.customSections).toHaveLength(1);
    expect(doc.customSections![0].title).toBe("Awards");
    expect(doc.customSections![0].bullets.map((b) => b.text)).toEqual(["Employee of the Year 2023"]);
  });

  it("respects visible:false and drops hidden sections", () => {
    const baseContent = {
      customSections: [
        { id: "cs3", title: "Hidden", content: "should not appear", type: "paragraph", visible: false },
      ],
    };
    const doc = finalResumeToStudioDocument(minimalFinal, baseContent);
    expect(doc.customSections).toHaveLength(0);
  });

  it("drops empty/content-less sections instead of rendering a blank block", () => {
    const baseContent = { customSections: [{ id: "cs4", title: "Empty", content: "", bullets: [] }] };
    const doc = finalResumeToStudioDocument(minimalFinal, baseContent);
    expect(doc.customSections).toHaveLength(0);
  });

  it("handles a base resume with no customSections field at all", () => {
    const doc = finalResumeToStudioDocument(minimalFinal, {});
    expect(doc.customSections).toEqual([]);
  });

  it("a single 'paragraph' type section stays as one bullet, not split by newline", () => {
    const baseContent = {
      customSections: [{ id: "cs5", title: "Note", content: "Line one\nLine two", type: "paragraph", visible: true }],
    };
    const doc = finalResumeToStudioDocument(minimalFinal, baseContent);
    expect(doc.customSections![0].bullets).toHaveLength(1);
    expect(doc.customSections![0].bullets[0].text).toBe("Line one\nLine two");
  });
});
