// src/lib/ai/providerPresets.ts
// Pure data module: AI provider endpoint defaults, model presets, and display labels.
// Zero side effects — no imports of server/db/env code, no I/O. Safe to import from
// anywhere (server, client, scripts). This replaces the hardcoded endpoint URLs and
// default models that were previously inlined in src/server/services/aiProvider.ts.
// `glm` and `opencode` intentionally have NO baseUrl in PROVIDER_NATIVE_DEFAULTS:
// GLM requires an admin-supplied regional endpoint, and OpenCode requires a verified
// external URL — both must be supplied at key-creation time rather than preset here.

export type ApiStyle = "chat_completions" | "anthropic_messages" | "gemini_generate_content" | "responses";

export interface ProviderNativeDefault {
  baseUrl: string;
  modelsEndpoint?: string;
  chatEndpoint: string;
  apiStyle: ApiStyle;
  authHeaderName: string;
  authScheme: "Bearer" | "raw";
}

// Per-provider native endpoint defaults.
// IMPORTANT: `glm` and `opencode` intentionally have NO baseUrl here.
// GLM requires admin-supplied regional endpoint. OpenCode requires verified external URL.
export const PROVIDER_NATIVE_DEFAULTS: Record<string, ProviderNativeDefault> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    modelsEndpoint: "/models",
    chatEndpoint: "/chat/completions",
    apiStyle: "chat_completions",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    modelsEndpoint: "/v1/models",
    chatEndpoint: "/v1/messages",
    apiStyle: "anthropic_messages",
    authHeaderName: "x-api-key",
    authScheme: "raw",
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com",
    modelsEndpoint: "/v1beta/models",
    chatEndpoint: "/v1beta/models/{model}:generateContent",
    apiStyle: "gemini_generate_content",
    authHeaderName: "x-goog-api-key",
    authScheme: "raw",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    chatEndpoint: "/v1/chat/completions",
    apiStyle: "chat_completions",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.ai/v1",
    chatEndpoint: "/chat/completions",
    apiStyle: "chat_completions",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    modelsEndpoint: "/models",
    chatEndpoint: "/chat/completions",
    apiStyle: "chat_completions",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    modelsEndpoint: "/models",
    chatEndpoint: "/chat/completions",
    apiStyle: "chat_completions",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  },
  nvidia: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    chatEndpoint: "/chat/completions",
    apiStyle: "chat_completions",
    authHeaderName: "Authorization",
    authScheme: "Bearer",
  },
  // glm: intentionally omitted — admin must supply baseUrl
  // opencode: intentionally omitted — admin must supply verified baseUrl
};

// Model presets per provider — shown in UI combobox, never enforced server-side.
// Admin can type any model string regardless of this list.
export const PROVIDER_MODEL_PRESETS: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { id: "o1", label: "o1" },
    { id: "o3-mini", label: "o3-mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-fable-5", label: "Claude Fable 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
  ],
  google: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  // Same Gemini model family as the native `google` provider - Vertex AI hosts
  // the same models, just via the Cloud Run proxy instead of the public
  // Generative Language API. Whether a given model actually works depends on
  // what the proxy itself forwards/allowlists (see GOOGLE_VERTEX_PROXY_URL) -
  // this list is a starting point, not a guarantee; untested IDs may 404 or
  // error at the proxy.
  google_vertex_proxy: [
    // These are the stable models available in the current production
    // Vertex project. Preview/3.x IDs are intentionally omitted because
    // route overrides bypass proxy aliases and would return model-not-found.
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  deepseek: [
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
  ],
  moonshot: [
    { id: "kimi-k2.6", label: "Kimi K2.6" },
  ],
  opencode: [
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "glm-5.2", label: "GLM 5.2" },
    { id: "kimi-k2.6", label: "Kimi K2.6" },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "minimax-m2.5", label: "MiniMax M2.5" },
  ],
  glm: [
    { id: "glm-5.2", label: "GLM 5.2" },
  ],
  openrouter: [],
  groq: [],
  nvidia: [],
};

// Friendly display names for providers
export const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  google_vertex_proxy: "Google Vertex (Proxy)",
  deepseek: "DeepSeek",
  moonshot: "Moonshot (Kimi)",
  opencode: "OpenCode",
  glm: "GLM / Zhipu",
  openrouter: "OpenRouter",
  groq: "Groq",
  nvidia: "NVIDIA",
  local: "Local",
  openai_compatible: "OpenAI-Compatible (Custom)",
};
