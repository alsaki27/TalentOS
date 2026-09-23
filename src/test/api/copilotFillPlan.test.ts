import { describe, expect, it, vi } from "vitest";

const queryOneMock = vi.hoisted(() => vi.fn());
const queryMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db/neon", () => ({
  query: queryMock,
  queryOne: queryOneMock,
}));

vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: vi.fn(async (_automationId: string, _ctx: unknown, fn: (provider: unknown) => Promise<unknown>) => ({
    result: await fn("test-provider"),
  })),
}));

vi.mock("@/lib/ai/application-agents/copilotFiller", () => ({
  runCopilotFiller: vi.fn(async () => ({ instructions: [] })),
}));

vi.mock("@/lib/ai/application-agents/copilotCompliance", () => ({
  runCopilotCompliance: vi.fn(async () => ({ instructions: [] })),
}));

vi.mock("@/server/repositories/aiAgentConfigRepository", () => ({
  findAgentConfigByAutomationId: vi.fn(async () => null),
}));

vi.mock("@/server/repositories/copilotLearningRepository", () => ({
  getRecentCorrections: vi.fn(async () => []),
}));

vi.mock("@/server/repositories/copilotDomainProfileRepository", () => ({
  getDomainProfile: vi.fn(async () => null),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/extension/v1/copilot/fill-plan/route";

describe("Copilot fill-plan capture boundary", () => {
  it("does not create an application when analyzing an unlinked page", async () => {
    queryMock.mockResolvedValue([]);
    queryOneMock.mockImplementation(async (sql: string) => {
      if (sql.includes("extension_api_keys")) {
        return { id: "key-1", label: "test", scopes: ["extension:queue:read"], candidate_id: null };
      }
      if (sql.includes("FROM candidates")) {
        return {
          id: "candidate-1",
          status: "active",
          name: "Test Candidate",
          email: "test@example.com",
          verified_skills: [],
          target_roles: [],
        };
      }
      return null;
    });

    const request = new NextRequest("https://talentos.test/api/extension/v1/copilot/fill-plan", {
      method: "POST",
      headers: {
        authorization: "Bearer tos_test",
        "x-talentos-client": "application-copilot-extension/1.0.0",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        candidateId: "candidate-1",
        formSnapshot: [{ selector: "#name", label: "Name", inputType: "text" }],
        pageContext: { title: "Example Job", company: "Example Co", domain: "example.com" },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.applicationId).toBeNull();
    expect(body.captureOnly).toBe(true);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO applications"))).toBe(false);
  });
});
