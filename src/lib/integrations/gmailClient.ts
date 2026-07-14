import { queryOne, execute } from "@/server/db/neon";

const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

export interface IntegrationAccountRow {
  id: string;
  candidate_id: string;
  email: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string[] | string | null;
  metadata: Record<string, unknown> | null;
}

export interface ParsedGmailMessage {
  id: string;
  threadId: string;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  inReplyTo: string | null;
  references: string | null;
  bodyPlain: string | null;
  internalDate: string | null;
}

export interface GmailHistoryItem {
  id: string;
  messagesAdded?: { message: { id: string; threadId: string } }[];
}

export class GmailScopeMissingError extends Error {
  constructor(public email: string | null) {
    super(`Candidate must re-connect Gmail to grant send scope (${email ?? "unknown"})`);
    this.name = "GmailScopeMissingError";
  }
}

export async function refreshIfNeeded(account: IntegrationAccountRow): Promise<string> {
  if (account.token_expires_at && new Date(account.token_expires_at).getTime() > Date.now() + 60000) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    return account.access_token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for token refresh.");
  }

  const res = await fetch(GMAIL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${data.error_description || data.error || "unknown"}`);
  }

  const newToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) ?? 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await execute(
    `UPDATE integration_accounts SET access_token = $1, token_expires_at = $2 WHERE id = $3`,
    [newToken, expiresAt, account.id]
  );

  return newToken;
}

export async function listMessages(
  accessToken: string,
  query: string,
  maxResults = 50
): Promise<{ id: string; threadId: string }[]> {
  const url = new URL(`${GMAIL_API_BASE}/users/me/messages`);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail listMessages failed: ${data.error?.message || "unknown"}`);
  }

  return (data.messages ?? []) as { id: string; threadId: string }[];
}

export async function getMessage(
  accessToken: string,
  messageId: string,
  format: "full" | "metadata" = "full"
): Promise<ParsedGmailMessage | null> {
  const url = `${GMAIL_API_BASE}/users/me/messages/${messageId}?format=${format}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.error?.code === 404) return null;
    throw new Error(`Gmail getMessage failed: ${data.error?.message || "unknown"}`);
  }

  const headers = data.payload?.headers ?? [];
  const h = (name: string) => headers.find((x: any) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

  let bodyPlain: string | null = null;
  if (format === "full") {
    bodyPlain = extractPlainText(data.payload);
  }

  return {
    id: data.id,
    threadId: data.threadId,
    subject: h("Subject"),
    from: h("From"),
    to: h("To"),
    cc: h("Cc"),
    inReplyTo: h("In-Reply-To"),
    references: h("References"),
    bodyPlain,
    internalDate: data.internalDate ?? null,
  };
}

export async function listHistory(
  accessToken: string,
  startHistoryId: string
): Promise<GmailHistoryItem[]> {
  const url = new URL(`${GMAIL_API_BASE}/users/me/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message ?? "unknown";
    throw new Error(`Gmail history list failed: ${msg}`);
  }

  return (data.history ?? []) as GmailHistoryItem[];
}

export async function getProfile(accessToken: string): Promise<{
  emailAddress: string;
  historyId: string;
} | null> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = await res.json();
  if (!res.ok) return null;

  return {
    emailAddress: data.emailAddress,
    historyId: String(data.historyId),
  };
}

export async function sendMessage(
  accessToken: string,
  rawBase64url: string
): Promise<{ id: string; threadId: string }> {
  const res = await fetch(`${GMAIL_API_BASE}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawBase64url }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${data.error?.message || "unknown"}`);
  }

  return { id: data.id, threadId: data.threadId };
}

function extractPlainText(part: any): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) {
    return base64urlDecode(part.body.data);
  }

  const parts = part.parts as any[] | undefined;
  if (parts) {
    const plain = parts.find((p: any) => p.mimeType === "text/plain");
    if (plain?.body?.data) return base64urlDecode(plain.body.data);
    const html = parts.find((p: any) => p.mimeType === "text/html");
    if (html?.body?.data) {
      const raw = base64urlDecode(html.body.data);
      return raw.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    }
  }

  if (part.body?.data) {
    return base64urlDecode(part.body.data);
  }

  return null;
}

function base64urlDecode(str: string): string {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
