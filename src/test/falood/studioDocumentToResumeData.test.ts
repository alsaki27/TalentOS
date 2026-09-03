import { describe, it, expect } from "vitest";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";

describe("studioDocumentToResumeData - custom sections (header-shaped / studio-document input)", () => {
  it("carries real customSections through the 'header'-shaped legacy branch (previously dropped entirely)", () => {
    const doc = {
      header: { fullName: "Jane Doe", email: "jane@example.com" },
      summary: { text: "Summary" },
      skills: [],
      experience: [],
      education: [],
      customSections: [
        { id: "cs1", title: "Languages", bullets: [{ text: "English (native)" }, { text: "Spanish (fluent)" }] },
      ],
    };
    const result = studioDocumentToResumeData(doc as any);
    const languages = result.customSections.find((cs) => cs.title === "Languages");
    expect(languages).toBeDefined();
    expect(languages!.content).toBe("English (native)\nSpanish (fluent)");
    expect(languages!.visible).toBe(true);
  });

  it("carries customSections through when the shape is MIXED - canonical header but Resumify-native content:string custom sections (what applications/route.ts's PATCH sync-back actually writes to base_resumes.content)", () => {
    const doc = {
      header: { fullName: "Jane Doe" },
      summary: { text: "Summary" },
      customSections: [
        { id: "cs1", title: "Publications", content: "Paper One\nPaper Two", type: "paragraph", visible: true, order: 9, placement: "left" },
      ],
    };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.customSections).toHaveLength(1);
    expect(result.customSections[0]).toMatchObject({
      title: "Publications",
      content: "Paper One\nPaper Two",
      type: "paragraph",
      visible: true,
      order: 9,
      placement: "left",
    });
  });

  it("still synthesizes a Certifications section from certifications, alongside real custom sections", () => {
    const doc = {
      header: { fullName: "Jane Doe" },
      customSections: [{ id: "cs1", title: "Awards", bullets: ["Employee of the Year"] }],
      certifications: [{ name: "PMP", issuer: "PMI" }],
    };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.customSections.map((cs) => cs.title)).toEqual(["Awards", "Certifications"]);
    // orders must not collide
    const orders = result.customSections.map((cs) => cs.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("drops a custom section with no title and no bullets instead of rendering an empty block", () => {
    const doc = {
      header: { fullName: "Jane Doe" },
      customSections: [{ id: "cs1", title: "", bullets: [] }],
    };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.customSections).toHaveLength(0);
  });

  it("handles a document with no customSections field at all", () => {
    const doc = { header: { fullName: "Jane Doe" } };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.customSections).toEqual([]);
  });

  it("still correctly handles the Resumify-native (personalInfo-shaped) branch for custom sections", () => {
    const doc = {
      personalInfo: { fullName: "Jane Doe" },
      customSections: [
        { id: "cs1", title: "Publications", content: "Paper A", type: "paragraph", visible: true, order: 1 },
      ],
    };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.customSections).toHaveLength(1);
    expect(result.customSections[0].title).toBe("Publications");
    expect(result.customSections[0].content).toBe("Paper A");
  });
});
