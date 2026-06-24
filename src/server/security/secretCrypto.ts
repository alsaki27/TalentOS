// src/server/security/secretCrypto.ts
// Encryption/decryption helper for secrets (API keys, tokens).
// Rewritten for Cloudflare Workers compatibility using Web Crypto API.
// Compatible with both Node.js 18+ and Cloudflare Workers (crypto.subtle is global).

const webCrypto = globalThis.crypto;

async function getKey(): Promise<CryptoKey> {
  const secret = process.env.AI_KEYS_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "AI_KEYS_ENCRYPTION_SECRET is not set. Add it to your environment to enable API key encryption."
    );
  }
  // Derive a 32-byte key from the secret using SHA-256
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const hash = await webCrypto.subtle.digest("SHA-256", keyData);
  return webCrypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a plaintext string. Returns a base64 string prefixed with enc:.
 * Format: enc:<base64(iv + ciphertext)>
 * Uses AES-256-GCM with a 96-bit (12-byte) IV.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = webCrypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoder = new TextEncoder();
  const ciphertext = await webCrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Base64 encode using btoa (available in both Node.js and Workers)
  const base64 = btoa(String.fromCharCode(...combined));
  return `enc:${base64}`;
}

/**
 * Decrypt a string produced by encryptSecret.
 * If the ciphertext does not start with "enc:", it is returned as-is
 * (assumes plaintext for legacy or unencrypted data).
 */
export async function decryptSecret(ciphertext: string): Promise<string> {
  if (!ciphertext.startsWith("enc:")) {
    // Not encrypted (legacy plaintext or already decrypted)
    return ciphertext;
  }

  const key = await getKey();
  const base64 = ciphertext.slice(4); // Remove "enc:" prefix
  const combined = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await webCrypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Create a fingerprint of a key for display purposes.
 * Returns the first 16 hex characters of the SHA-256 hash.
 * Never reveals the full key.
 */
export async function fingerprintKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await webCrypto.subtle.digest("SHA-256", encoder.encode(key));
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

/**
 * Check if encryption is available (crypto.subtle is present and AI_KEYS_ENCRYPTION_SECRET is set).
 */
export function isEncryptionAvailable(): boolean {
  return (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined" &&
    !!process.env.AI_KEYS_ENCRYPTION_SECRET
  );
}
