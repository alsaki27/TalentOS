import "server-only";

const SSN_AAD_VERSION = "skarion:candidate-ssn:last4:v1";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function getEncryptionKeyBytes(): Uint8Array {
  const encoded = process.env.CANDIDATE_SSN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Candidate SSN encryption is not configured.");

  let binary: string;
  try {
    binary = atob(encoded.trim());
  } catch {
    throw new Error("Candidate SSN encryption key must be base64 encoded.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("Candidate SSN encryption key must decode to 32 bytes.");
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importEncryptionKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(getEncryptionKeyBytes()),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptCandidateSsnLast4(last4: string, candidateId: string): Promise<string> {
  if (!/^\d{4}$/.test(last4)) throw new Error("SSN value must contain exactly four digits.");
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`${SSN_AAD_VERSION}:${candidateId}`);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    await importEncryptionKey(),
    new TextEncoder().encode(last4),
  );
  return `v1.${encodeBase64(iv)}.${encodeBase64(new Uint8Array(ciphertext))}`;
}

/** Server-side integration seam for a future identity-verification provider. */
export async function decryptCandidateSsnLast4(encrypted: string, candidateId: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, extra] = encrypted.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra) {
    throw new Error("Unsupported encrypted candidate SSN value.");
  }
  const additionalData = new TextEncoder().encode(`${SSN_AAD_VERSION}:${candidateId}`);
  const cleartext = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(decodeBase64(encodedIv)), additionalData },
    await importEncryptionKey(),
    toArrayBuffer(decodeBase64(encodedCiphertext)),
  );
  const last4 = new TextDecoder().decode(cleartext);
  if (!/^\d{4}$/.test(last4)) throw new Error("Decrypted candidate SSN value is invalid.");
  return last4;
}
