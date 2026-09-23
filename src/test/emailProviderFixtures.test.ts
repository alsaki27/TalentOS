import { describe, expect, test } from "vitest";
import { recruitingEmailFixtures } from "@/test/fixtures/emailProviderFixtures";

describe("recruiting email provider fixtures", () => {
  test("covers ATS providers and known job-alert noise", () => {
    expect(new Set(recruitingEmailFixtures.map((fixture) => fixture.provider))).toEqual(new Set(["greenhouse", "lever", "workday", "ashby", "zoho", "indeed", "linkedin", "doordash", "amazon"]));
    expect(recruitingEmailFixtures.filter((fixture) => !fixture.relevant).map((fixture) => fixture.provider)).toEqual(["indeed", "linkedin", "doordash", "amazon"]);
  });
});
