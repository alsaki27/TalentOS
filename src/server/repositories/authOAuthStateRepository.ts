import { queryOne } from "@/server/db/neon";

export type AuthOAuthFlow = "staff_google" | "candidate_google";

export interface ConsumedAuthOAuthState {
  flow_type: AuthOAuthFlow;
  candidate_id: string | null;
  next_path: string | null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newAuthOAuthState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createAuthOAuthState(params: {
  state: string;
  flow: AuthOAuthFlow;
  candidateId?: string | null;
  nextPath?: string | null;
}) {
  await queryOne(
    `INSERT INTO auth_oauth_states (state_hash, flow_type, candidate_id, next_path, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')
     RETURNING state_hash`,
    [await sha256(params.state), params.flow, params.candidateId ?? null, params.nextPath ?? null],
  );
}

export async function consumeAuthOAuthState(params: {
  state: string;
  flow: AuthOAuthFlow;
}): Promise<ConsumedAuthOAuthState | null> {
  return queryOne<ConsumedAuthOAuthState>(
    `UPDATE auth_oauth_states
        SET consumed_at = NOW()
      WHERE state_hash = $1
        AND flow_type = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING flow_type, candidate_id, next_path`,
    [await sha256(params.state), params.flow],
  );
}
