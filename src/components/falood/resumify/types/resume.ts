export interface PersonalInfo {
  fullName: string;
  jobTitle: string;
  email: string;
  phone: string;
  location: string;
  website?: string;
  linkedin?: string;
  github?: string;
  profileImage?: string;
  birthDate?: string;
}

export interface Experience {
  id: string;
  jobTitle: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
  bulletPoints: string[];
}

export interface Education {
  id: string;
  degree: string;
  institution: string;
  location: string;
  graduationYear: string;
  gpa?: string;
  honors?: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  technologies: string[];
  liveUrl?: string;
  githubUrl?: string;
  startDate?: string;
  endDate?: string;
}

export interface SkillCategory {
  id: string;
  name: string;
  skills: string[];
}

export interface Skills {
  mode: 'simple' | 'categorized';
  simple: string[];
  categorized: SkillCategory[];
}

export interface CustomSection {
  id: string;
  title: string;
  content: string;
  type: 'paragraph' | 'bullets';
  visible: boolean;
  order: number;
  placement?: 'left' | 'right';
}

export interface ResumeColors {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  background: string;
}

export interface ResumeSection {
  id: string;
  title: string;
  visible: boolean;
  order: number;
}

export interface ResumeData {
  personalInfo: PersonalInfo;
  summary: string;
  experience: Experience[];
  education: Education[];
  projects: Project[];
  skills: Skills;
  customSections: CustomSection[];
  sections: ResumeSection[];
  colors: ResumeColors;
  template: TemplateType;
  pageFormat: 'letter' | 'a4';
  fontSize: number;
  fontFamily: string;
  pagePadding: number;
}

export type TemplateType = 'tech-sidebar' | 'business-professional' | 'business-professional-2' | 'business-professional-3' | 'business-professional-4' | 'modern-minimal' | 'elegant-timeline' | 'creative-modern' | 'bjet-professional';

export interface TemplateConfig {
  id: TemplateType;
  name: string;
  description: string;
  category: 'tech' | 'business' | 'creative';
  layout: 'single-column' | 'two-column' | 'sidebar';
  fontFamily: string;
  colorScheme: string[];
  features: string[];
}

export const DEFAULT_COLORS: ResumeColors = {
  primary: '#374151',
  secondary: '#6b7280',
  accent: '#3b82f6',
  text: '#1f2937',
  background: '#ffffff'
};

export const DEFAULT_PAGE_PADDING = 0.75;

// Single source of truth for the initial/fallback font size (points), used
// by ResumeContext's initial state, the old-format-resume conversion in the
// base resume editor, and the Typography control's display fallback - kept
// here instead of duplicated as a bare `10` in each of those.
export const DEFAULT_FONT_SIZE = 10;

// Physical paper geometry, derived from the real page sizes rather than
// restated as pixel literals. CSS defines one inch as exactly 96px, so every
// value the preview needs (px for scaling maths, CSS units for layout) comes
// from these two source dimensions.
export const CSS_PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

const PAGE_SIZE_INCHES: Record<ResumeData['pageFormat'], { width: number; height: number }> = {
  a4: { width: 210 / MM_PER_INCH, height: 297 / MM_PER_INCH },
  letter: { width: 8.5, height: 11 },
};

/** Page size in CSS pixels — used for scale maths and page-boundary offsets. */
export function getPageSizePx(pageFormat: ResumeData['pageFormat']) {
  const { width, height } = PAGE_SIZE_INCHES[pageFormat] ?? PAGE_SIZE_INCHES.a4;
  return { width: width * CSS_PX_PER_INCH, height: height * CSS_PX_PER_INCH };
}

/** Page size as CSS length strings — used for the paper element's own box. */
export function getPageSizeCss(pageFormat: ResumeData['pageFormat']) {
  return pageFormat === 'letter'
    ? { width: '8.5in', height: '11in' }
    : { width: '210mm', height: '297mm' };
}

