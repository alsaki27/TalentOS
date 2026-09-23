// src/lib/webhookEngine.ts
// Webhook delivery engine with HMAC signatures, retries, and event logging.
// Uses Web Crypto API (crypto.subtle) for Cloudflare Workers compatibility.

import { query, queryOne, execute } from "@/server/db/neon";

export interface WebhookEndpoint {
  id: string;
  org_id: string | null;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  status: string;
  last_delivered_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  created_at: string;
}

export interface WebhookDeliveryResult {
  success: boolean;
  status?: number;
  error?: string;
}

async function generateWebhookSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

export async function deliverWebhook(
  endpoint: WebhookEndpoint,
  event: string,
  payload: any
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
  });

  const signature = endpoint.secret ? await generateWebhookSignature(endpoint.secret, body) : undefined;

  const maxAttempts = 5;
  let attempt = 0;
  let lastError: string | null = null;
  let responseStatus: number | null = null;
  let responseBody: string | null = null;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(signature ? { "X-Webhook-Signature": signature } : {}),
          "User-Agent": "TalentOS-Webhook/1.0",
        },
        body,
      });
      responseStatus = res.status;
      responseBody = await res.text().catch(() => "");
      if (res.ok) {
        await execute(
          `INSERT INTO webhook_events (endpoint_id, event_type, payload, response_status, response_body, attempt_count, max_attempts, delivered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [endpoint.id, event, payload, responseStatus, responseBody.slice(0, 5000), attempt, maxAttempts, new Date().toISOString()]
        );
        await execute(
          `UPDATE webhook_endpoints SET last_delivered_at = $1, failure_count = 0 WHERE id = $2`,
          [new Date().toISOString(), endpoint.id]
        );
        return { success: true, status: responseStatus };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = err.message || "Network error";
      responseStatus = null;
      responseBody = null;
    }

    if (attempt < maxAttempts) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  await execute(
    `INSERT INTO webhook_events (endpoint_id, event_type, payload, response_status, response_body, attempt_count, max_attempts, failed_at, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [endpoint.id, event, payload, responseStatus, responseBody?.slice(0, 5000) ?? null, attempt, maxAttempts, new Date().toISOString(), lastError]
  );
  await execute(
    `UPDATE webhook_endpoints SET last_failure_at = $1, failure_count = $2 WHERE id = $3`,
    [new Date().toISOString(), endpoint.failure_count + 1, endpoint.id]
  );

  return { success: false, error: lastError ?? undefined };
}

export async function triggerWebhooks(
  event: string,
  payload: any
): Promise<WebhookDeliveryResult[]> {
  let endpoints: any[];
  let error: any;

  endpoints = await query('SELECT * FROM webhook_endpoints WHERE status = $1', ['active']);
  error = null;

  if (error || !endpoints || endpoints.length === 0) {
    return [];
  }

  const matching = endpoints.filter(
    (ep: any) => ep.events.length === 0 || ep.events.includes(event) || ep.events.includes("*")
  );

  if (matching.length === 0) return [];

  const results = await Promise.all(
    matching.map((ep: any) => deliverWebhook(ep as WebhookEndpoint, event, payload))
  );
  return results;
}
