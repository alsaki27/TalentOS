// Regression coverage for selectBestBaseResume's status filter.
//
// Context: base_resumes.status only ever takes 'draft' (default) or 'approved'
// (see neon/migrations/0001_initial_schema.sql and the admin UI's status
// options) - it was previously filtered as status = 'active', a value that
// never exists on any row, so the query always returned zero rows and this
// entire domain-matching feature silently no-op'd on every call. This guards
// against that filter value regressing.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/server/db/neon", () => ({
  query: queryMock,
}));

import { selectBestBaseResume } from "@/lib/ai/selectBestBaseResume";

describe("selectBestBaseResume", () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it("filters on a status value that base_resumes rows can actually have", async () => {
    await selectBestBaseResume("candidate-1", { title: "GIS Analyst", job_category: "GIS" });

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/status\s*=\s*'active'/i);
    expect(sql).toMatch(/status\s*=\s*'approved'/i);
  });

  it("picks the base resume with the stronger domain match, not just the most recent", async () => {
    queryMock.mockResolvedValue([
      { id: "osp-resume", name: "OSP", target_industry: "OSP Telecom", target_roles: [], content: {} },
      { id: "gis-resume", name: "GIS", target_industry: "GIS", target_roles: [], content: {} },
    ]);

    const result = await selectBestBaseResume("candidate-1", { title: "GIS Analyst", job_category: "GIS" });

    expect(result?.resume.id).toBe("gis-resume");
    expect(result?.reason).toMatch(/GIS/);
  });
});