// Slack before content counts as having spilled onto another page. A page is
// a fractional pixel height (A4 is 1122.52px), while offsetHeight is a
// rounded integer, so an exactly-one-page resume measures a hair "taller"
// than the page it fits on. Shared so the preview's page count and the
// editors' overflow banner can never disagree by a rounding error.
export const PAGE_OVERFLOW_TOLERANCE_PX = 1;

export const DEFAULT_SECTIONS: ResumeSection[] = [
  { id: 'summary', title: 'Professional Summary', visible: true, order: 1 },
  { id: 'skills', title: 'Skills', visible: true, order: 2 },
  { id: 'experience', title: 'Experience', visible: true, order: 3 },
  { id: 'projects', title: 'Projects', visible: true, order: 4 },
  { id: 'education', title: 'Education', visible: true, order: 5 },
  { id: 'custom', title: 'Custom Sections', visible: true, order: 6 }
];

export const TEMPLATE_CONFIGS: TemplateConfig[] = [
  {
    id: 'tech-sidebar',
    name: 'Tech Sidebar',
    description: 'Perfect for developers and engineers with sidebar layout',
    category: 'tech',
    layout: 'sidebar',
    fontFamily: 'Inter',
    colorScheme: ['#3b82f6', '#06b6d4', '#8b5cf6'],
    features: ['Profile photo', 'Two-column layout', 'Tech-focused design']
  },
  {
    id: 'business-professional',
    name: 'Business Professional 1',
    description: 'Classic centered design for corporate roles',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Georgia',
    colorScheme: ['#1f2937', '#4b5563', '#6b7280'],
    features: ['Single column', 'Professional typography', 'Minimal design']
  },
  {
    id: 'business-professional-2',
    name: 'Business Professional 2',
    description: 'Left-aligned executive design with refined rules',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Georgia',
    colorScheme: ['#1f2937', '#4b5563', '#9ca3af'],
    features: ['Executive header', 'Double rules', 'Traditional layout']
  },
  {
    id: 'business-professional-3',
    name: 'Business Professional 3',
    description: 'Modern monochrome executive design',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Georgia',
    colorScheme: ['#111111', '#3f3f46', '#ffffff'],
    features: ['Oversized name', 'Vertical section rules', 'Modern executive style']
  },
  {
    id: 'business-professional-4',
    name: 'Business Professional 4',
    description: 'Polished editorial design with a subtle side accent',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Georgia',
    colorScheme: ['#1f2937', '#4b5563', '#6b7280'],
    features: ['Side accent', 'Editorial headings', 'Compact spacing']
  },
  {
    id: 'modern-minimal',
    name: 'Modern Minimal',
    description: 'Balanced design for creative and technical roles',
    category: 'creative',
    layout: 'two-column',
    fontFamily: 'Poppins',
    colorScheme: ['#10b981', '#f59e0b', '#ef4444'],
    features: ['Bold sections', 'Modern typography', 'Color accents']
  },
  {
    id: 'elegant-timeline',
    name: 'Elegant Timeline',
    description: 'Timeline-based layout focusing on career progression',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Lato',
    colorScheme: ['#6366f1', '#8b5cf6', '#ec4899'],
    features: ['Timeline design', 'Career-focused', 'Elegant styling']
  },
  {
    id: 'creative-modern',
    name: 'Creative Modern',
    description: 'Bold and creative design for creative professionals',
    category: 'creative',
    layout: 'two-column',
    fontFamily: 'Source Sans Pro',
    colorScheme: ['#f59e0b', '#ef4444', '#8b5cf6'],
    features: ['Creative layout', 'Bold colors', 'Modern design']
  },
  {
    id: 'bjet-professional',
    name: 'B-JET Professional',
    description: 'Formal table-based CV format for professional applications',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Arial',
    colorScheme: ['#1e3a8a', '#93c5fd', '#1f2937'],
    features: ['Table layout', 'Formal structure', 'Multi-section support']
  }
];
