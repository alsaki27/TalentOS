// Hard test: callWithUsageTracking wrapper, getProviderForAutomation error paths.
// Mocks the DB and provider construction so no real AI calls are made.

import { describe, it, expect, vi, beforeEach } from "vitest";

// These tests exercise route fallback behavior with mocked Neon key metadata.
const mockQuery = vi.fn().mockResolvedValue([]);
const mockExecute = vi.fn().mockResolvedValue({ rowCount: 1 });
const mockListEnabledAiKeys = vi.fn().mockResolvedValue([]);
const mockGetAiKeyWithDecryptedKey = vi.fn().mockResolvedValue(null);
const mockRecordAiKeySuccess = vi.fn().mockResolvedValue(undefined);
const mockRecordAiKeyFailure = vi.fn().mockResolvedValue(undefined);
const mockBuildProviderFromDbKey = vi.fn().mockReturnValue(null);
const mockGetAiRuntimeConfig = vi.fn().mockResolvedValue({ active_routing_state_id: null, allow_unrouted_fallback: true });
// routing.ts's last-resort step (getProviderForAutomation, step 4) calls
// getActiveProviderWithFallback from @/server/services/aiProvider directly -
// not getActiveProviderAsync from @/lib/ai/index (that function isn't
// imported by routing.ts at all). The mock previously only stubbed the
// unused one, so every test actually fell through to the real
// getActiveProviderWithFallback, which isn't mocked at all - "No export is
// defined" from vitest, masking whatever each test's scenario intended.
const mockGetActiveProviderWithFallback = vi.fn().mockResolvedValue(null);

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
  recordAiKeySuccess: mockRecordAiKeySuccess,
  recordAiKeyFailure: mockRecordAiKeyFailure,
}));

vi.mock("@/server/repositories/aiRuntimeConfigRepository", () => ({
  getAiRuntimeConfig: mockGetAiRuntimeConfig,
}));

// Mock aiProvider
vi.mock("@/server/services/aiProvider", () => ({
  buildProviderFromDbKey: mockBuildProviderFromDbKey,
  getActiveProviderWithFallback: mockGetActiveProviderWithFallback,
}));

describe("callWithUsageTracking error paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when no provider can be resolved for an automation", async () => {
    mockGetActiveProviderWithFallback.mockResolvedValue(null);

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    await expect(
      callWithUsageTracking("nonexistent_automation", undefined, async (provider) => {
        return "result";
      })
    ).rejects.toThrow("No AI provider available");
  });

  it("records usage event on successful call", async () => {
    const mockSend = vi.fn().mockResolvedValue({ content: [], stopReason: "end_turn" });
    mockGetActiveProviderWithFallback.mockResolvedValue({
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
    mockGetActiveProviderWithFallback.mockResolvedValue({
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

  it("passes a named route's model override to the provider and usage metadata", async () => {
    const routedProvider = { send: vi.fn() };
    mockQuery.mockResolvedValueOnce([{
      id: "route-1",
      automation_id: "BaseResume_TO_JobSearchKeyword",
      ai_key_id: null,
      provider: "google_vertex_proxy",
      rank: 1,
      is_enabled: true,
      model_override: "gemini-2.5-pro",
    }]);
    mockListEnabledAiKeys.mockResolvedValueOnce([{ id: "vertex-key", provider: "google_vertex_proxy", status: "working" }]);
    mockGetAiKeyWithDecryptedKey.mockResolvedValueOnce({
      id: "vertex-key", provider: "google_vertex_proxy", decrypted_key: "secret", is_enabled: true,
      status: "working", model: "coding-cheap", base_url: "https://vertex.example.com/v1",
      chat_endpoint: "/chat/completions", custom_headers: null, provider_config: {},
    });
    mockBuildProviderFromDbKey.mockReturnValueOnce(routedProvider);

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const resolved = await getProviderForAutomation("BaseResume_TO_JobSearchKeyword");

    expect(mockBuildProviderFromDbKey).toHaveBeenCalledWith(
      "google_vertex_proxy", "secret", "gemini-2.5-pro", "https://vertex.example.com/v1",
      "/chat/completions", null, {}
    );
    expect(resolved?.model).toBe("gemini-2.5-pro");
    expect(resolved?.provider).toBe(routedProvider);
  });
});

describe("buildProviderFromDbKey — new providers", () => {
  it("creates a Moonshot provider without throwing", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("moonshot", "test-key-moonshot", "kimi-k2.6");
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
    expect(typeof provider!.send).toBe("function");
  });

  it("returns null for openai_compatible without baseUrl", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("openai_compatible", "test-key", "gpt-4o");
    expect(provider).toBeNull();
  });

  it("creates an openai_compatible provider with baseUrl", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("openai_compatible", "test-key", "gpt-4o", "https://custom.api.com/v1/chat/completions");
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });
});

describe("buildProviderFromDbKey — Neon-backed google_vertex_proxy", () => {
  it("returns null when the Neon base URL is absent", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "real-proxy-secret");
    expect(provider).toBeNull();
  });

  it("returns null when the encrypted Neon credential is empty", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "", "coding-cheap", "https://vertex-proxy.example.com/v1");
    expect(provider).toBeNull();
  });

  it("builds a provider from the Neon credential and endpoint", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "placeholder-not-a-real-secret", "coding-cheap", "https://vertex-proxy.example.com/v1");
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });

  it("does not need a deployment environment credential", async () => {
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "real-proxy-secret", "coding-cheap", "https://vertex-proxy.example.com/v1");
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });
});


