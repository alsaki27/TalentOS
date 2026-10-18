// Regression coverage for the data-loss incident (2026-10-15): a race in
// the Falood Studio tailor page's exit-flush logic PATCHed the blank
// placeholder resume over a candidate's real, reviewed/applied tailored
// resume. isResumeDataEffectivelyEmpty() is the shared backstop used both
// client-side (skip sending a doomed save) and server-side (refuse to
// persist one even if a client bug sends it anyway) - see
// src/lib/falood/resumeEmptyCheck.ts for the full writeup.

import { describe, it, expect } from "vitest";
import { isResumeDataEffectivelyEmpty } from "@/lib/falood/resumeEmptyCheck";

const BLANK = {
  personalInfo: { fullName: "", jobTitle: "", email: "", phone: "", location: "", website: "", linkedin: "", github: "", profileImage: "", birthDate: "" },
  summary: "",
  experience: [],
  education: [],
  projects: [],
  skills: { mode: "simple" as const, simple: [], categorized: [] },
};

describe("isResumeDataEffectivelyEmpty", () => {
  it("treats null/undefined as empty", () => {
    expect(isResumeDataEffectivelyEmpty(null)).toBe(true);
    expect(isResumeDataEffectivelyEmpty(undefined)).toBe(true);
  });

  it("treats the exact ResumeContext blank-default shape as empty - this is the shape that caused the incident", () => {
    expect(isResumeDataEffectivelyEmpty(BLANK)).toBe(true);
  });

  it("treats whitespace-only fields as empty (not a real name/summary)", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      personalInfo: { ...BLANK.personalInfo, fullName: "   " },
      summary: "\n\t ",
    })).toBe(true);
  });

  it("is NOT empty when fullName is present", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      personalInfo: { ...BLANK.personalInfo, fullName: "Mir Najiur Rahman" },
    })).toBe(false);
  });

  it("is NOT empty when only email is present", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      personalInfo: { ...BLANK.personalInfo, email: "person@example.com" },
    })).toBe(false);
  });

  it("is NOT empty when only summary is present", () => {
    expect(isResumeDataEffectivelyEmpty({ ...BLANK, summary: "Experienced designer." })).toBe(false);
  });

  it("is NOT empty when experience has entries", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      experience: [{ title: "Designer", company: "Janicki Industries", bullets: [], evidenceIds: [] }],
    })).toBe(false);
  });

  it("is NOT empty when education has entries", () => {
    expect(isResumeDataEffectivelyEmpty({ ...BLANK, education: [{ degree: "B.S.", school: "State U" }] })).toBe(false);
  });

  it("is NOT empty when projects has entries", () => {
    expect(isResumeDataEffectivelyEmpty({ ...BLANK, projects: [{ name: "Wayfinding system" }] })).toBe(false);
  });

  it("is NOT empty when simple skills has entries", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      skills: { mode: "simple" as const, simple: ["AutoCAD"], categorized: [] },
    })).toBe(false);
  });

  it("is NOT empty when categorized skills has entries, even if the simple list is empty", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      skills: { mode: "categorized" as const, simple: [], categorized: [{ id: "c1", title: "Design", skills: ["Revit"] }] },
    })).toBe(false);
  });

  it("IS empty when categorized skills exist as a group but every group's skills array is empty", () => {
    expect(isResumeDataEffectivelyEmpty({
      ...BLANK,
      skills: { mode: "categorized" as const, simple: [], categorized: [{ id: "c1", title: "Design", skills: [] }] },
    })).toBe(true);
  });
});
