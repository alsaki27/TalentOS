import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLORS,
  TEMPLATE_CONFIGS,
  type ResumeData,
} from "@/components/falood/resumify/types/resume";
import { ResumeTemplateSwitch } from "@/components/falood/resumify/components/preview/ResumeTemplateSwitch";
import { finalResumeToStudioDocument } from "@/lib/ai/application-agents/finalResumeToStudioDocument";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import { mergeResumifyEditorIntoBaseResume } from "@/lib/falood/resumeDocumentAdapters";
import { sectionsForPreview } from "@/lib/falood/resumePresentation";
import {
  getResumeProjectTitle,
  ResumeContactLine,
} from "@/components/falood/resumify/components/preview/ResumeTemplateParts";

const templateFixture: ResumeData = {
  personalInfo: {
    fullName: "Taylor Example",
    jobTitle: "Software Engineer",
    email: "taylor@example.com",
    phone: "+1 555 0100",
    location: "New York, NY",
    website: "www.example.com",
    linkedin: "https://www.linkedin.com/in/taylor-example",
    github: "github.com/taylor-example",
  },
  summary: "",
  experience: [],
  education: [],
  projects: [{
    id: "project-1",
    title: "E-commerce Platform",
    description: "A reliable online storefront.",
    technologies: [],
  }],
  skills: { mode: "simple", simple: [], categorized: [] },
  customSections: [],
  sections: [{ id: "projects", title: "Projects", visible: true, order: 1 }],
  colors: DEFAULT_COLORS,
  template: "business-professional",
  pageFormat: "a4",
  fontSize: 10,
  fontFamily: "Arial",
  pagePadding: 0.75,
  lineSpacing: 1.625,
    titleSpacing: 0.25,
};

describe.each(TEMPLATE_CONFIGS)("Resume template: $name", (template) => {
  it("shows visible custom content exactly once across older base and tailored layouts", () => {
    const certifications = { id: "certs", title: "Training and Certifications", type: "bullets" as const,
      content: "Credential One\nCredential Two", placement: "left" as const, visible: true, order: 1 };
    const customSections = [certifications,
      { ...certifications, id: "note", title: "Notes", type: "paragraph" as const, placement: "right" as const, content: "Reviewer-entered note" },
      { ...certifications, id: "hidden", title: "Hidden section", content: "Private draft entry", visible: false },
      { ...certifications, id: "empty", title: "Empty placeholder", content: " " },
    ];
    const legacy = { id: "certifications", title: "Certifications", order: 3, visible: true };
    const current = { id: "custom", title: "Custom Sections", order: 4, visible: true };
    for (const slots of [[], [legacy], [current], [legacy, current]]) {
      const original = { ...templateFixture, template: template.id, sections: [...templateFixture.sections, ...slots], customSections };
      const before = JSON.stringify(original);
      const editor = studioDocumentToResumeData(original);
      const saved = mergeResumifyEditorIntoBaseResume(original, editor);
      const tailored = finalResumeToStudioDocument({ summary: null, experience: [], education: [], skills: [], projects: [], certifications: [] }, saved);
      for (const data of [editor, studioDocumentToResumeData(saved), studioDocumentToResumeData(tailored)]) {
        const html = renderToStaticMarkup(createElement(ResumeTemplateSwitch, { data }));
        for (const label of ["Credential One", "Credential Two", "Reviewer-entered note"]) {
          expect(html.split(label)).toHaveLength(2);
        }
        expect(html).not.toMatch(/Private draft entry|Empty placeholder/i);
      }
      expect(saved.customSections).toEqual(customSections);
      expect(saved.sections).toEqual(original.sections);
      expect(JSON.stringify(original)).toBe(before);
    }
    for (const id of ["custom", "certifications"]) {
      const data = { ...templateFixture, template: template.id, sections: [{ ...legacy, id, visible: false }], customSections };
      expect(renderToStaticMarkup(createElement(ResumeTemplateSwitch, { data }))).not.toContain("Credential One");
      expect(data.customSections).toEqual(customSections);
    }
  });

  it("renders each supplied profile link and the project title", () => {
    const markup = renderToStaticMarkup(createElement(ResumeTemplateSwitch, {
      data: { ...templateFixture, template: template.id },
    }));

    expect(markup).toContain('href="https://www.example.com"');
    expect(markup).toContain(">Website</a>");
    expect(markup).toContain('href="https://www.linkedin.com/in/taylor-example"');
    expect(markup).toContain(">LinkedIn</a>");
    expect(markup).toContain('href="https://github.com/taylor-example"');
    expect(markup).toContain(">GitHub</a>");
    expect(markup).toContain("E-commerce Platform");
    expect(markup).toContain("--resume-title-spacing:0.25rem");
    expect(markup).toContain("line-height:1.625");
    expect(markup).toContain("h3.mb-3 { margin-bottom: calc(0.75rem + var(--resume-title-spacing, 0rem))");
  });
});

describe("Creative Modern project links", () => {
  it("renders supplied live and GitHub URLs as usable project links", () => {
    const markup = renderToStaticMarkup(createElement(ResumeTemplateSwitch, {
      data: {
        ...templateFixture,
        template: "creative-modern",
        projects: [{
          id: "linked-project",
          title: "Linked Project",
          description: "Project with both links.",
          technologies: [],
          liveUrl: "demo.example.com",
          githubUrl: "https://github.com/example/demo",
        }],
      },
    }));

    expect(markup).toContain('href="https://demo.example.com"');
    expect(markup).toContain(">Live Demo</a>");
    expect(markup).toContain('href="https://github.com/example/demo"');
    expect(markup).toContain(">GitHub Repository</a>");
  });
});

describe("shared resume template parts", () => {
  it("keeps the saved group position and gives explicit custom-group settings priority over the legacy slot", () => {
    const legacy = { id: "certifications", visible: true, title: "Certifications", order: 2 };
    const current = { id: "custom", visible: false, title: "Custom Sections", order: 4 };
    const other = { id: "education", visible: true, title: "Education", order: 8 };
    expect(sectionsForPreview([legacy, other])).toEqual([{ ...legacy, id: "custom" }, other]);
    expect(sectionsForPreview([legacy, other, current])).toEqual([other, current]);
    expect(sectionsForPreview([other])[1]).toMatchObject({ id: "custom", order: 9, visible: true });
  });
  it("places separators only between the available contact details", () => {
    const markup = renderToStaticMarkup(createElement(ResumeContactLine, {
      personalInfo: {
        fullName: "Taylor Example",
        jobTitle: "",
        email: "taylor@example.com",
        phone: "",
        location: "New York, NY",
        website: "",
        linkedin: "",
        github: "",
      },
      separator: "|",
    }));

    expect(markup.match(/\|/g)).toHaveLength(1);
    expect(markup).not.toMatch(/\|\s*<\/div>$/);
  });

  it("omits an empty contact line and resolves legacy project name fields", () => {
    const emptyLine = renderToStaticMarkup(createElement(ResumeContactLine, {
      personalInfo: {
        fullName: "",
        jobTitle: "",
        email: " ",
        phone: "",
        location: "",
        website: "",
        linkedin: "",
        github: "",
      },
      separator: "|",
    }));

    expect(emptyLine).toBe("");
    expect(getResumeProjectTitle({ title: "  ", name: "Legacy project" })).toBe("Legacy project");
    expect(getResumeProjectTitle({ title: "  ", name: "  " })).toBe("");
  });
});
