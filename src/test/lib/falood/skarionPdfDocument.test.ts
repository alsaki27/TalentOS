import { describe, it, expect } from "vitest";
import { renderResumePdfDoc, renderResumePdfWithMetrics, READABILITY_FLOOR_FONT_SIZE } from "@/lib/falood/skarionPdfDocument";
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

function makeBullets(n: number, prefix = "Did a thing"): { id: string; text: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `b${i}`, text: `${prefix} number ${i} with enough words to occupy a realistic bullet line of resume text.` }));
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

describe("renderResumePdfWithMetrics", () => {
  it("pageCount always matches doc.getNumberOfPages()", () => {
    for (const [exp, bullets] of [[1, 2], [3, 6], [6, 8]] as [number, number][]) {
      const { doc, metrics } = renderResumePdfWithMetrics(makeDocument(exp, bullets));
      expect(metrics.pageCount).toBe(doc.getNumberOfPages());
    }
  });

  it("keeps contentUtilization within [0,1] and increases as more content is added", () => {
    const short = renderResumePdfWithMetrics(makeDocument(1, 1)).metrics;
    const medium = renderResumePdfWithMetrics(makeDocument(2, 4)).metrics;
    expect(short.contentUtilization).toBeGreaterThanOrEqual(0);
    expect(short.contentUtilization).toBeLessThanOrEqual(1);
    expect(medium.contentUtilization).toBeGreaterThanOrEqual(0);
    expect(medium.contentUtilization).toBeLessThanOrEqual(1);
    expect(medium.contentUtilization).toBeGreaterThan(short.contentUtilization);
  });

  it("overflow is true exactly when pageCount > 1", () => {
    const onePage = renderResumePdfWithMetrics(makeDocument(1, 1)).metrics;
    const manyPages = renderResumePdfWithMetrics(makeDocument(8, 10)).metrics;
    expect(onePage.overflow).toBe(onePage.pageCount > 1);
    expect(manyPages.pageCount).toBeGreaterThan(1);
    expect(manyPages.overflow).toBe(true);
  });

  it("reports 0 bottom whitespace on an overflowing (multi-page) document", () => {
    const { metrics } = renderResumePdfWithMetrics(makeDocument(8, 10));
    expect(metrics.pageCount).toBeGreaterThan(1);
    expect(metrics.bottomWhitespaceInches).toBe(0);
  });

  it("readable tracks the readability floor boundary exactly", () => {
    const below = renderResumePdfWithMetrics(makeDocument(1, 1, { ...BASE_FORMATTING, fontSize: READABILITY_FLOOR_FONT_SIZE - 0.1 })).metrics;
    const atFloor = renderResumePdfWithMetrics(makeDocument(1, 1, { ...BASE_FORMATTING, fontSize: READABILITY_FLOOR_FONT_SIZE })).metrics;
    const above = renderResumePdfWithMetrics(makeDocument(1, 1, { ...BASE_FORMATTING, fontSize: READABILITY_FLOOR_FONT_SIZE + 0.1 })).metrics;
    expect(below.readable).toBe(false);
    expect(atFloor.readable).toBe(true);
    expect(above.readable).toBe(true);
  });

  it("renderResumePdfDoc still returns a working jsPDF with the same page count as renderResumePdfWithMetrics", () => {
    const content = makeDocument(4, 6);
    const doc = renderResumePdfDoc(content);
    const { metrics } = renderResumePdfWithMetrics(content);
    expect(doc.getNumberOfPages()).toBe(metrics.pageCount);
    expect(typeof doc.output).toBe("function");
  });
});
