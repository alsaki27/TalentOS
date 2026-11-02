import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLORS,
  TEMPLATE_CONFIGS,
  type ResumeData,
} from "@/components/falood/resumify/types/resume";
import { ResumeTemplateSwitch } from "@/components/falood/resumify/components/preview/ResumeTemplateSwitch";
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
