// Regression coverage for getAiKeyWithDecryptedKey's decrypt-failure handling.
//
// Context: a single corrupted key row, or an AI_KEYS_ENCRYPTION_SECRET rotated
// since the row was written, must degrade to a logged null - not throw - because
// routing.ts's getProviderForAutomation calls this unwrapped, and an unhandled
// throw here breaks route resolution for every automation trying that key, not
// just the one bad key. This guards against that catch being removed/bypassed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryOneMock, decryptSecretMock, executeMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  decryptSecretMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock("@/server/db/index", () => ({
  isNeon: () => true,
}));

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: queryOneMock,
  execute: executeMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

vi.mock("@/server/security/secretCrypto", () => ({
  encryptSecret: vi.fn(),
  decryptSecret: decryptSecretMock,
  fingerprintKey: vi.fn(),
  isEncryptionAvailable: () => false,
}));

import {
  getAiKeyWithDecryptedKey,
  isKeyCoolingDown,
  recordAiKeyFailure,
  recordAiKeySuccess,
} from "@/server/repositories/aiKeyRepository";

describe("getAiKeyWithDecryptedKey", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
    decryptSecretMock.mockReset();
    executeMock.mockReset().mockResolvedValue({ rowCount: 1 });
  });

  it("returns null instead of throwing when decryptSecret fails on a corrupted/rotated-secret row", async () => {
    queryOneMock.mockResolvedValue({ id: "key-1", encrypted_key: "corrupt-ciphertext" });
    decryptSecretMock.mockRejectedValue(new Error("bad auth tag"));

    const result = await getAiKeyWithDecryptedKey("key-1");

    expect(result).toBeNull();
  });

  it("still returns the decrypted key on the success path", async () => {
    queryOneMock.mockResolvedValue({ id: "key-1", encrypted_key: "ciphertext" });
    decryptSecretMock.mockResolvedValue("sk-real-key");

    const result = await getAiKeyWithDecryptedKey("key-1");

    expect(result?.decrypted_key).toBe("sk-real-key");
  });

  it("sets a 24-hour cooldown for a monthly OpenCode quota cap", async () => {
    const before = Date.now();
    await recordAiKeyFailure("key-monthly", 'OpenCode API error (429): {"limitName":"monthly"}');

    const [sql, values] = executeMock.mock.calls[0];
    expect(sql).toContain("cooldown_until = $5");
    expect(values[0]).toBe("rate_limited");
    const cooldownMs = Date.parse(values[4]);
    expect(cooldownMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60_000 - 1000);
    expect(cooldownMs).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000 + 1000);
  });

  it("sets a 4-hour cooldown for a weekly OpenCode quota cap", async () => {
    const before = Date.now();
    await recordAiKeyFailure("key-weekly", 'OpenCode API error (429): {"limitName":"weekly"}');

    const [, values] = executeMock.mock.calls[0];
    const cooldownMs = Date.parse(values[4]);
    expect(cooldownMs).toBeGreaterThanOrEqual(before + 4 * 60 * 60_000 - 1000);
    expect(cooldownMs).toBeLessThanOrEqual(Date.now() + 4 * 60 * 60_000 + 1000);
  });

  it("sets a 24-hour cooldown for a quota/billing failure without a limitName", async () => {
    const before = Date.now();
    await recordAiKeyFailure("key-billing", "OpenCode API error (402): insufficient funds");

    const [, values] = executeMock.mock.calls[0];
    expect(values[0]).toBe("quota_exhausted");
    const cooldownMs = Date.parse(values[4]);
    expect(cooldownMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60_000 - 1000);
    expect(cooldownMs).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000 + 1000);
  });

  it("keeps an ordinary burst rate-limit on the legacy 15-minute fallback", async () => {
    await recordAiKeyFailure("key-burst", "OpenCode API error (429): rate limit exceeded");

    const [, values] = executeMock.mock.calls[0];
    expect(values[0]).toBe("rate_limited");
    expect(values[4]).toBeNull();
  });

  it("clears a prior cooldown when the key succeeds", async () => {
    await recordAiKeySuccess("key-recovered");

    const [sql, values] = executeMock.mock.calls[0];
    expect(sql).toContain("cooldown_until = NULL");
    expect(values.at(-1)).toBe("key-recovered");
  });

  it("uses an explicit cooldown even after the legacy 15-minute window elapsed", () => {
    const now = Date.now();
    const sixteenMinutesAgo = new Date(now - 16 * 60_000).toISOString();
    const twoHoursAhead = new Date(now + 2 * 60 * 60_000).toISOString();

    expect(isKeyCoolingDown({
      provider: "opencode",
      status: "rate_limited",
      last_failure_at: sixteenMinutesAgo,
      cooldown_until: twoHoursAhead,
    }, now)).toBe(true);
  });

  it("lets a key rejoin after its explicit cooldown expires", () => {
    const now = Date.now();
    const sixteenMinutesAgo = new Date(now - 16 * 60_000).toISOString();
    const oneMinuteAgo = new Date(now - 60_000).toISOString();

    expect(isKeyCoolingDown({
      provider: "opencode",
      status: "quota_exhausted",
      last_failure_at: sixteenMinutesAgo,
      cooldown_until: oneMinuteAgo,
    }, now)).toBe(false);
  });

  it("preserves the legacy 15-minute cooldown when cooldown_until is NULL", () => {
    const now = Date.now();

    expect(isKeyCoolingDown({
      provider: "opencode",
      status: "rate_limited",
      last_failure_at: new Date(now - 5 * 60_000).toISOString(),
      cooldown_until: null,
    }, now)).toBe(true);
    expect(isKeyCoolingDown({
      provider: "opencode",
      status: "rate_limited",
      last_failure_at: new Date(now - 16 * 60_000).toISOString(),
      cooldown_until: null,
    }, now)).toBe(false);
  });

  it("keeps Vertex Proxy exempt from transient key cooldowns", () => {
    expect(isKeyCoolingDown({
      provider: "google_vertex_proxy",
      status: "rate_limited",
      last_failure_at: new Date().toISOString(),
      cooldown_until: new Date(Date.now() + 60 * 60_000).toISOString(),
    })).toBe(false);
  });
});
