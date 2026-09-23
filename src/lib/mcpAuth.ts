import { queryOne, execute } from "@/server/db/neon";

export const MCP_SCOPES = [
  "mcp:candidates:read", "mcp:resumes:read", "mcp:jobs:read", "mcp:matching:read",
  "mcp:applications:read", "mcp:analytics:read", "mcp:workflows:read", "mcp:emails:read",
  "mcp:applications:create", "mcp:applications:assign", "mcp:applications:stage",
  "mcp:applications:comment", "mcp:workflows:retry", "mcp:resumes:regenerate",
] as const;
export type McpScope = typeof MCP_SCOPES[number];

function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function generateMcpKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `mcp_live_${bytesToBase64Url(bytes)}`;
}
export async function hashMcpKey(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function mcpKeyPrefix(key: string) { return key.slice(0, 16); }

export async function authenticateMcp(req: Request, required: McpScope[] = []) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("mcp_live_")) return { error: "MCP API key required", status: 401 } as const;
  const row = await queryOne<any>("SELECT id,name,scopes,expires_at,revoked_at FROM mcp_api_keys WHERE key_hash=$1", [await hashMcpKey(token)]);
  if (!row || row.revoked_at || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return { error: "Invalid or expired MCP API key", status: 401 } as const;
  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  const missing = required.filter((scope) => !scopes.includes(scope));
  if (missing.length) return { error: `Missing scope: ${missing.join(", ")}`, status: 403 } as const;
  await execute("UPDATE mcp_api_keys SET last_used_at=now() WHERE id=$1", [row.id]);
  return { keyId: row.id, name: row.name, scopes } as const;
}

export async function auditMcp(input: { keyId?: string; requestId: string; tool: string; action: "read"|"write"|"auth"|"error"; scopes?: string[]; success?: boolean; errorCode?: string; argsHash?: string; durationMs?: number; candidateId?: string; jobId?: string; applicationId?: string; }) {
  await execute(`INSERT INTO mcp_audit_events(api_key_id,request_id,tool_name,action,scopes,success,error_code,arguments_hash,duration_ms,candidate_id,job_id,application_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [input.keyId ?? null,input.requestId,input.tool,input.action,input.scopes ?? [],input.success ?? true,input.errorCode ?? null,input.argsHash ?? null,input.durationMs ?? null,input.candidateId ?? null,input.jobId ?? null,input.applicationId ?? null]);
}
