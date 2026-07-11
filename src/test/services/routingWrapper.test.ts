// Hard test: callWithUsageTracking wrapper, getProviderForAutomation error paths.
// Mocks the DB and provider construction so no real AI calls are made.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn().mockResolvedValue([]);
const mockExecute = vi.fn().mockResolvedValue({ rowCount: 1 });
const mockListEnabledAiKeys = vi.fn().mockResolvedValue([]);
const mockGetAiKeyWithDecryptedKey = vi.fn().mockResolvedValue(null);
const mockBuildProviderFromDbKey = vi.fn().mockReturnValue(null);
const mockGetProviderByName = vi.fn().mockReturnValue(null);
const mockGetActiveProviderAsync = vi.fn();

// Mock Neon
vi.mock("@/server/db/neon", () => ({
  query: mockQuery,
  queryOne: vi.fn(),
  execute: mockExecute,
}));

// Mock aiKeyRepository
vi.mock("@/server/repositories/aiKeyRepository", () => ({
  listEnabledAiKeys: mockListEnabledAiKeys,
  getAiKeyWithDecryptedKey: mockGetAiKeyWithDecryptedKey,
}));

// Mock aiProvider
vi.mock("@/server/services/aiProvider", () => ({
  buildProviderFromDbKey: mockBuildProviderFromDbKey,
}));

// Mock getProviderByName and getActiveProviderAsync
vi.mock("@/lib/ai/index", () => ({
  getProviderByName: mockGetProviderByName,
  getActiveProviderAsync: mockGetActiveProviderAsync,
}));

describe("callWithUsageTracking error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no provider can be resolved for an automation", async () => {
    mockGetActiveProviderAsync.mockResolvedValue(null);

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    await expect(
      callWithUsageTracking("nonexistent_automation", undefined, async (provider) => {
        return "result";
      })
    ).rejects.toThrow("No AI provider available");
  });

  it("records usage event on successful call", async () => {
    const mockSend = vi.fn().mockResolvedValue({ content: [], stopReason: "end_turn" });
    mockGetActiveProviderAsync.mockResolvedValue({
      provider: { send: mockSend },
      name: "anthropic",
    });

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    const result = await callWithUsageTracking(
      "chat_assistant",
      { userId: "user-1" },
      async (provider) => {
        return provider.send({ system: "test", messages: [], tools: [] });
      }
    );

    expect(result.result).toBeDefined();
    expect(result.providerName).toBe("anthropic");
    expect(result.aiKeyId).toBeNull();
    expect(mockExecute).toHaveBeenCalled();
    const sql = mockExecute.mock.calls[0][0];
    expect(sql).toContain("ai_usage_events");
  });

  it("records usage event on failed call", async () => {
    mockGetActiveProviderAsync.mockResolvedValue({
      provider: { send: vi.fn().mockRejectedValue(new Error("API error")) },
      name: "nvidia",
    });

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    await expect(
      callWithUsageTracking("chat_assistant", undefined, async (provider) => {
        return provider.send({ system: "test", messages: [], tools: [] });
      })
    ).rejects.toThrow("API error");

    expect(mockExecute).toHaveBeenCalled();
    const sql = mockExecute.mock.calls[0][0];
    expect(sql).toContain("ai_usage_events");
  });
});
