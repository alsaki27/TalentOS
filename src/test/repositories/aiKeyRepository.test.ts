// Regression coverage for getAiKeyWithDecryptedKey's decrypt-failure handling.
//
// Context: a single corrupted key row, or an AI_KEYS_ENCRYPTION_SECRET rotated
// since the row was written, must degrade to a logged null - not throw - because
// routing.ts's getProviderForAutomation calls this unwrapped, and an unhandled
// throw here breaks route resolution for every automation trying that key, not
// just the one bad key. This guards against that catch being removed/bypassed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryOneMock, executeMock, decryptSecretMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  executeMock: vi.fn().mockResolvedValue({ rowCount: 1 }),
  decryptSecretMock: vi.fn(),
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

import { getAiKeyWithDecryptedKey, recordAiKeyFailure } from "@/server/repositories/aiKeyRepository";

describe("getAiKeyWithDecryptedKey", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
    executeMock.mockReset().mockResolvedValue({ rowCount: 1 });
    decryptSecretMock.mockReset();
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

  it("classifies a combined Google rate-limit/quota response as quota exhausted", async () => {
    await recordAiKeyFailure("vertex-a", "Google Vertex Proxy: rate limit or quota exceeded.");

    const [, values] = executeMock.mock.calls[0];
    expect(values[0]).toBe("quota_exhausted");
    expect(values[5]).toBe("vertex-a");
  });
});
