import { describe, expect, it } from "vitest";
import { parseUsableAgentResponse } from "@/server/services/baseResumeJobSearchKeywordService";

describe("BaseResume_TO_JobSearchKeyword response recovery", () => {
  it("recovers named terms when Gemini omits a structural delimiter", () => {
    const keywordObjects = Array.from({ length: 30 }, (_, index) =>
      `{"term":"Source term ${index + 1}","category":"skill","evidence":"direct","reason":"Listed in the resume"}`
    ).join(",");
    const malformed = `{"keywords":[${keywordObjects}] "additional_rules":["Prefer roles matching demonstrated experience.","Prefer explicit source terms.","Flag unsupported seniority.","Exclude clearly unrelated work."]}`;

    const parsed = parseUsableAgentResponse(malformed);

    expect(parsed.keywords).toHaveLength(30);
    expect(parsed.additional_rules).toEqual([
      "Prefer roles matching demonstrated experience.",
      "Prefer explicit source terms.",
      "Flag unsupported seniority.",
      "Exclude clearly unrelated work.",
    ]);
  });
});
