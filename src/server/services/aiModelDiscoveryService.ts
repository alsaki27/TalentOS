import { getAiKeyWithDecryptedKey, updateAiKeyModels, type DiscoveredModelInfo } from "@/server/repositories/aiKeyRepository";
import { PROVIDER_NATIVE_DEFAULTS, type ApiStyle } from "@/lib/ai/providerPresets";
import { recordAuditEvent } from "@/server/repositories/aiAdminAuditRepository";

export interface DiscoveredModel {
  id: string;
  displayName?: string;
  provider: string;
  ownedBy?: string;
  createdAt?: string;
  capabilities?: {
    tools?: boolean;
    streaming?: boolean;
    jsonMode?: boolean;
    vision?: boolean;
    reasoning?: boolean;
  };
}

export async function discoverModelsForKey(keyId: string): Promise<{ models: DiscoveredModel[]; error: string | null }> {
  const keyRow = await getAiKeyWithDecryptedKey(keyId);
  if (!keyRow) throw new Error("Key not found");

  const defaults = PROVIDER_NATIVE_DEFAULTS[keyRow.provider];
  const baseUrl = (keyRow as any).base_url || defaults?.baseUrl;
  const modelsEndpoint = (keyRow as any).models_endpoint || defaults?.modelsEndpoint;
  const chatEndpoint = (keyRow as any).chat_endpoint || defaults?.chatEndpoint;
  const apiStyle = (keyRow as any).api_style || defaults?.apiStyle || "chat_completions";
  const authHeader = (keyRow as any).auth_header_name || defaults?.authHeaderName || "Authorization";
  const authScheme = (keyRow as any).auth_scheme || defaults?.authScheme || "Bearer";

  if (!modelsEndpoint) {
    await updateAiKeyModels(keyId, [], null);
    return { models: [], error: null };
  }

  if (!baseUrl || (apiStyle !== "chat_completions" && apiStyle !== "anthropic_messages" && apiStyle !== "gemini_generate_content")) {
    await updateAiKeyModels(keyId, [], null);
    return { models: [], error: null };
  }

  const url = baseUrl.replace(/\/$/, '') + modelsEndpoint;
  const authValue = authScheme === "raw" ? keyRow.decrypted_key : `Bearer ${keyRow.decrypted_key}`;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const headers: Record<string, string> = {};
    headers[authHeader] = authValue;
    if (keyRow.provider === "anthropic") {
      headers["anthropic-version"] = "2023-06-01";
    }

    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      const error = `Model discovery failed: HTTP ${res.status}`;
      await updateAiKeyModels(keyId, [], error);
      await recordAuditEvent({ action: "models_synced", aiKeyId: keyId, metadata: { error } });
      return { models: [], error };
    }

    const body = await res.json();
    const models = parseModelList(keyRow.provider, body, apiStyle);
    
    await updateAiKeyModels(keyId, models.map(m => ({
      id: m.id,
      displayName: m.displayName,
      source: "provider" as const,
    })), null);

    await recordAuditEvent({ action: "models_synced", aiKeyId: keyId, metadata: { modelCount: models.length } });
    return { models, error: null };
  } catch (err: any) {
    const error = `Model discovery error: ${sanitizeError(err)}`;
    await updateAiKeyModels(keyId, [], error);
    await recordAuditEvent({ action: "models_synced", aiKeyId: keyId, metadata: { error } });
    return { models: [], error };
  } finally {
    clearTimeout(timeout);
  }
}

function parseModelList(provider: string, body: any, apiStyle: string): DiscoveredModel[] {
  if (apiStyle === "chat_completions" || provider === "openai" || provider === "openai_compatible" || provider === "deepseek" || provider === "moonshot" || provider === "groq" || provider === "openrouter" || provider === "nvidia") {
    const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    return data.map((m: any) => ({
      id: String(m.id || ""),
      displayName: m.display_name || m.name || m.id,
      provider,
      ownedBy: m.owned_by,
      createdAt: m.created ? new Date(m.created * 1000).toISOString() : m.created_at,
    })).filter((m: DiscoveredModel) => m.id);
  }
  
  if (apiStyle === "gemini_generate_content" || provider === "google") {
    const models = Array.isArray(body?.models) ? body.models : [];
    return models.map((m: any) => ({
      id: String(m.name || "").replace(/^models\//, ""),
      displayName: m.displayName || m.name,
      provider,
    })).filter((m: DiscoveredModel) => m.id);
  }

  if (apiStyle === "anthropic_messages" || provider === "anthropic") {
    const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    return data.map((m: any) => ({
      id: String(m.id || ""),
      displayName: m.display_name || m.id,
      provider,
      createdAt: m.created_at,
    })).filter((m: DiscoveredModel) => m.id);
  }

  return [];
}

function sanitizeError(err: any): string {
  if (err?.name === "AbortError") return "Request timed out (10s)";
  const msg = err?.message || String(err);
  return msg.replace(/[a-zA-Z0-9_-]{20,}/g, "[REDACTED]");
}
