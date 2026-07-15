// Hard test: callWithUsageTracking wrapper, getProviderForAutomation error paths.
// Mocks the DB and provider construction so no real AI calls are made.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// routing.ts reads this once at module-eval time to gate the global env-based
// fallback chain (defaults to disabled in production). These tests exercise
// that fallback path directly, so it must be enabled before routing.ts loads.
process.env.ALLOW_GLOBAL_AI_FALLBACK = "true";

const mockQuery = vi.fn().mockResolvedValue([]);
const mockExecute = vi.fn().mockResolvedValue({ rowCount: 1 });
const mockListEnabledAiKeys = vi.fn().mockResolvedValue([]);
const mockGetAiKeyWithDecryptedKey = vi.fn().mockResolvedValue(null);
const mockBuildProviderFromDbKey = vi.fn().mockReturnValue(null);
const mockGetProviderByName = vi.fn().mockReturnValue(null);
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
}));

// Mock aiProvider
vi.mock("@/server/services/aiProvider", () => ({
  buildProviderFromDbKey: mockBuildProviderFromDbKey,
  getActiveProviderWithFallback: mockGetActiveProviderWithFallback,
}));

// Mock getProviderByName
vi.mock("@/lib/ai/index", () => ({
  getProviderByName: mockGetProviderByName,
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

describe("buildProviderFromDbKey — google_vertex_proxy prefers the Cloudflare env secret, falls back to the DB key", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns null when GOOGLE_VERTEX_PROXY_URL is unset, even with a DB apiKey present", async () => {
    delete process.env.GOOGLE_VERTEX_PROXY_URL;
    delete process.env.GOOGLE_VERTEX_PROXY_SECRET;
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "real-proxy-secret");
    expect(provider).toBeNull();
  });

  it("returns null when neither GOOGLE_VERTEX_PROXY_SECRET nor a DB apiKey is available", async () => {
    process.env.GOOGLE_VERTEX_PROXY_URL = "https://vertex-proxy.example.com";
    delete process.env.GOOGLE_VERTEX_PROXY_SECRET;
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "");
    expect(provider).toBeNull();
  });

  it("builds a provider using GOOGLE_VERTEX_PROXY_SECRET when set, regardless of the DB apiKey", async () => {
    process.env.GOOGLE_VERTEX_PROXY_URL = "https://vertex-proxy.example.com";
    process.env.GOOGLE_VERTEX_PROXY_SECRET = "real-cloudflare-secret";
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "placeholder-not-a-real-secret");
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });

  it("falls back to the DB key's apiKey as the proxy secret when GOOGLE_VERTEX_PROXY_SECRET is unset", async () => {
    process.env.GOOGLE_VERTEX_PROXY_URL = "https://vertex-proxy.example.com";
    delete process.env.GOOGLE_VERTEX_PROXY_SECRET;
    const actual = await vi.importActual<typeof import("@/server/services/aiProvider")>("@/server/services/aiProvider");
    const provider = actual.buildProviderFromDbKey("google_vertex_proxy", "real-proxy-secret");
    expect(provider).not.toBeNull();
    expect(provider).toHaveProperty("send");
  });
});


