import { cookies } from "next/headers";
import { queryOne } from "@/server/db/neon";
import { sha256Hex } from "@/lib/sha256";

export const SCHEDULED_LOGGING_COOKIE = "scheduled_candidate_logging_session";
const SESSION_TTL_HOURS = 8;
const PBKDF2_ITERATIONS = 310_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export function randomToken(byteCount = 32): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(byteCount)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function derivePasswordHash(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = fromBase64(salt).buffer as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt: saltBuffer,
    iterations: PBKDF2_ITERATIONS,
    hash: "SHA-256",
  }, key, 256);
  return toBase64(new Uint8Array(bits));
}

export async function createScheduledLoggingSession(adminUserId: string): Promise<string> {
  await queryOne("DELETE FROM scheduled_candidate_logging_sessions WHERE expires_at <= NOW() RETURNING token_hash");
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  await queryOne(
    `INSERT INTO scheduled_candidate_logging_sessions (token_hash, admin_user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '${SESSION_TTL_HOURS} hours') RETURNING token_hash`,
    [tokenHash, adminUserId],
  );
  return token;
}

export async function hasScheduledLoggingSession(adminUserId: string): Promise<boolean> {
  const token = cookies().get(SCHEDULED_LOGGING_COOKIE)?.value;
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  return !!(await queryOne(
    `SELECT 1 FROM scheduled_candidate_logging_sessions
      WHERE token_hash = $1 AND admin_user_id = $2 AND expires_at > NOW()`,
    [tokenHash, adminUserId],
  ));
}

export async function revokeScheduledLoggingSession(token: string, adminUserId: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await queryOne(
    `DELETE FROM scheduled_candidate_logging_sessions
      WHERE token_hash = $1 AND admin_user_id = $2 RETURNING token_hash`,
    [tokenHash, adminUserId],
  );
}
