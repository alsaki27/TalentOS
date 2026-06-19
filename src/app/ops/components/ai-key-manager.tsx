// src/app/ops/components/ai-key-manager.tsx
// Admin AI API key manager panel. Client component.

"use client";

import { useEffect, useState } from "react";

interface AiKey {
  id: string;
  provider: string;
  label: string;
  key_fingerprint: string;
  priority: number;
  is_enabled: boolean;
  status: string;
  last_tested_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  usage_count: number;
  failure_count: number;
  created_at: string | null;
  updated_at: string | null;
}

const PROVIDERS = [
  "anthropic",
  "nvidia",
  "openai",
  "google",
  "groq",
  "openrouter",
  "deepseek",
  "local",
];

export default function AiKeyManager() {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Add form state
  const [addProvider, setAddProvider] = useState("anthropic");
  const [addLabel, setAddLabel] = useState("");
  const [addApiKey, setAddApiKey] = useState("");
  const [addPriority, setAddPriority] = useState(100);
  const [addEnabled, setAddEnabled] = useState(true);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit form state
  const [editLabel, setEditLabel] = useState("");
  const [editPriority, setEditPriority] = useState(100);
  const [editEnabled, setEditEnabled] = useState(true);
  const [editReplaceKey, setEditReplaceKey] = useState(false);
  const [editNewKey, setEditNewKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/ai-keys");
    if (res.status === 403) {
      setError("Admins only.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not load AI keys.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setKeys(data.keys ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function addKey() {
    setAdding(true);
    setAddError("");
    const res = await fetch("/api/admin/ai-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: addProvider,
        label: addLabel,
        apiKey: addApiKey,
        priority: addPriority,
        isEnabled: addEnabled,
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error || "Failed to add key.");
      return;
    }
    setShowAdd(false);
    setAddLabel("");
    setAddApiKey("");
    setAddPriority(100);
    setAddEnabled(true);
    await load();
  }

  async function updateKey(id: string) {
    setEditing(true);
    setEditError("");
    const body: any = {
      label: editLabel,
      priority: editPriority,
      is_enabled: editEnabled,
    };
    if (editReplaceKey && editNewKey) {
      body.apiKey = editNewKey;
    }
    const res = await fetch(`/api/admin/ai-keys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditing(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setEditError(data.error || "Failed to update key.");
      return;
    }
    setEditingId(null);
    setEditReplaceKey(false);
    setEditNewKey("");
    await load();
  }

  async function disableKey(id: string) {
    if (!confirm("Disable this key? It will be soft-disabled and can be re-enabled later.")) return;
    const res = await fetch(`/api/admin/ai-keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to disable key.");
      return;
    }
    await load();
  }

  async function testKey(id: string) {
    const res = await fetch(`/api/admin/ai-keys/${id}/test`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Test failed.");
    } else if (data.success) {
      alert(`Test passed in ${data.latencyMs}ms.`);
    } else {
      alert(`Test failed: ${data.error || "Unknown error"}`);
    }
    await load();
  }

  function startEdit(key: AiKey) {
    setEditingId(key.id);
    setEditLabel(key.label);
    setEditPriority(key.priority);
    setEditEnabled(key.is_enabled);
    setEditReplaceKey(false);
    setEditNewKey("");
    setEditError("");
  }

  function statusBadge(status: string) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      working: { bg: "#e6f4ea", color: "#137333", label: "Working" },
      failing: { bg: "#fce8e8", color: "#c5221f", label: "Failing" },
      unknown: { bg: "#f1f3f4", color: "#5f6368", label: "Unknown" },
      disabled: { bg: "#f1f3f4", color: "#5f6368", label: "Disabled" },
    };
    const s = map[status] ?? map.unknown;
    return (
      <span style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        background: s.bg,
        color: s.color,
      }}>
        {s.label}
      </span>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>AI Providers / API Keys</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
          <button className="btn-primary" onClick={() => setShowAdd(true)} disabled={showAdd}>
            Add key
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 12 }}>
        DB-managed AI API keys as backup/fallback providers. Env-based keys (ANTHROPIC_API_KEY, NVIDIA_API_KEY)
        are still used first. Keys are encrypted server-side and never displayed after saving.
      </p>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{error}</p>}

      {showAdd && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, margin: "0 0 12px" }}>Add AI API key</h3>
          <div className="filter-bar" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field-group" style={{ marginBottom: 0, minWidth: 140 }}>
              <label>Provider</label>
              <select value={addProvider} onChange={(e) => setAddProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field-group" style={{ marginBottom: 0, minWidth: 200 }}>
              <label>Label</label>
              <input
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="e.g. Claude primary"
              />
            </div>
            <div className="field-group" style={{ marginBottom: 0, minWidth: 280 }}>
              <label>API Key</label>
              <input
                type="password"
                value={addApiKey}
                onChange={(e) => setAddApiKey(e.target.value)}
                placeholder="sk-... or nvapi-..."
              />
            </div>
            <div className="field-group" style={{ marginBottom: 0, minWidth: 90 }}>
              <label>Priority</label>
              <input
                type="number"
                value={addPriority}
                onChange={(e) => setAddPriority(parseInt(e.target.value) || 100)}
              />
            </div>
            <div className="field-group" style={{ marginBottom: 0, minWidth: 100 }}>
              <label>Enabled</label>
              <select value={addEnabled ? "true" : "false"} onChange={(e) => setAddEnabled(e.target.value === "true")}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "8px 0 0" }}>
            Warning: The full key is only visible while typing. After saving, it is encrypted and cannot be viewed again.
          </p>
          {addError && <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 8 }}>{addError}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="btn-primary" onClick={addKey} disabled={adding || !addLabel || !addApiKey}>
              {adding ? "Saving..." : "Save key"}
            </button>
            <button onClick={() => { setShowAdd(false); setAddError(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty">Loading AI keys...</div>
      ) : keys.length === 0 ? (
        <div className="empty">No DB-managed AI keys yet. Add a key above to enable fallback providers.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Label</th>
              <th>Fingerprint</th>
              <th>Priority</th>
              <th>Enabled</th>
              <th>Status</th>
              <th>Last Tested</th>
              <th>Usage / Failures</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                {editingId === key.id ? (
                  <>
                    <td>
                      <span className="badge">{key.provider}</span>
                    </td>
                    <td>
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={{ width: 140 }} />
                    </td>
                    <td>
                      <div>
                        <span className="muted">{key.key_fingerprint}</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 12, cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={editReplaceKey}
                            onChange={(e) => setEditReplaceKey(e.target.checked)}
                          />
                          Replace key
                        </label>
                        {editReplaceKey && (
                          <input
                            type="password"
                            value={editNewKey}
                            onChange={(e) => setEditNewKey(e.target.value)}
                            placeholder="New API key"
                            style={{ marginTop: 4, width: 180 }}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={editPriority}
                        onChange={(e) => setEditPriority(parseInt(e.target.value) || 100)}
                        style={{ width: 60 }}
                      />
                    </td>
                    <td>
                      <select value={editEnabled ? "true" : "false"} onChange={(e) => setEditEnabled(e.target.value === "true")}>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    </td>
                    <td>{statusBadge(key.status)}</td>
                    <td className="muted">
                      {key.last_tested_at ? new Date(key.last_tested_at).toLocaleString() : "—"}
                    </td>
                    <td className="muted">
                      {key.usage_count} / {key.failure_count}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => updateKey(key.id)} disabled={editing}>
                          {editing ? "Saving..." : "Save"}
                        </button>
                        <button onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                      {editError && <p style={{ color: "var(--danger)", fontSize: 11, margin: "4px 0 0" }}>{editError}</p>}
                    </td>
                  </>
                ) : (
                  <>
                    <td><span className="badge">{key.provider}</span></td>
                    <td>{key.label}</td>
                    <td className="muted">{key.key_fingerprint}</td>
                    <td>{key.priority}</td>
                    <td>{key.is_enabled ? "Yes" : "No"}</td>
                    <td>{statusBadge(key.status)}</td>
                    <td className="muted">
                      {key.last_tested_at ? new Date(key.last_tested_at).toLocaleString() : "—"}
                    </td>
                    <td className="muted">
                      {key.usage_count} / {key.failure_count}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button onClick={() => testKey(key.id)}>Test</button>
                        <button onClick={() => startEdit(key)}>Edit</button>
                        <button className="btn-danger" onClick={() => disableKey(key.id)}>Disable</button>
                      </div>
                      {key.last_error && (
                        <p style={{ color: "var(--danger)", fontSize: 11, margin: "4px 0 0" }}>
                          {key.last_error}
                        </p>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
