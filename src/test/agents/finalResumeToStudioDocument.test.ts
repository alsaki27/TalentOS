import { describe, it, expect } from "vitest";
import { finalResumeToStudioDocument, type RenderableResumeContent } from "@/lib/ai/application-agents/finalResumeToStudioDocument";

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

describe("finalResumeToStudioDocument custom sections pass-through", () => {
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
