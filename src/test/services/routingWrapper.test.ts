// Hard test: callWithUsageTracking wrapper, getProviderForAutomation error paths.
// Mocks the DB and provider construction so no real AI calls are made.

import { describe, it, expect, vi, beforeEach } from "vitest";

// These tests exercise route fallback behavior with mocked Neon key metadata.
const mockQuery = vi.fn().mockResolvedValue([]);
const mockQueryOne = vi.fn().mockResolvedValue(null);
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
  queryOne: mockQueryOne,
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
    mockQuery.mockReset().mockResolvedValue([]);
    mockQueryOne.mockReset().mockResolvedValue(null);
    mockExecute.mockReset().mockResolvedValue({ rowCount: 1 });
    mockListEnabledAiKeys.mockReset().mockResolvedValue([]);
    mockGetAiKeyWithDecryptedKey.mockReset().mockResolvedValue(null);
    mockRecordAiKeySuccess.mockReset().mockResolvedValue(undefined);
    mockRecordAiKeyFailure.mockReset().mockResolvedValue(undefined);
    mockBuildProviderFromDbKey.mockReset().mockReturnValue(null);
    mockGetAiRuntimeConfig.mockReset().mockResolvedValue({ active_routing_state_id: null, allow_unrouted_fallback: true });
    mockGetActiveProviderWithFallback.mockReset().mockResolvedValue(null);
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

  it("classifies malformed or schema-invalid model output as retryable output failure", async () => {
    const { classifyAiErrorCode } = await import("@/lib/ai/routing");

    expect(classifyAiErrorCode(new SyntaxError("Unterminated string in JSON"))).toBe("invalid_output");
    expect(classifyAiErrorCode({ name: "ZodError", message: "output schema validation failed" })).toBe("invalid_output");
    expect(classifyAiErrorCode(new Error("429 rate limit"))).toBe("rate_limit");
    expect(classifyAiErrorCode(new Error("The operation was aborted"))).toBe("timeout");
    expect(classifyAiErrorCode(new Error("OpenCode API error (530): tunnel unavailable"))).toBe("server_error");
    expect(classifyAiErrorCode(new Error('OpenCode API error (403): {"message":"Model access is disabled"}'))).toBe("model_unavailable");
    expect(classifyAiErrorCode(new Error("OpenCode API error (403): invalid credential"))).toBe("auth_error");
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

  it("rotates across sibling OpenCode keys before leaving the route rank", async () => {
    const providerOne = { send: vi.fn() };
    const providerTwo = { send: vi.fn() };
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_automation_routes")) {
        return [{
          id: "route-1",
          automation_id: "application_resume_forge",
          ai_key_id: "opencode-key-1",
          provider: null,
          rank: 1,
          is_enabled: true,
          model_override: "gpt-5.6-luna",
        }];
      }
      return [];
    });
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_key_pool_cursors")) return { start_index: "0" };
      return null;
    });
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-key-1", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-key-2", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => ({
      id,
      provider: "opencode",
      decrypted_key: id,
      is_enabled: true,
      status: "working",
      model: "deepseek-v4-flash",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    }));
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) =>
      key === "opencode-key-1" ? providerOne : providerTwo
    );

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const first = await getProviderForAutomation("application_resume_forge");
    const second = await getProviderForAutomation(
      "application_resume_forge",
      new Set(["opencode-key-1"]),
    );

    expect(first?.aiKeyId).toBe("opencode-key-1");
    expect(first?.provider).toBe(providerOne);
    expect(second?.aiKeyId).toBe("opencode-key-2");
    expect(second?.provider).toBe(providerTwo);
    expect(second?.routeRank).toBe(1);
  });

  it("benchmarkMode never advances the round-robin pool cursor", async () => {
    // Section 5 fix (2026-09-29): scripts/replay-pipeline-sample.ts must be
    // able to resolve a route repeatedly without perturbing the live cursor
    // that real traffic depends on for fair rotation.
    const providerOne = { send: vi.fn() };
    const providerTwo = { send: vi.fn() };
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_automation_routes")) {
        return [{
          id: "route-1",
          automation_id: "application_resume_forge",
          ai_key_id: "opencode-key-1",
          provider: null,
          rank: 1,
          is_enabled: true,
          model_override: "gpt-5.6-luna",
        }];
      }
      return [];
    });
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_key_pool_cursors")) return { start_index: "0" };
      return null;
    });
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-key-1", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-key-2", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => ({
      id,
      provider: "opencode",
      decrypted_key: id,
      is_enabled: true,
      status: "working",
      model: "deepseek-v4-flash",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    }));
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) =>
      key === "opencode-key-1" ? providerOne : providerTwo
    );

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const first = await getProviderForAutomation(
      "application_resume_forge", undefined, undefined, undefined, undefined, undefined, true,
    );
    const second = await getProviderForAutomation(
      "application_resume_forge", undefined, undefined, undefined, undefined, undefined, true,
    );

    // Live (non-benchmark) rotation would hand "opencode-key-2" to a second
    // resolution once the cursor advances - see the test above this one.
    // benchmarkMode must return the same, stable priority-ordered key both
    // times, and must never query the cursor table at all.
    expect(first?.aiKeyId).toBe("opencode-key-1");
    expect(second?.aiKeyId).toBe("opencode-key-1");
    expect(mockQueryOne.mock.calls.some(([sql]) => String(sql).includes("ai_key_pool_cursors"))).toBe(false);
  });

  it("benchmarkMode records no usage event and no key health mutation on success or failure", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_automation_routes")) {
        return [{
          id: "route-1",
          automation_id: "application_resume_forge",
          ai_key_id: "opencode-key-1",
          provider: null,
          rank: 1,
          is_enabled: true,
          model_override: "gpt-5.6-luna",
        }];
      }
      return [];
    });
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-key-1", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockResolvedValue({
      id: "opencode-key-1",
      provider: "opencode",
      decrypted_key: "opencode-key-1",
      is_enabled: true,
      status: "working",
      model: "deepseek-v4-flash",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    });
    mockBuildProviderFromDbKey.mockReturnValue({ send: vi.fn().mockResolvedValue({ content: [], stopReason: "end_turn" }) });

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    await callWithUsageTracking(
      "application_resume_forge",
      { benchmarkMode: true },
      async (provider) => provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes("ai_usage_events"))).toBe(false);
    expect(mockRecordAiKeySuccess).not.toHaveBeenCalled();

    mockBuildProviderFromDbKey.mockReturnValue({ send: vi.fn().mockRejectedValue(new Error("boom (500): server error")) });
    await expect(
      callWithUsageTracking(
        "application_resume_forge",
        { benchmarkMode: true },
        async (provider) => provider.send({ system: "s", messages: [], tools: [] }),
      )
    ).rejects.toThrow();

    expect(mockExecute.mock.calls.some(([sql]) => String(sql).includes("ai_usage_events"))).toBe(false);
    expect(mockRecordAiKeyFailure).not.toHaveBeenCalled();
  });

  it("keeps a pooled route alive when its anchor key is corrupt", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_automation_routes")) {
        return [{
          id: "route-1",
          automation_id: "application_resume_forge",
          ai_key_id: "opencode-key-1",
          provider: null,
          rank: 1,
          is_enabled: true,
          model_override: "gpt-5.6-luna",
        }];
      }
      return [];
    });
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_key_pool_cursors")) return { start_index: "0" };
      return null;
    });
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-key-1", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-key-2", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => id === "opencode-key-1" ? null : ({
      id,
      provider: "opencode",
      decrypted_key: id,
      is_enabled: true,
      status: "working",
      model: "deepseek-v4-flash",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    }));
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) => ({ send: vi.fn(), key } as any));

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const resolved = await getProviderForAutomation("application_resume_forge");

    expect(resolved?.aiKeyId).toBe("opencode-key-2");
    expect(resolved?.routeRank).toBe(1);
  });

  it("tries the next-priority OpenCode key once the higher-priority one is excluded", async () => {
    const higherPriorityProvider = { send: vi.fn() };
    const lowerPriorityProvider = { send: vi.fn() };
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_automation_routes")) {
        return [{
          id: "route-1",
          automation_id: "application_resume_forge",
          ai_key_id: "opencode-primary",
          provider: null,
          rank: 1,
          is_enabled: true,
          model_override: "gpt-5.6-luna",
        }];
      }
      return [];
    });
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("ai_key_pool_cursors")) return { start_index: "0" };
      return null;
    });
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-primary", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-fallback", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => ({
      id,
      provider: "opencode",
      decrypted_key: id,
      is_enabled: true,
      status: "working",
      model: "gpt-5.6-luna",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    }));
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) =>
      key === "opencode-primary" ? higherPriorityProvider : lowerPriorityProvider
    );

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const first = await getProviderForAutomation("application_resume_forge");
    const second = await getProviderForAutomation(
      "application_resume_forge",
      new Set(["opencode-primary"]),
    );

    expect(first?.aiKeyId).toBe("opencode-primary");
    expect(second?.aiKeyId).toBe("opencode-fallback");
    expect(second?.routeRank).toBe(1);
  });

  it("keeps a rate-limited OpenCode account out of the pool while its cooldown is active", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("ai_automation_routes")
        ? [{
            id: "route-1",
            automation_id: "application_resume_forge",
            ai_key_id: "opencode-a",
            provider: null,
            rank: 1,
            is_enabled: true,
            model_override: "gpt-5.6-luna",
          }]
        : []
    );
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-a", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "rate_limited", last_failure_at: new Date().toISOString() },
      { id: "opencode-b", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
      { id: "opencode-c", provider: "opencode", priority: 30, created_at: "2026-01-03", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => ({
      id,
      provider: "opencode",
      decrypted_key: id,
      is_enabled: true,
      status: "working",
      model: "gpt-5.6-luna",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    }));
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) => ({ send: vi.fn(), _key: key } as any));

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const resolved = await getProviderForAutomation("application_resume_forge");

    expect(resolved?.aiKeyId).not.toBe("opencode-a");
    expect(resolved?.aiKeyId).toBe("opencode-b");
  });

  it("lets a rate-limited OpenCode account rejoin the pool once its cooldown has elapsed", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("ai_automation_routes")
        ? [{
            id: "route-1",
            automation_id: "application_resume_forge",
            ai_key_id: "opencode-a",
            provider: null,
            rank: 1,
            is_enabled: true,
            model_override: "gpt-5.6-luna",
          }]
        : []
    );
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60_000).toISOString();
    mockListEnabledAiKeys.mockResolvedValue([
      { id: "opencode-a", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "rate_limited", last_failure_at: sixteenMinutesAgo },
      { id: "opencode-b", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ]);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => ({
      id,
      provider: "opencode",
      decrypted_key: id,
      is_enabled: true,
      status: "working",
      model: "gpt-5.6-luna",
      base_url: "https://opencode.example.com/v1",
      chat_endpoint: "/chat/completions",
      custom_headers: null,
      provider_config: {},
    }));
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) => ({ send: vi.fn(), _key: key } as any));

    const { getProviderForAutomation } = await import("@/lib/ai/routing");
    const resolved = await getProviderForAutomation("application_resume_forge");

    expect(resolved?.aiKeyId).toBe("opencode-a");
  });
});

