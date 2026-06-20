// src/lib/webhookEngine.ts
// Webhook delivery engine with HMAC signatures, retries, and event logging.
// Uses Web Crypto API (crypto.subtle) for Cloudflare Workers compatibility.

import { supabase } from "./supabase";

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
        await supabase.from("webhook_events").insert({
          endpoint_id: endpoint.id,
          event_type: event,
          payload,
          response_status: responseStatus,
          response_body: responseBody.slice(0, 5000),
          attempt_count: attempt,
          max_attempts: maxAttempts,
          delivered_at: new Date().toISOString(),
        });
        await supabase
          .from("webhook_endpoints")
          .update({
            last_delivered_at: new Date().toISOString(),
            failure_count: 0,
          })
          .eq("id", endpoint.id);
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

  await supabase.from("webhook_events").insert({
    endpoint_id: endpoint.id,
    event_type: event,
    payload,
    response_status: responseStatus,
    response_body: responseBody?.slice(0, 5000) ?? null,
    attempt_count: attempt,
    max_attempts: maxAttempts,
    failed_at: new Date().toISOString(),
    error_message: lastError,
  });

  await supabase
    .from("webhook_endpoints")
    .update({
      last_failure_at: new Date().toISOString(),
      failure_count: endpoint.failure_count + 1,
    })
    .eq("id", endpoint.id);

  return { success: false, error: lastError ?? undefined };
}

export async function triggerWebhooks(
  event: string,
  payload: any
): Promise<WebhookDeliveryResult[]> {
  const { data: endpoints, error } = await supabase
    .from("webhook_endpoints")
    .select("*")
    .eq("status", "active");

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
