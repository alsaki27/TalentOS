import { describe, it, expect } from "vitest";
import { mergeSkillSources } from "@/lib/ai/application-agents/prompts/mergeSkillSources";

describe("mergeSkillSources", () => {
  it("tags a skill present in both lists as verified+confirmed", () => {
    const result = mergeSkillSources(["AutoCAD"], ["AutoCAD"]);
    expect(result).toEqual(["AutoCAD (verified, confirmed)"]);
  });

  it("tags a confirmed-only skill as (confirmed)", () => {
    const result = mergeSkillSources(["ArcGIS Pro"], []);
    expect(result).toEqual(["ArcGIS Pro (confirmed)"]);
  });

  it("tags a verified-only skill as (verified)", () => {
    const result = mergeSkillSources([], ["Excel"]);
    expect(result).toEqual(["Excel (verified)"]);
  });

  it("deduplicates case/whitespace-insensitively without dropping a distinct skill", () => {
    const result = mergeSkillSources(["AutoCAD", "  SQL "], ["autocad", "Excel"]);
    expect(result).toEqual(["AutoCAD (verified, confirmed)", "SQL (confirmed)", "Excel (verified)"]);
  });

  it("returns an empty list when both sources are empty", () => {
    expect(mergeSkillSources([], [])).toEqual([]);
  });

  it("ignores non-string and empty entries defensively", () => {
    const result = mergeSkillSources(["AutoCAD", "", "  ", null as any, 5 as any], ["Excel"]);
    expect(result).toEqual(["AutoCAD (confirmed)", "Excel (verified)"]);
  });
});
