import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

import { query } from "@/server/db/neon";
import {
  setApplicationResumeQcStatus,
  updateApplicationResumeQcNote,
} from "@/server/repositories/applicationResumeQcRepository";

const editableStageGuard = "COALESCE(a.application_stage, a.ae_stage) IN ('in_ai_pipeline', 'ready_for_review', 'ready_for_application')";
const actor = { userId: "staff-user", name: "QC Admin" };
const applicationId = "95efec1c-fc6b-44e9-8a18-465c77e82f22";

describe("application resume QC stage eligibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows setting QC while an application is Ready for AE Application", async () => {
    await setApplicationResumeQcStatus({ applicationId, status: "qualified", actor });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain(editableStageGuard);
  });

  it("allows editing QC notes while an application is Ready for AE Application", async () => {
    await updateApplicationResumeQcNote({ applicationId, stage: "qualified", note: "Looks good", actor });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain(editableStageGuard);
  });
});
