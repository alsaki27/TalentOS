// src/lib/integrations/gmailApi.ts
// Thin Gmail REST API client for the sync worker. Read-only (gmail.readonly
// scope) — never sends, modifies, or deletes anything in a candidate's mailbox.

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailTokenRefreshResult {
  access_token: string;
  expires_in: number;
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<GmailTokenRefreshResult> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID/SECRET not configured.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const code = data.error === "invalid_grant" ? "invalid_grant" : data.error || "refresh_failed";
    throw new Error(code);
  }
  return { access_token: data.access_token, expires_in: data.expires_in ?? 3600 };
}

interface GmailMessageListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
}

// Narrow to candidate-relevant mail only: sender/domain filter built by the
// caller from the candidate's known application companies, kept short (Gmail
// caps query length generously, but a huge OR list is still worth avoiding).
export async function listMessageIds(accessToken: string, query: string, pageToken?: string): Promise<GmailMessageListResponse> {
  const url = new URL(`${GMAIL_BASE}/messages`);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail messages.list failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

interface GmailHistoryResponse {
  history?: { messagesAdded?: { message: { id: string; threadId: string } }[] }[];
  historyId: string;
  nextPageToken?: string;
}

export async function listHistory(accessToken: string, startHistoryId: string, pageToken?: string): Promise<GmailHistoryResponse> {
  const url = new URL(`${GMAIL_BASE}/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 404 means the stored historyId is too old (Gmail expires history after
    // ~1 week) — caller should fall back to a fresh messages.list backfill.
    throw new Error(`Gmail history.list failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string | null;
  to: string[];
  subject: string | null;
  snippet: string;
  bodyText: string;
  sentAt: string;
  direction: "inbound" | "outbound";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return atob(padded);
  }
}

function extractBodyText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    const plain = payload.parts.find((p: any) => p.mimeType === "text/plain" && p.body?.data);
    if (plain) return decodeBase64Url(plain.body.data);
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html" && p.body?.data);
    if (htmlPart) return decodeBase64Url(htmlPart.body.data).replace(/<[^>]+>/g, " ");
    for (const part of payload.parts) {
      const nested = extractBodyText(part);
      if (nested) return nested;
    }
  }
  return "";
}

function headerValue(headers: { name: string; value: string }[], name: string): string | null {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

export async function getMessage(accessToken: string, messageId: string, ownerEmail: string | null): Promise<GmailMessage | null> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail messages.get failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const headers = data.payload?.headers ?? [];
  const from = headerValue(headers, "From");
  const to = (headerValue(headers, "To") || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  const dateHeader = headerValue(headers, "Date");

  return {
    id: data.id,
    threadId: data.threadId,
    from,
    to,
    subject: headerValue(headers, "Subject"),
    snippet: data.snippet || "",
    bodyText: extractBodyText(data.payload).slice(0, 20000),
    sentAt: dateHeader ? new Date(dateHeader).toISOString() : new Date(Number(data.internalDate)).toISOString(),
    direction: ownerEmail && from?.toLowerCase().includes(ownerEmail.toLowerCase()) ? "outbound" : "inbound",
  };
}
