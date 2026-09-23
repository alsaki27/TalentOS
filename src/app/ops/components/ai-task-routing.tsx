// src/app/ops/components/ai-task-routing.tsx
// Admin UI for per-task-category AI provider routing.

"use client";

import { useEffect, useState } from "react";

interface RoutingConfig {
  category: string;
  provider: string | null;
  ai_key_id: string | null;
  ai_key_label: string | null;
  ai_key_provider: string | null;
  updated_at: string | null;
}

interface AiKey {
  id: string;
  provider: string;
  label: string;
  model: string | null;
  is_enabled: boolean;
}

const CATEGORIES = [
  { value: "resume_studio", label: "Resume Studio", description: "Base resume creation, application tailoring, suggestions" },
  { value: "chat_assistant", label: "Chat Assistant", description: "Chat assistant messages" },
  { value: "parsing_extraction", label: "Parsing & Extraction", description: "Resume parsing, JD analysis, keyword extraction, job categorization" },
  { value: "content_generation", label: "Content Generation", description: "Cover letters, recruiter messages, digests" },
  { value: "default", label: "Default (fallback)", description: "Anything not explicitly mapped" },
];

const PROVIDERS = [
  { value: null, label: "Use default chain" },
  { value: "anthropic", label: "Anthropic" },
  { value: "nvidia", label: "NVIDIA (Kimi K2)" },
  { value: "openai", label: "OpenAI" },
  { value: "glm", label: "GLM (Zhipu)" },
  { value: "google", label: "Google AI Studio" },
  { value: "google_vertex_proxy", label: "Google Vertex Proxy" },
];

export default function AiTaskRouting() {
  const [configs, setConfigs] = useState<Record<string, RoutingConfig>>({});
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [configRes, keysRes] = await Promise.all([
        fetch("/api/admin/ai-task-routing"),
        fetch("/api/admin/ai-keys"),
      ]);
      if (!configRes.ok) throw new Error("Failed to load routing configs");
      if (!keysRes.ok) throw new Error("Failed to load AI keys");
      const configData = await configRes.json();
      const keysData = await keysRes.json();

      const map: Record<string, RoutingConfig> = {};
      for (const c of configData.configs ?? []) {
        map[c.category] = c;
      }
      setConfigs(map);
      setKeys((keysData.keys ?? []).filter((k: AiKey) => k.is_enabled));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function save(category: string, provider: string | null, aiKeyId: string | null) {
    setSaving(category);
    setError("");
    try {
      const res = await fetch("/api/admin/ai-task-routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, provider, aiKeyId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="card"><p className="muted">Loading routing config…</p></div>;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <label style={{ fontSize: 16, fontWeight: 700 }}>AI Task Routing</label>
      <p className="muted" style={{ fontSize: 12, margin: "6px 0 12px" }}>
        Route specific AI tasks to specific providers or keys. Unmapped categories fall back to the global default chain.
      </p>
      {error && <p style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {CATEGORIES.map((cat) => {
          const cfg = configs[cat.value];
          const currentProvider = cfg?.provider ?? null;
          const currentKeyId = cfg?.ai_key_id ?? null;
          const keysForProvider = currentProvider
            ? keys.filter((k) => k.provider === currentProvider)
            : keys;

          return (
            <div key={cat.value} style={{ display: "grid", gridTemplateColumns: "180px 200px 1fr", gap: 10, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{cat.label}</div>
                <div className="muted" style={{ fontSize: 11 }}>{cat.description}</div>
              </div>

              <select
                value={currentProvider ?? ""}
                onChange={(e) => {
                  const provider = e.target.value || null;
                  save(cat.value, provider, null);
                }}
                disabled={saving === cat.value}
                style={{ fontSize: 13, padding: "6px 8px" }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.label} value={p.value ?? ""}>{p.label}</option>
                ))}
              </select>

              {currentProvider ? (
                <select
                  value={currentKeyId ?? ""}
                  onChange={(e) => {
                    const keyId = e.target.value || null;
                    save(cat.value, currentProvider, keyId);
                  }}
                  disabled={saving === cat.value}
                  style={{ fontSize: 13, padding: "6px 8px" }}
                >
                  <option value="">Any {currentProvider} key (env or DB)</option>
                  {keysForProvider.map((k) => (
                    <option key={k.id} value={k.id}>{k.label} ({k.model ?? "default model"})</option>
                  ))}
                </select>
              ) : (
                <span className="muted" style={{ fontSize: 12 }}>Using global default chain</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
