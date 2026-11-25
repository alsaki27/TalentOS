import { currentExperienceIndex, isPresentEndDate } from "@/lib/falood/currentEmployment";
import {
  DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_LINE_SPACING, DEFAULT_PAGE_PADDING,
  DEFAULT_SECTIONS, DEFAULT_TITLE_SPACING, normalizeTitleSpacing, type Experience, type ResumeData,
} from '../types/resume';

export const INITIAL_RESUME_DATA: ResumeData = {
  personalInfo: {
    fullName: '', jobTitle: '', email: '', phone: '', location: '',
    website: '', linkedin: '', github: '', profileImage: '', birthDate: '',
  },
  summary: '',
  experience: [],
  education: [],
  projects: [],
  skills: { mode: 'simple', simple: [], categorized: [] },
  customSections: [],
  sections: DEFAULT_SECTIONS,
  colors: DEFAULT_COLORS,
  template: 'business-professional',
  pageFormat: 'a4',
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: 'Inter',
  pagePadding: DEFAULT_PAGE_PADDING,
  lineSpacing: DEFAULT_LINE_SPACING,
  titleSpacing: DEFAULT_TITLE_SPACING,
};

export function normalizeImportedResumeData(input: Partial<ResumeData>): ResumeData {
  const data = { ...INITIAL_RESUME_DATA, ...input };
  data.experience = withSingleCurrentExperience(Array.isArray(data.experience) ? data.experience : []);
  if (!Number.isFinite(data.fontSize)) data.fontSize = DEFAULT_FONT_SIZE;
  data.titleSpacing = normalizeTitleSpacing(data.titleSpacing);
  if (data.skills?.categorized) {
    data.skills = {
      ...data.skills,
      categorized: data.skills.categorized.map((category, index) => ({
        ...category,
        id: category.id || `import-cat-${Date.now()}-${index}`,
      })),
    };
  }
  return data;
}

/** Older resumes can have several current roles. Keep the first in resume order. */
export function withSingleCurrentExperience(experience: Experience[]): Experience[] {
  const currentIndex = currentExperienceIndex(experience);
  return experience.map((entry, index) => ({
    ...entry,
    current: index === currentIndex,
    endDate: isPresentEndDate(entry.endDate) ? "" : entry.endDate,
  }));
}
