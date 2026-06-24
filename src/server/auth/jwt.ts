// src/server/auth/jwt.ts
// Web Crypto API JWT for Cloudflare Workers + Node.js
// Uses HMAC-SHA256 (HS256) — no external libraries needed

const crypto = globalThis.crypto;

const JWT_SECRET = process.env.JWT_SECRET ?? process.env.AI_KEYS_ENCRYPTION_SECRET ?? "";

export interface JWTPayload {
  user_id: string;
  email: string | null;
  role: string;
  iat: number;
  exp: number;
}

function encodeBase64url(buffer: BufferSource): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64url(str: string): Uint8Array {
  // Base64url padding: length must be divisible by 4
  const padding = (4 - (str.length % 4)) % 4;
  const padded = str + "=".repeat(padding);
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function stringToBuffer(str: string): BufferSource {
  return new TextEncoder().encode(str) as BufferSource;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    stringToBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createJWT(payload: Omit<JWTPayload, "iat" | "exp">): Promise<string> {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24 * 7, // 7 days
  };

  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = encodeBase64url(stringToBuffer(JSON.stringify(header)));
  const payloadB64 = encodeBase64url(stringToBuffer(JSON.stringify(fullPayload)));
  const message = `${headerB64}.${payloadB64}`;

  const key = await importKey(JWT_SECRET);
  const signature = await crypto.subtle.sign("HMAC", key, stringToBuffer(message));
  const signatureB64 = encodeBase64url(signature);

  return `${message}.${signatureB64}`;
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  if (!JWT_SECRET) {
    console.error("JWT_SECRET not set");
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const message = `${headerB64}.${payloadB64}`;

  const key = await importKey(JWT_SECRET);
  const signature = decodeBase64url(signatureB64);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature as BufferSource,
    stringToBuffer(message)
  );

  if (!valid) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(payloadB64))) as JWTPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // expired
    }
    return payload;
  } catch {
    return null;
  }
}