describe("callWithUsageTracking per-model rate-limit failover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset().mockResolvedValue([]);
    mockQueryOne.mockReset().mockResolvedValue(null);
    mockExecute.mockReset().mockResolvedValue({ rowCount: 1 });
    mockListEnabledAiKeys.mockReset().mockResolvedValue([]);
    mockGetAiKeyWithDecryptedKey.mockReset().mockResolvedValue(null);
    mockRecordAiKeySuccess.mockReset().mockResolvedValue(undefined);
    mockRecordAiKeyFailure.mockReset().mockResolvedValue(undefined);
    mockBuildProviderFromDbKey.mockReset().mockReturnValue(null);
    mockGetAiRuntimeConfig.mockReset().mockResolvedValue({ active_routing_state_id: null, allow_unrouted_fallback: false });
    mockGetActiveProviderWithFallback.mockReset().mockResolvedValue(null);
  });

  // Mirrors the production Resume Forge routing state on 2026-09-25:
  // rank 1 OpenCode (rate limited), rank 2 Vertex B with flash-lite (503),
  // rank 3 Vertex A with pro-preview. Vertex keys are pooled, so rank 2 also
  // tries Vertex A with flash-lite, which hits its per-model quota (429).
  // Rank 3 must still get its turn with a different model on that same key.
  it("reaches a later route that uses the same key with a different model after a rate limit", async () => {
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: "oc", provider: null, rank: 1, is_enabled: true, model_override: "gpt-5.6-luna" },
      { id: "r2", automation_id: "application_resume_forge", ai_key_id: "vertex-b", provider: null, rank: 2, is_enabled: true, model_override: "gemini-2.5-flash-lite" },
      { id: "r3", automation_id: "application_resume_forge", ai_key_id: "vertex-a", provider: null, rank: 3, is_enabled: true, model_override: "gemini-3.1-pro-preview" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const keys = [
      { id: "oc", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "vertex-b", provider: "google_vertex_proxy", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "vertex-a", provider: "google_vertex_proxy", priority: 20, created_at: "2026-01-02", status: "working" },
    ];
    mockListEnabledAiKeys.mockResolvedValue(keys);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => {
      const k = keys.find((key) => key.id === id)!;
      return { ...k, decrypted_key: id, is_enabled: true, model: null, base_url: "https://example.test", chat_endpoint: null, custom_headers: null, provider_config: {} };
    });
    const calls: string[] = [];
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string, model: string) => ({
      send: vi.fn().mockImplementation(async () => {
        calls.push(`${key}:${model}`);
        if (key === "oc") throw new Error("OpenCode API error (429): rate limit");
        if (key === "vertex-b") throw new Error("Google Vertex Proxy error (503): service not available yet");
        if (model === "gemini-2.5-flash-lite") throw new Error("Google Vertex Proxy: rate limit or quota exceeded.");
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    const result = await callWithUsageTracking("application_resume_forge", undefined, (provider) =>
      provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(calls).toEqual([
      "oc:gpt-5.6-luna",
      "vertex-b:gemini-2.5-flash-lite",
      "vertex-a:gemini-2.5-flash-lite",
      "vertex-a:gemini-3.1-pro-preview",
    ]);
    expect(result.aiKeyId).toBe("vertex-a");
    expect(result.model).toBe("gemini-3.1-pro-preview");
    expect(result.routeRank).toBe(3);
  });

  it("advances to the next configured OpenCode model after a timeout on a pooled key", async () => {
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: "opencode-b", provider: null, rank: 1, is_enabled: true, model_override: "glm-5.2" },
      { id: "r2", automation_id: "application_resume_forge", ai_key_id: "opencode-b", provider: null, rank: 2, is_enabled: true, model_override: "qwen3.7-plus" },
      { id: "r3", automation_id: "application_resume_forge", ai_key_id: "opencode-b", provider: null, rank: 3, is_enabled: true, model_override: "gpt-5.6-luna" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const key = {
      id: "opencode-b",
      provider: "opencode",
      priority: 1,
      created_at: "2026-01-01",
      status: "working",
    };
    mockListEnabledAiKeys.mockResolvedValue([key]);
    mockGetAiKeyWithDecryptedKey.mockResolvedValue({
      ...key,
      decrypted_key: "test-only",
      is_enabled: true,
      model: null,
      base_url: "https://example.test",
      chat_endpoint: null,
      custom_headers: null,
      provider_config: {},
    } as any);

    const calls: string[] = [];
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, _secret: string, model: string) => ({
      send: vi.fn().mockImplementation(async () => {
        calls.push(model);
        if (model === "glm-5.2") {
          const error = new Error("The operation was aborted");
          error.name = "AbortError";
          throw error;
        }
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    const result = await callWithUsageTracking(
      "application_resume_forge",
      undefined,
      (provider) => provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(calls).toEqual(["glm-5.2", "qwen3.7-plus"]);
    expect(result.model).toBe("qwen3.7-plus");
    expect(result.routeRank).toBe(2);
  });

  it("advances to sibling OpenCode models after a model-specific 403 without poisoning the shared key", async () => {
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: "opencode-b", provider: null, rank: 1, is_enabled: true, model_override: "glm-5.2" },
      { id: "r2", automation_id: "application_resume_forge", ai_key_id: "opencode-b", provider: null, rank: 2, is_enabled: true, model_override: "qwen3.7-plus" },
      { id: "r3", automation_id: "application_resume_forge", ai_key_id: "opencode-b", provider: null, rank: 3, is_enabled: true, model_override: "gpt-5.6-luna" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const key = {
      id: "opencode-b",
      provider: "opencode",
      priority: 1,
      created_at: "2026-01-01",
      status: "working",
    };
    mockListEnabledAiKeys.mockResolvedValue([key]);
    mockGetAiKeyWithDecryptedKey.mockResolvedValue({
      ...key,
      decrypted_key: "test-only",
      is_enabled: true,
      model: null,
      base_url: "https://example.test",
      chat_endpoint: null,
      custom_headers: null,
      provider_config: {},
    } as any);

    const calls: string[] = [];
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, _secret: string, model: string) => ({
      send: vi.fn().mockImplementation(async () => {
        calls.push(model);
        if (model === "glm-5.2") {
          throw new Error('OpenCode API error (403): {"error":{"message":"Upstream request failed: Model access is disabled"}}');
        }
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    const result = await callWithUsageTracking(
      "application_resume_forge",
      undefined,
      (provider) => provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(calls).toEqual(["glm-5.2", "qwen3.7-plus"]);
    expect(result.model).toBe("qwen3.7-plus");
    expect(result.routeRank).toBe(2);
    expect(mockRecordAiKeyFailure).not.toHaveBeenCalled();
  });

  it("tries every account in a 5-account pool for one model before advancing to the next model", async () => {
    mockGetAiRuntimeConfig.mockResolvedValue({
      active_routing_state_id: null,
      allow_unrouted_fallback: false,
      pooled_retry_bounded_by_route_rank: true,
    });
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: null, provider: "opencode", rank: 1, is_enabled: true, model_override: "glm-5.3" },
      { id: "r2", automation_id: "application_resume_forge", ai_key_id: null, provider: "opencode", rank: 2, is_enabled: true, model_override: "qwen3.7-plus" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const keyIds = ["opencode-a", "opencode-b", "opencode-c", "opencode-d", "opencode-e"];
    const keys = keyIds.map((id, i) => ({ id, provider: "opencode", priority: (i + 1) * 10, created_at: `2026-01-0${i + 1}`, status: "working" }));
    mockListEnabledAiKeys.mockResolvedValue(keys);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => {
      const k = keys.find((key) => key.id === id)!;
      return { ...k, decrypted_key: id, is_enabled: true, model: null, base_url: "https://example.test", chat_endpoint: null, custom_headers: null, provider_config: {} };
    });
    const calls: string[] = [];
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string, model: string) => ({
      send: vi.fn().mockImplementation(async () => {
        calls.push(`${key}:${model}`);
        // Every account fails for the first model; only the second model succeeds.
        if (model === "glm-5.3") throw new Error("OpenCode API error (429): rate limit exceeded");
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    // maxProviderAttempts: 2 would, before this fix, cut retries off after
    // the 2nd account - proving the 5-account pool for rank 1 is now bounded
    // separately from the single genuine chain advance to rank 2.
    const result = await callWithUsageTracking(
      "application_resume_forge",
      { maxProviderAttempts: 2 },
      (provider) => provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(calls).toEqual([
      "opencode-a:glm-5.3", "opencode-b:glm-5.3", "opencode-c:glm-5.3",
      "opencode-d:glm-5.3", "opencode-e:glm-5.3", "opencode-a:qwen3.7-plus",
    ]);
    expect(result.model).toBe("qwen3.7-plus");
    expect(result.routeRank).toBe(2);
  });

  it("only advances routeRank once, after every pooled account for the current model has failed", async () => {
    mockGetAiRuntimeConfig.mockResolvedValue({
      active_routing_state_id: null,
      allow_unrouted_fallback: false,
      pooled_retry_bounded_by_route_rank: true,
    });
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: null, provider: "opencode", rank: 1, is_enabled: true, model_override: "glm-5.3" },
      { id: "r2", automation_id: "application_resume_forge", ai_key_id: null, provider: "opencode", rank: 2, is_enabled: true, model_override: "qwen3.7-plus" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const keys = [
      { id: "opencode-a", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-b", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ];
    mockListEnabledAiKeys.mockResolvedValue(keys);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => {
      const k = keys.find((key) => key.id === id)!;
      return { ...k, decrypted_key: id, is_enabled: true, model: null, base_url: "https://example.test", chat_endpoint: null, custom_headers: null, provider_config: {} };
    });
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, _key: string, model: string) => ({
      send: vi.fn().mockImplementation(async () => {
        if (model === "glm-5.3") throw new Error("OpenCode API error (429): rate limit exceeded");
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    const result = await callWithUsageTracking(
      "application_resume_forge",
      undefined,
      (provider) => provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(result.model).toBe("qwen3.7-plus");
    expect(result.routeRank).toBe(2);
  });

  it("retries the same model on a sibling OpenCode account after a 429, without advancing the chain", async () => {
    mockGetAiRuntimeConfig.mockResolvedValue({
      active_routing_state_id: null,
      allow_unrouted_fallback: false,
      pooled_retry_bounded_by_route_rank: true,
    });
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: null, provider: "opencode", rank: 1, is_enabled: true, model_override: "glm-5.3" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const keys = [
      { id: "opencode-a", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-b", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ];
    mockListEnabledAiKeys.mockResolvedValue(keys);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => {
      const k = keys.find((key) => key.id === id)!;
      return { ...k, decrypted_key: id, is_enabled: true, model: null, base_url: "https://example.test", chat_endpoint: null, custom_headers: null, provider_config: {} };
    });
    const calls: string[] = [];
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string, model: string) => ({
      send: vi.fn().mockImplementation(async () => {
        calls.push(`${key}:${model}`);
        if (key === "opencode-a") throw new Error("OpenCode API error (429): rate limit exceeded");
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    // maxProviderAttempts: 1 (zero configured retries) would, before this
    // fix, give up immediately after account A's 429 - proving the same-rank
    // pool retry to account B is bounded independently of the chain budget.
    const result = await callWithUsageTracking(
      "application_resume_forge",
      { maxProviderAttempts: 1 },
      (provider) => provider.send({ system: "s", messages: [], tools: [] }),
    );

    expect(calls).toEqual(["opencode-a:glm-5.3", "opencode-b:glm-5.3"]);
    expect(result.aiKeyId).toBe("opencode-b");
    expect(result.routeRank).toBe(1);
  });

  it("keeps retry state isolated between concurrent calls", async () => {
    mockGetAiRuntimeConfig.mockResolvedValue({
      active_routing_state_id: null,
      allow_unrouted_fallback: false,
      pooled_retry_bounded_by_route_rank: true,
    });
    const routes = [
      { id: "r1", automation_id: "application_resume_forge", ai_key_id: null, provider: "opencode", rank: 1, is_enabled: true, model_override: "glm-5.3" },
    ];
    mockQuery.mockImplementation(async (sql: string) => (sql.includes("ai_automation_routes") ? routes : []));
    mockQueryOne.mockImplementation(async (sql: string) => (sql.includes("ai_key_pool_cursors") ? { start_index: "0" } : null));
    const keys = [
      { id: "opencode-a", provider: "opencode", priority: 10, created_at: "2026-01-01", status: "working" },
      { id: "opencode-b", provider: "opencode", priority: 20, created_at: "2026-01-02", status: "working" },
    ];
    mockListEnabledAiKeys.mockResolvedValue(keys);
    mockGetAiKeyWithDecryptedKey.mockImplementation(async (id: string) => {
      const k = keys.find((key) => key.id === id)!;
      return { ...k, decrypted_key: id, is_enabled: true, model: null, base_url: "https://example.test", chat_endpoint: null, custom_headers: null, provider_config: {} };
    });
    mockBuildProviderFromDbKey.mockImplementation((_provider: string, key: string) => ({
      send: vi.fn().mockImplementation(async () => {
        if (key === "opencode-a") throw new Error("OpenCode API error (429): rate limit exceeded");
        return { content: [{ type: "text", text: "ok" }], stopReason: "end_turn" };
      }),
    }));

    const { callWithUsageTracking } = await import("@/lib/ai/routing");
    // Real Postgres-level atomicity of the round-robin cursor's single
    // INSERT...ON CONFLICT...RETURNING statement is a DB-engine guarantee,
    // out of scope for this mocked unit test. What this proves: the
    // per-call exclusion sets (plain local consts) never leak across
    // concurrent calls to the same automation.
    const [resultOne, resultTwo] = await Promise.all([
      callWithUsageTracking("application_resume_forge", undefined, (provider) => provider.send({ system: "s", messages: [], tools: [] })),
      callWithUsageTracking("application_resume_forge", undefined, (provider) => provider.send({ system: "s", messages: [], tools: [] })),
    ]);

    expect(resultOne.aiKeyId).toBe("opencode-b");
    expect(resultTwo.aiKeyId).toBe("opencode-b");
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


