// src/lib/falood/resumePresentation.ts
// The Resumify editor's presentation settings - everything the Customize and
// Settings panels edit (template, colors, typography, page format/padding,
// and section visibility/order) as opposed to the resume's actual content.
//
// Why this exists: base_resumes.content is stored in two different shapes in
// production (confirmed live - 66 of 75 rows are the canonical
// header/skills/experience "studio document" shape, 9 are the Resumify-native
// personalInfo/... shape). The canonical shape has no place for these
// settings, so every read path independently hardcoded editor defaults
// (template: 'business-professional', fontSize: 10, DEFAULT_COLORS, ...) and
// the one write path (mergeResumifyEditorIntoBaseResume) dropped them
// entirely. The result was a closed loop where a canonical base resume could
// never keep a single Customize/Settings change: save wrote content-only,
// reopen re-applied the hardcoded defaults. Tailored resumes never hit this
// because falood_saved_applications.resume_data stores the editor's state
// verbatim with no shape conversion at all.
//
// Storing these fields alongside the canonical ones follows the precedent
// already set by customSections, which is likewise written back in its
// Resumify-native shape onto otherwise-canonical rows (see
// studioDocumentToResumeData.ts). Consumers of the canonical shape (the PDF
// pipeline, the candidate portal) ignore unknown keys, and `formatting` -
// the canonical styling block the Skarion PDF renderer reads - is
// deliberately left untouched so this cannot change any existing export.

import {
  ResumeData,
  ResumeColors,
  ResumeSection,
  TemplateType,
  TEMPLATE_CONFIGS,
  DEFAULT_COLORS,
  DEFAULT_PAGE_PADDING,
  DEFAULT_SECTIONS,
  DEFAULT_FONT_SIZE,
} from "@/components/falood/resumify/types/resume";

export type ResumePresentation = Pick<
  ResumeData,
  "template" | "colors" | "fontSize" | "fontFamily" | "pageFormat" | "pagePadding" | "sections"
>;

/** The exact keys that make up a presentation, so callers never restate them. */
export const RESUME_PRESENTATION_KEYS = [
  "template",
  "colors",
  "fontSize",
  "fontFamily",
  "pageFormat",
  "pagePadding",
  "sections",
] as const satisfies readonly (keyof ResumePresentation)[];

export const DEFAULT_FONT_FAMILY = "Inter";
export const DEFAULT_TEMPLATE: TemplateType = "business-professional";
export const DEFAULT_PAGE_FORMAT: ResumeData["pageFormat"] = "a4";

// Matches the ColorCustomizer dropdown's range - a stored value outside it
// would leave that Select with nothing to show.
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 16;

// Font size used to be a named size before it became a point value. Kept so
// documents written back then still open with a sensible size instead of
// silently falling back to the default.
const LEGACY_FONT_SIZES: Record<string, number> = { large: 12, medium: 11, small: 10 };

const VALID_TEMPLATE_IDS = new Set<string>(TEMPLATE_CONFIGS.map((t) => t.id));

function readTemplate(value: unknown): TemplateType {
  return typeof value === "string" && VALID_TEMPLATE_IDS.has(value)
    ? (value as TemplateType)
    : DEFAULT_TEMPLATE;
}

function readFontSize(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value));
  }
  if (typeof value === "string" && value in LEGACY_FONT_SIZES) {
    return LEGACY_FONT_SIZES[value];
  }
  return DEFAULT_FONT_SIZE;
}

function readPageFormat(value: unknown): ResumeData["pageFormat"] {
  return value === "letter" || value === "a4" ? value : DEFAULT_PAGE_FORMAT;
}

function readColors(value: unknown): ResumeColors {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_COLORS };
  const raw = value as Record<string, unknown>;
  // Merged per key rather than all-or-nothing: a document carrying only some
  // of the five colors keeps those and defaults the rest.
  const merged = { ...DEFAULT_COLORS };
  for (const key of Object.keys(DEFAULT_COLORS) as (keyof ResumeColors)[]) {
    if (typeof raw[key] === "string" && raw[key]) merged[key] = raw[key] as string;
  }
  return merged;
}

function readSections(value: unknown): ResumeSection[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_SECTIONS.map((s) => ({ ...s }));
  const sections = value
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object" && !Array.isArray(s))
    .map((s, index) => ({
      id: typeof s.id === "string" ? s.id : `section-${index}`,
      title: typeof s.title === "string" ? s.title : "",
      visible: s.visible !== false,
      order: typeof s.order === "number" && Number.isFinite(s.order) ? s.order : index + 1,
    }));
  return sections.length > 0 ? sections : DEFAULT_SECTIONS.map((s) => ({ ...s }));
}

/**
 * Reads presentation settings out of any stored resume content, in either
 * shape, falling back per field rather than all-or-nothing. `formatting` is
 * consulted only for pageFormat, the single setting that means exactly the
 * same thing in the canonical block as it does in the editor.
 */
export function readResumePresentation(content: unknown): ResumePresentation {
  const raw = content && typeof content === "object" && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
  const formatting = raw.formatting && typeof raw.formatting === "object" && !Array.isArray(raw.formatting)
    ? (raw.formatting as Record<string, unknown>)
    : {};

  return {
    template: readTemplate(raw.template),
    colors: readColors(raw.colors),
    fontSize: readFontSize(raw.fontSize),
    fontFamily: typeof raw.fontFamily === "string" && raw.fontFamily ? raw.fontFamily : DEFAULT_FONT_FAMILY,
    pageFormat: readPageFormat(raw.pageFormat ?? formatting.pageFormat),
    pagePadding: typeof raw.pagePadding === "number" && Number.isFinite(raw.pagePadding)
      ? raw.pagePadding
      : DEFAULT_PAGE_PADDING,
    sections: readSections(raw.sections),
  };
}

/**
 * Picks the presentation settings an editor save is actually carrying, for
 * writing back onto a stored resume. Only keys the caller supplied are
 * returned, so a caller that doesn't manage presentation at all (an older
 * API client, a content-only sync) leaves whatever is stored untouched
 * instead of resetting it to defaults.
 */
export function pickResumePresentation(resumeData: unknown): Partial<ResumePresentation> {
  const raw = resumeData && typeof resumeData === "object" && !Array.isArray(resumeData)
    ? (resumeData as Record<string, unknown>)
    : {};
  const picked: Record<string, unknown> = {};
  for (const key of RESUME_PRESENTATION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined) {
      picked[key] = raw[key];
    }
  }
  return picked as Partial<ResumePresentation>;
}
