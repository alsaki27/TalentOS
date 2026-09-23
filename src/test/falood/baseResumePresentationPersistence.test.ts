// Regression coverage for base resumes losing every Customize/Settings
// change on reopen.
//
// base_resumes.content is stored in two shapes; the canonical
// (header/skills/experience) one - 66 of 75 real rows - has no home for the
// editor's presentation settings, so the save path dropped them and every
// read path re-applied hardcoded defaults. The result was a closed loop: a
// canonical base resume could never keep a template, color, font, page
// format, padding, or section-order change, while tailored resumes were
// unaffected because falood_saved_applications stores editor state verbatim.

import { describe, expect, it } from "vitest";
import { mergeResumifyEditorIntoBaseResume } from "@/lib/falood/resumeDocumentAdapters";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import { readResumePresentation, pickResumePresentation } from "@/lib/falood/resumePresentation";
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_PAGE_PADDING } from "@/components/falood/resumify/types/resume";

/** A real canonical base_resumes.content row: no editor presentation fields. */
const canonicalRow = () => ({
  header: { fullName: "Jane Doe", email: "jane@example.com" },
  summary: { text: "Summary" },
  skills: [{ title: "Core", skills: ["CAD"] }],
  experience: [],
  education: [],
  projects: [],
  customSections: [],
  certifications: [],
  formatting: { styleId: "skarion_compact_professional" },
});

const editedPresentation = {
  template: "tech-sidebar",
  fontSize: 14,
  fontFamily: "Poppins",
  pageFormat: "letter",
  pagePadding: 0.4,
  colors: { ...DEFAULT_COLORS, primary: "#ff0000" },
  sections: [
    { id: "summary", title: "Professional Summary", visible: true, order: 1 },
    { id: "projects", title: "Projects", visible: false, order: 2 },
  ],
};

describe("base resume presentation persistence", () => {
  it("round-trips every Customize/Settings setting through a canonical row", () => {
    const stored = canonicalRow();
    const opened = studioDocumentToResumeData(stored);

    const saved = mergeResumifyEditorIntoBaseResume(stored, { ...opened, ...editedPresentation });
    const reopened = studioDocumentToResumeData(saved);

    expect(reopened.template).toBe("tech-sidebar");
    expect(reopened.fontSize).toBe(14);
    expect(reopened.fontFamily).toBe("Poppins");
    expect(reopened.pageFormat).toBe("letter");
    expect(reopened.pagePadding).toBe(0.4);
    expect(reopened.colors.primary).toBe("#ff0000");
    expect(reopened.sections.find((s) => s.id === "projects")?.visible).toBe(false);
  });

  it("round-trips the same settings through an editor-native row", () => {
    const nativeRow = {
      personalInfo: { fullName: "Jane Doe" },
      summary: "Summary",
      experience: [],
      education: [],
      projects: [],
      skills: { mode: "simple", simple: [], categorized: [] },
      customSections: [],
      ...editedPresentation,
    };

    const saved = mergeResumifyEditorIntoBaseResume(nativeRow, nativeRow);
    const reopened = studioDocumentToResumeData(saved);

    expect(reopened.template).toBe("tech-sidebar");
    expect(reopened.fontSize).toBe(14);
    expect(reopened.colors.primary).toBe("#ff0000");
    expect(reopened.pageFormat).toBe("letter");
  });

  it("still applies defaults to a row that has never had presentation saved", () => {
    const opened = studioDocumentToResumeData(canonicalRow());

    expect(opened.template).toBe("business-professional");
    expect(opened.fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(opened.fontFamily).toBe("Inter");
    expect(opened.pagePadding).toBe(DEFAULT_PAGE_PADDING);
    expect(opened.colors).toEqual(DEFAULT_COLORS);
  });

  it("leaves stored presentation alone for a content-only caller", () => {
    const stored = { ...canonicalRow(), ...editedPresentation };

    // An older API client that syncs content but knows nothing about
    // presentation must not reset it.
    const saved = mergeResumifyEditorIntoBaseResume(stored, {
      personalInfo: { fullName: "Jane Doe" },
      summary: "Updated summary",
    });

    expect(saved.template).toBe("tech-sidebar");
    expect(saved.fontSize).toBe(14);
    expect((saved.colors as any).primary).toBe("#ff0000");
  });

  it("never rewrites the canonical formatting block the PDF renderer reads", () => {
    const stored = canonicalRow();
    const saved = mergeResumifyEditorIntoBaseResume(stored, {
      ...studioDocumentToResumeData(stored),
      ...editedPresentation,
    });

    expect(saved.formatting).toEqual(stored.formatting);
  });
});

describe("readResumePresentation", () => {
  it("falls back per field instead of all-or-nothing", () => {
    const result = readResumePresentation({ fontSize: 13, colors: { primary: "#123456" } });

    expect(result.fontSize).toBe(13);
    expect(result.colors.primary).toBe("#123456");
    expect(result.colors.text).toBe(DEFAULT_COLORS.text); // untouched key keeps its default
    expect(result.fontFamily).toBe("Inter");
    expect(result.template).toBe("business-professional");
  });

  it("maps legacy named font sizes to point values", () => {
    expect(readResumePresentation({ fontSize: "medium" }).fontSize).toBe(11);
    expect(readResumePresentation({ fontSize: "large" }).fontSize).toBe(12);
    expect(readResumePresentation({ fontSize: "nonsense" }).fontSize).toBe(DEFAULT_FONT_SIZE);
  });

  it("clamps a font size outside the editor's own dropdown range", () => {
    expect(readResumePresentation({ fontSize: 200 }).fontSize).toBe(16);
    expect(readResumePresentation({ fontSize: 1 }).fontSize).toBe(6);
  });

  it("rejects a template id that no longer exists", () => {
    expect(readResumePresentation({ template: "deleted-template" }).template).toBe("business-professional");
  });

  it("reads pageFormat from the canonical formatting block when the editor field is absent", () => {
    expect(readResumePresentation({ formatting: { pageFormat: "letter" } }).pageFormat).toBe("letter");
    // An explicit editor value always wins over the canonical block.
    expect(readResumePresentation({ pageFormat: "a4", formatting: { pageFormat: "letter" } }).pageFormat).toBe("a4");
  });

  it("returns a fresh sections array rather than the shared default instance", () => {
    const a = readResumePresentation({});
    const b = readResumePresentation({});
    a.sections[0].visible = false;
    expect(b.sections[0].visible).toBe(true);
  });
});

describe("pickResumePresentation", () => {
  it("returns only the keys the caller actually supplied", () => {
    expect(pickResumePresentation({ fontSize: 12, summary: "ignored" })).toEqual({ fontSize: 12 });
    expect(pickResumePresentation({})).toEqual({});
    expect(pickResumePresentation(null)).toEqual({});
  });
});
