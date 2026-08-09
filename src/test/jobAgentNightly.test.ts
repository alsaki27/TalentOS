import { describe, expect, test } from "vitest";
import {
  assertNightlyCombinedGroupPartition,
  getCombinedGroups,
  getNightlyDefaultGroups,
} from "@/lib/jobAgentRoleLibrary";
import {
  buildActorInput,
  buildGoogleBooleanQuery,
  normalizeActorItem,
} from "@/lib/jobAgentActorContracts";
import { buildNightlyShardMatrix } from "@/lib/jobAgentNightlyPlan";
import { classifyWithRegex } from "@/lib/ai/jobAgentClassifier";

describe("nightly Job Agent role and shard plan", () => {
  test("A-R are explicit nightly defaults and the five bundles partition them once", () => {
    const defaults = getNightlyDefaultGroups();
    expect(defaults.map((group) => group.id)).toEqual("ABCDEFGHIJKLMNOPQR".split(""));
    expect(defaults.every((group) => group.nightlyDefault)).toBe(true);
    expect(() => assertNightlyCombinedGroupPartition()).not.toThrow();

    const bundled = getCombinedGroups().flatMap((group) => group.subGroupIds);
    expect(bundled).toHaveLength(18);
    expect(new Set(bundled).size).toBe(18);
    expect([...bundled].sort()).toEqual(defaults.map((group) => group.id).sort());
  });

  test("builds 28 stable shards with the exact per-source ceilings", () => {
    const shards = buildNightlyShardMatrix();
    expect(shards).toHaveLength(28);
    expect(new Set(shards.map((shard) => shard.shardKey)).size).toBe(28);

    const bySource = (source: "indeed" | "linkedin" | "google") =>
      shards.filter((shard) => shard.actorSource === source);
    expect(bySource("indeed")).toHaveLength(5);
    expect(bySource("linkedin")).toHaveLength(5);
    expect(bySource("google")).toHaveLength(18);
    expect(bySource("indeed").reduce((sum, shard) => sum + shard.maxResults, 0)).toBe(500);
    expect(bySource("linkedin").reduce((sum, shard) => sum + shard.maxResults, 0)).toBe(750);
    expect(bySource("google").reduce((sum, shard) => sum + shard.maxResults, 0)).toBe(500);
    expect(shards.every((shard) => shard.dateInterval === "2 days")).toBe(true);

    expect(bySource("google").slice(0, 14).every((shard) => shard.maxResults === 28)).toBe(true);
    expect(bySource("google").slice(14).every((shard) => shard.maxResults === 27)).toBe(true);
    expect(bySource("google").every((shard) => shard.roleGroups.length === 1)).toBe(true);
    expect(shards.reduce((sum, shard) => sum + shard.maxResults, 0)).toBe(1_750);

    const expectedGroups = "ABCDEFGHIJKLMNOPQR".split("");
    for (const source of ["indeed", "linkedin", "google"] as const) {
      const coveredGroups = bySource(source).flatMap((shard) => shard.roleGroups).sort();
      expect(coveredGroups).toEqual(expectedGroups);
      expect(new Set(coveredGroups).size).toBe(expectedGroups.length);
    }

    for (const shard of bySource("google")) {
      expect(shard.googleQuery).toBeTruthy();
      expect(shard.googleQuery?.split(" OR ").every((title) => /^"[^"\r\n]+"$/.test(title))).toBe(true);
    }
  });
});

describe("Apify actor contracts", () => {
  test("Indeed requests 48 hours and keeps its 100-result role-bundle ceiling", () => {
    const input = buildActorInput({
      actorSource: "indeed",
      queries: ["one", "two", "three", "four"],
      dateInterval: "2 days",
      maxResults: 100,
    });
    expect(input).toEqual({
      queries: ["one", "two", "three", "four"],
      location: "United States",
      countryIndeed: "USA",
      resultsPerQuery: 25,
      hoursOld: 48,
      enforceAnnual: true,
    });
  });

  test("LinkedIn uses current maxItems contract and fetches a week for strict post-filtering", () => {
    const input = buildActorInput({
      actorSource: "linkedin",
      queries: ["GIS Analyst", "GIS Technician"],
      dateInterval: "2 days",
      maxResults: 150,
    });
    expect(input).toMatchObject({
      keyword: ["GIS Analyst", "GIS Technician"],
      locations: ["United States"],
      maxItems: 150,
      publishedAt: "r604800",
      saveOnlyUniqueItems: true,
    });
    expect(input).not.toHaveProperty("maxRows");
  });

  test("Google uses current field names and an explicit de-duplicated Boolean query", () => {
    const googleQuery = buildGoogleBooleanQuery([
      "Senior Network Engineer",
      "Network Engineer",
      "senior network engineer",
    ]);
    expect(googleQuery).toBe('"Senior Network Engineer" OR "Network Engineer"');

    const input = buildActorInput({
      actorSource: "google",
      queries: ["ignored because explicit"],
      maxResults: 28,
      explicitGoogleQuery: googleQuery,
    });
    expect(input).toEqual({
      query: googleQuery,
      location: "United States",
      country: "us",
      language: "en",
      num_results: 28,
      max_pagination: 2,
    });
    for (const staleField of ["gl", "hl", "maxItems", "numJobs"]) {
      expect(input).not.toHaveProperty(staleField);
    }
  });

  test("normalizes source dates and application links into canonical fields", () => {
    expect(normalizeActorItem("google", {
      title: "GIS Analyst",
      company_name: "Example",
      detected_extensions: { posted_at: "3 hours ago", schedule_type: "Full-time" },
      apply_options: [{ title: "Apply", link: "https://example.com/job" }],
    })).toMatchObject({
      job_title: "GIS Analyst",
      date_posted: "3 hours ago",
      apply_link: "https://example.com/job",
      employment_type: "Full-time",
      _actor_source: "google",
    });
  });
});

describe("nightly seniority policy", () => {
  test.each([
    ["N", "Senior Network Engineer"],
    ["R", "Senior Cost Estimator"],
    ["P", "Senior Applications Engineer – Solar PV & Battery Storage Systems"],
  ])("does not auto-skip configured senior title in group %s", (roleGroup, title) => {
    const result = classifyWithRegex({
      title,
      company_name: "Relevant Engineering Company",
      search_query: title,
      role_group: roleGroup,
      role_group_label: "Configured group",
    });
    expect(result.seniority).toBe("senior");
    expect(result.tier).not.toBe("skip");
    expect(result.is_false_positive).toBe(false);
  });

  test("retains false-positive rejection", () => {
    const result = classifyWithRegex({
      title: "Senior Splice Engineer",
      company_name: "Splice",
      search_query: "Splice Engineer",
      role_group: "A",
      role_group_label: "OSP / Fiber",
    });
    expect(result.tier).toBe("skip");
    expect(result.is_false_positive).toBe(true);
  });

  test("keeps unrelated fallback results as skip", () => {
    const result = classifyWithRegex({
      title: "Retail Sales Associate",
      company_name: "Example Store",
      search_query: "Senior Network Engineer",
      role_group: "N",
      role_group_label: "Network Engineering",
    });
    expect(result.tier).toBe("skip");
    expect(result.is_false_positive).toBe(true);
  });
});
