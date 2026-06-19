// src/server/security/secretCrypto.ts
// Encryption/decryption helper for secrets (API keys, tokens).
// Uses Node crypto for now. Cloudflare migration note: this module uses
// createCipheriv/createDecipheriv which are Node-specific. For Cloudflare Workers,
// replace with the Web Crypto API (crypto.subtle.encrypt / crypto.subtle.decrypt)
// using the same AES-256-GCM algorithm. The exported interface (encryptSecret,
// decryptSecret) should remain unchanged.

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const secret = process.env.AI_KEYS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "AI_KEYS_ENCRYPTION_SECRET is not set. Add it to your environment to enable API key encryption."
    );
  }
  // Derive a 32-byte key from the secret using SHA-256
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a plaintext string. Returns a hex string containing:
 * iv (16 bytes) + authTag (16 bytes) + ciphertext
 */
export function encryptSecret(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("hex");
}

/**
 * Decrypt a hex string produced by encryptSecret.
 */
export function decryptSecret(encryptedHex: string): string {
  const key = getKey();
  const data = Buffer.from(encryptedHex, "hex");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Create a fingerprint of a key for display purposes (first 6 + last 4 chars).
 * Never reveals the full key.
 */
export function fingerprintKey(key: string): string {
  if (key.length <= 10) return "****" + key.slice(-4);
  return key.slice(0, 6) + "..." + key.slice(-4);
}

/**
 * Check if encryption is available (AI_KEYS_ENCRYPTION_SECRET is set).
 */
export function isEncryptionAvailable(): boolean {
  return !!process.env.AI_KEYS_ENCRYPTION_SECRET;
}
