import { describe, it, expect } from "vitest";
import { autoFitOnePage, FLOORS } from "@/lib/falood/autoFit";
import { READABILITY_FLOOR_FONT_SIZE, renderResumePdfWithMetrics } from "@/lib/falood/skarionPdfDocument";
import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";
import type { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";

const BASE_FORMATTING: ResumeFormatting = {
  styleId: "default",
  pageFormat: "letter",
  fontFamily: "Helvetica",
  fontSize: 10.5,
  marginTop: 0.5,
  marginRight: 0.5,
  marginBottom: 0.5,
  marginLeft: 0.5,
  sectionSpacing: 5,
  bulletSpacing: 1,
  lineHeight: 1.15,
};

function makeBullets(n: number): { id: string; text: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    text: `Delivered measurable impact on project number ${i} through cross-functional collaboration and technical execution.`,
  }));
}

function makeDocument(experienceCount: number, bulletsPerRole: number, formatting: ResumeFormatting = BASE_FORMATTING): ResumeDocument {
  return {
    header: { fullName: "Jordan Example", email: "jordan@example.com", phone: "555-0100", location: "Remote" },
    summary: { id: "sum", text: "A short professional summary describing relevant experience and goals." },
    skills: [{ id: "skg1", title: "Core Skills", skills: ["TypeScript", "React", "Node.js", "PostgreSQL"] }],
    experience: Array.from({ length: experienceCount }, (_, i) => ({
      id: `exp${i}`,
      title: "Software Engineer",
      company: `Company ${i}`,
      location: "Remote",
      startDate: "Jan 2020",
      endDate: "Dec 2021",
      bullets: makeBullets(bulletsPerRole),
    })),
    education: [{ id: "edu1", degree: "B.S. Computer Science", school: "State University", graduationDate: "2019" }],
    formatting,
  };
}

describe("autoFitOnePage", () => {
  it("returns immediately, unchanged, when content already fits one page", async () => {
    const content = makeDocument(1, 1);
    const result = await autoFitOnePage(content);
    expect(result.fitsOnePage).toBe(true);
    expect(result.actionsApplied).toEqual([]);
    expect(result.content).toBe(content);
  });

  it("never tries font size before line height when both are needed", async () => {
    // A moderate overflow — enough to require more than the cheap steps, likely reaching
    // both line-height and font-size reduction before it's done.
    const content = makeDocument(2, 7);
    const result = await autoFitOnePage(content);
    const lineHeightIdx = result.actionsApplied.indexOf("Reduce line height");
    const fontSizeIdx = result.actionsApplied.indexOf("Reduce font size");
    if (lineHeightIdx !== -1 && fontSizeIdx !== -1) {
      expect(lineHeightIdx).toBeLessThan(fontSizeIdx);
    }
  });

  it("never touches content when formatting alone cannot reach one page — only formatting changes", async () => {
    const content = makeDocument(8, 10); // far beyond what formatting reduction alone can fix
    const result = await autoFitOnePage(content);
    expect(result.fitsOnePage).toBe(false);
    expect(result.content.header).toEqual(content.header);
    expect(result.content.summary).toEqual(content.summary);
    expect(result.content.skills).toEqual(content.skills);
    expect(result.content.experience).toEqual(content.experience);
    expect(result.content.education).toEqual(content.education);
  });

  it("stops reducing at the documented floors and never crosses them", async () => {
    const content = makeDocument(8, 10);
    const result = await autoFitOnePage(content);
    expect(result.content.formatting.fontSize).toBeGreaterThanOrEqual(FLOORS.fontSize);
    expect(result.content.formatting.lineHeight).toBeGreaterThanOrEqual(FLOORS.lineHeight);
    expect(result.content.formatting.sectionSpacing).toBeGreaterThanOrEqual(FLOORS.sectionSpacing);
    expect(result.content.formatting.bulletSpacing).toBeGreaterThanOrEqual(FLOORS.bulletSpacing);
  });

  it("keeps the font-size floor in sync with the renderer's readability floor", () => {
    expect(FLOORS.fontSize).toBe(READABILITY_FLOOR_FONT_SIZE);
  });

  it("returns real metrics matching a direct render of the final content", async () => {
    const content = makeDocument(1, 1);
    const result = await autoFitOnePage(content);
    const direct = renderResumePdfWithMetrics(normalizeResumeContentForExport(result.content));
    expect(result.metrics?.pageCount).toBe(direct.metrics.pageCount);
  });
});
