// Regression coverage for getAiKeyWithDecryptedKey's decrypt-failure handling.
//
// Context: a single corrupted key row, or an AI_KEYS_ENCRYPTION_SECRET rotated
// since the row was written, must degrade to a logged null - not throw - because
// routing.ts's getProviderForAutomation calls this unwrapped, and an unhandled
// throw here breaks route resolution for every automation trying that key, not
// just the one bad key. This guards against that catch being removed/bypassed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryOneMock, decryptSecretMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
  decryptSecretMock: vi.fn(),
}));

vi.mock("@/server/db/index", () => ({
  isNeon: () => true,
}));

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: queryOneMock,
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
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

import { getAiKeyWithDecryptedKey } from "@/server/repositories/aiKeyRepository";

describe("getAiKeyWithDecryptedKey", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
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
});
