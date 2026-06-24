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
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: string;
}

export type TemplateType = 'tech-sidebar' | 'business-professional' | 'modern-minimal' | 'elegant-timeline' | 'creative-modern' | 'bjet-professional';

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
  primary: '#3b82f6',
  secondary: '#6b7280',
  accent: '#10b981',
  text: '#1f2937',
  background: '#ffffff'
};

export const DEFAULT_SECTIONS: ResumeSection[] = [
  { id: 'summary', title: 'Professional Summary', visible: true, order: 1 },
  { id: 'experience', title: 'Experience', visible: true, order: 2 },
  { id: 'projects', title: 'Projects', visible: true, order: 3 },
  { id: 'education', title: 'Education', visible: true, order: 4 },
  { id: 'skills', title: 'Skills', visible: true, order: 5 },
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
    name: 'Business Professional',
    description: 'Clean and formal design for corporate roles',
    category: 'business',
    layout: 'single-column',
    fontFamily: 'Georgia',
    colorScheme: ['#1f2937', '#4b5563', '#6b7280'],
    features: ['Single column', 'Professional typography', 'Minimal design']
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