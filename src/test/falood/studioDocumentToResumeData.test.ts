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

describe("studioDocumentToResumeData - projects (Resumify-native / personalInfo-shaped input)", () => {
  it("carries liveUrl/githubUrl/startDate/endDate through (previously dropped every re-open)", () => {
    // This is the exact shape a base resume already edited in the studio is
    // stored as (see mergeResumifyEditorIntoBaseResume): personalInfo present,
    // so this hits normalizeResumifyNative, not the studio-document branch.
    // Every "Open in studio" click re-derives resume_data from this content -
    // before the fix, a project's link/GitHub/dates vanished on that very
    // next open even though the save that added them succeeded.
    const doc = {
      personalInfo: { fullName: "Jane Doe" },
      projects: [
        {
          id: "proj-1",
          title: "Portfolio Site",
          description: "Personal site",
          technologies: ["React"],
          liveUrl: "https://example.com",
          githubUrl: "https://github.com/example/portfolio",
          startDate: "2025-01",
          endDate: "2025-06",
        },
      ],
    };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      title: "Portfolio Site",
      liveUrl: "https://example.com",
      githubUrl: "https://github.com/example/portfolio",
      startDate: "2025-01",
      endDate: "2025-06",
    });
  });

  it("leaves the optional link/date fields undefined rather than empty strings when absent", () => {
    const doc = {
      personalInfo: { fullName: "Jane Doe" },
      projects: [{ id: "proj-1", title: "No links", description: "", technologies: [] }],
    };
    const result = studioDocumentToResumeData(doc as any);
    expect(result.projects[0].liveUrl).toBeUndefined();
    expect(result.projects[0].githubUrl).toBeUndefined();
    expect(result.projects[0].startDate).toBeUndefined();
    expect(result.projects[0].endDate).toBeUndefined();
  });
});
