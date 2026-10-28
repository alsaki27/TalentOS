// Regression coverage for the data-loss incident (2026-10-15): a race in
// the Falood Studio tailor page's exit-flush logic PATCHed the blank
// placeholder resume over a candidate's real, reviewed/applied tailored
// resume. isResumeDataEffectivelyEmpty() is the shared backstop used both
// client-side (skip sending a doomed save) and server-side (refuse to
// persist one even if a client bug sends it anyway) - see
// src/lib/falood/resumeEmptyCheck.ts for the full writeup.

import { describe, it, expect } from "vitest";
import { isResumeDataEffectivelyEmpty, shouldPersistResumeSnapshot } from "@/lib/falood/resumeEmptyCheck";

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

  // base_resumes.content also stores an older "canonical" shape (confirmed
  // live: ~88% of rows) - header.fullName instead of personalInfo.fullName,
  // summary as {id, text} instead of a plain string, and skills as a bare
  // array of {title, skills[]} groups. This check is reused against
  // base_resumes.content (see src/app/api/base-resumes/[id]/route.ts), so it
  // must recognize real content in that shape too, not just the
  // Resumify-native one.
  describe("canonical (older) content shape", () => {
    it("is NOT empty when only header.fullName is present", () => {
      expect(isResumeDataEffectivelyEmpty({ header: { fullName: "MD MAHBUBUL ALAM" } } as any)).toBe(false);
    });

    it("is NOT empty when only header.email is present", () => {
      expect(isResumeDataEffectivelyEmpty({ header: { email: "person@example.com" } } as any)).toBe(false);
    });

    it("is NOT empty when summary is the {id, text} object shape with real text", () => {
      expect(isResumeDataEffectivelyEmpty({ summary: { id: "summary", text: "Experienced engineer." } } as any)).toBe(false);
    });

    it("does not throw, and is empty, when summary is the {id, text} object shape with blank text", () => {
      expect(() => isResumeDataEffectivelyEmpty({ summary: { id: "summary", text: "   " } } as any)).not.toThrow();
      expect(isResumeDataEffectivelyEmpty({ summary: { id: "summary", text: "   " } } as any)).toBe(true);
    });

    it("is NOT empty when skills is a bare array of groups with real skills", () => {
      expect(isResumeDataEffectivelyEmpty({
        skills: [{ id: "g1", title: "Networking", skills: ["BGP", "MPLS"] }],
      } as any)).toBe(false);
    });

    it("IS empty when skills is a bare array of groups whose skills arrays are all empty", () => {
      expect(isResumeDataEffectivelyEmpty({
        skills: [{ id: "g1", title: "Networking", skills: [] }],
      } as any)).toBe(true);
    });

    it("is NOT empty for a fully-populated canonical resume with no personalInfo/summary string at all", () => {
      expect(isResumeDataEffectivelyEmpty({
        header: { fullName: "MD MAHBUBUL ALAM", email: "mahbub@example.com" },
        skills: [{ id: "g1", title: "Networking", skills: ["BGP"] }],
        experience: [{ id: "e1", title: "Senior Network Engineer", bullets: [] }],
      } as any)).toBe(false);
    });
  });
});

describe("shouldPersistResumeSnapshot", () => {
  const POPULATED = { ...BLANK, summary: "Experienced designer." };

  it("blocks when the initial load has not completed yet, even with real content", () => {
    expect(shouldPersistResumeSnapshot({
      hasLoadedInitialData: false,
      nextResumeData: POPULATED,
      lastSavedResumeData: POPULATED,
    })).toEqual({ allow: false, reason: "not_loaded" });
  });

  it("allows a normal save of real content once loaded", () => {
    expect(shouldPersistResumeSnapshot({
      hasLoadedInitialData: true,
      nextResumeData: POPULATED,
      lastSavedResumeData: POPULATED,
    })).toEqual({ allow: true });
  });

  it("blocks an empty snapshot from replacing a previously-saved non-empty one - the exact Oct 15 incident condition", () => {
    expect(shouldPersistResumeSnapshot({
      hasLoadedInitialData: true,
      nextResumeData: BLANK,
      lastSavedResumeData: POPULATED,
    })).toEqual({ allow: false, reason: "would_erase_content" });
  });

  it("allows an empty snapshot when the last-saved version was also empty (a brand-new, never-saved session's first save)", () => {
    expect(shouldPersistResumeSnapshot({
      hasLoadedInitialData: true,
      nextResumeData: BLANK,
      lastSavedResumeData: null,
    })).toEqual({ allow: true });
    expect(shouldPersistResumeSnapshot({
      hasLoadedInitialData: true,
      nextResumeData: BLANK,
      lastSavedResumeData: BLANK,
    })).toEqual({ allow: true });
  });
});
