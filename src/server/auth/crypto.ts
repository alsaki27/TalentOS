// src/server/auth/crypto.ts
// Web Crypto API password hashing for Cloudflare Workers + Node.js
// Uses PBKDF2-SHA256 with 100,000 iterations (OWASP recommendation)

const crypto = globalThis.crypto;

const ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits

export interface PasswordHash {
  algorithm: "pbkdf2";
  hash: string;    // base64
  salt: string;    // base64
  iterations: number;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decodeBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  const saltB64 = encodeBase64(salt.buffer as ArrayBuffer);
  const hashB64 = encodeBase64(hashBuffer);

  return `pbkdf2:sha256:${ITERATIONS}:${saltB64}:${hashB64}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith("pbkdf2:sha256:")) {
    return false;
  }

  const parts = storedHash.split(":");
  if (parts.length !== 5) return false;

  const iterations = parseInt(parts[2], 10);
  const salt = decodeBase64(parts[3]);
  const expectedHash = decodeBase64(parts[4]);

  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    expectedHash.length * 8
  );

  const actualHash = new Uint8Array(hashBuffer);
  if (actualHash.length !== expectedHash.length) return false;

  // Constant-time comparison
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash[i] ^ expectedHash[i];
  }
  return diff === 0;
}
