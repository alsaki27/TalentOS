import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getCandidateResumePreview } from "@/lib/candidateResumePreview";
import { CandidateParsedResumeDetails } from "@/components/candidates/CandidateParsedResumeDetails";
import { CandidateResumeParseSummary } from "@/components/candidates/CandidateResumeParseSummary";

const studioResume = {
  header: { fullName: "Example Candidate", email: "candidate@example.invalid", phone: "555-0100", location: "New York", linkedin: "https://example.invalid/profile" },
  summary: { id: "summary", text: "Engineering professional" },
  skills: [{ id: "design", title: "Design", skills: ["CAD", "Drafting"] }, { id: "tools", title: "Tools", skills: ["Excel"] }],
  experience: [{ id: "job", company: "Example Company", title: "Designer" }],
  education: [{ id: "degree", school: "Example University", degree: "Engineering" }],
  certifications: [{ id: "cert", name: "Example Certification" }],
};

function renderOverview(parsed: unknown) {
  return renderToStaticMarkup(createElement(CandidateResumeParseSummary, { parsed }, createElement(CandidateParsedResumeDetails, { parsed })));
}

describe("candidate resume preview", () => {
  it("renders grouped Resume Studio data even while extracted details are collapsed", () => {
    const html = renderOverview(studioResume);
    expect(html).toContain("<details");
    expect(html).not.toContain(" open=");
    expect(html).toContain("Example Candidate");
    expect(html).toContain("candidate@example.invalid");
    expect(html).toContain("Engineering professional");
    expect(html).toContain("Design</strong>");
    expect(html).toContain("Drafting</span>");
    expect(html).toContain("Skills <strong>3</strong>");
    expect(html).toContain("Name <strong>Found</strong>");
    expect(html).not.toContain("[object Object]");
  });

  it("retains flat parser output and mixed string/object certifications", () => {
    const parsed = {
      name: "Parsed Candidate", email: "parsed@example.invalid", phone: "555-0199", location: "Boston",
      skills: ["Python", "SQL"], experience: [{ company: "Company", title: "Engineer" }],
      education: [{ school: "School", degree: "Degree" }], certifications: ["Certificate One", { name: "Certificate Two" }],
    };
    const html = renderOverview(parsed);
    expect(html).toContain("Parsed Candidate");
    expect(html).toContain("Company — Engineer");
    expect(html).toContain("School — Degree");
    expect(html).toContain("Certificate One");
    expect(html).toContain("Certificate Two");
    expect(html).toContain("Skills <strong>2</strong>");
    expect(html).toContain("Certifications <strong>2</strong>");
  });

  it("counts valid skill entries rather than group objects and ignores unusable JSON values", () => {
    const parsed = { skills: [null, 123, " SQL ", { title: "Tools", skills: ["CAD", null, { id: "metadata" }, ""] }, { id: "empty" }] };
    expect(getCandidateResumePreview(parsed).skillCount).toBe(2);
    const html = renderOverview(parsed);
    expect(html).toContain("SQL</span>");
    expect(html).toContain("CAD</span>");
    expect(html).not.toContain("metadata");
    expect(html).not.toContain("123");
  });

  it("never renders raw objects or calls map on malformed sections", () => {
    const parsed = {
      name: { first: "not a string" }, email: ["not a string"], phone: true, location: { city: "not a string" },
      skills: { length: 1 }, experience: [null, { company: { name: "not a string" }, title: "Valid title" }],
      education: "not an array", certifications: [null, { name: { nested: true } }, { title: "Valid certificate" }],
    };
    const html = renderOverview(parsed);
    expect(html).toContain("Valid title");
    expect(html).toContain("Valid certificate");
    expect(html).toContain("Not found");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("not a string");
  });

  it.each([null, undefined, [], "unstructured text", 42, {}])("handles an empty or unsupported resume: %j", (parsed) => {
    expect(renderOverview(parsed)).toContain("No structured data was extracted");
  });

  it.each(["Parser unavailable", { message: "Parser unavailable" }, true])("shows parse errors safely: %j", (parse_error) => {
    const html = renderOverview({ ...studioResume, parse_error });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Parsing failed:");
    expect(html).not.toContain("View extracted details");
    expect(renderToStaticMarkup(createElement(CandidateParsedResumeDetails, { parsed: { parse_error } }))).toContain("Parsing failed:");
  });

  it("reads structured contact details without overwriting missing values with objects", () => {
    const contact = getCandidateResumePreview({
      header: { fullName: "Studio Candidate", email: " ", phone: {}, github: "https://example.invalid/code" },
      personalInfo: { location: "Remote", website: "https://example.invalid" },
      name: "Old name", email: "flat@example.invalid", phone: "555-0188", linkedin_url: { href: "invalid" },
    }).contact;
    expect(contact).toEqual({ name: "Studio Candidate", email: "flat@example.invalid", phone: "555-0188", location: "Remote", github_url: "https://example.invalid/code", portfolio_url: "https://example.invalid", linkedin_url: "" });
  });

  it("does not rewrite the original saved resume document", () => {
    const before = JSON.stringify(studioResume);
    renderOverview(studioResume);
    expect(JSON.stringify(studioResume)).toBe(before);
  });
});
