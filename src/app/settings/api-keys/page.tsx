"use client";

import { useEffect, useState, FormEvent } from "react";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  Shield,
  AlertTriangle,
  Check,
  X,
  Loader2,
} from "lucide-react";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface ApiKeyListResponse {
  keys: ApiKey[];
  available_scopes: string[];
}

interface MeResponse {
  profile: {
    display_name: string;
    email: string | null;
    role: string;
  };
}

export default function ApiKeysPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["jobs:import"]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
    loadKeys();
  }, []);

  async function loadKeys() {
    setLoading(true);
    const res = await fetch("/api/api-keys");
    if (res.ok) {
      const data: ApiKeyListResponse = await res.json();
      setKeys(data.keys);
      setAvailableScopes(data.available_scopes);
    }
    setLoading(false);
  }

  async function createKey(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setNewKey(null);

    const name = newKeyName.trim();
    if (!name) {
      setError("Key name is required.");
      return;
    }

    setCreating(true);
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes: selectedScopes }),
    });
    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to create API key.");
      return;
    }

    const data = await res.json();
    setNewKey(data.key);
    setNewKeyName("");
    setSelectedScopes(["jobs:import"]);
    setSuccess("API key created. Copy it now — you won't see it again.");
    loadKeys();
  }

  async function revokeKey(id: string) {
    if (!confirm("Are you sure you want to revoke this API key? This cannot be undone.")) return;

    setRevokingId(id);
    setError("");
    setSuccess("");
    const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    setRevokingId(null);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to revoke API key.");
      return;
    }

    setSuccess("API key revoked.");
    loadKeys();
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const isAdmin = me?.profile?.role === "admin";

  if (!isAdmin && me) {
    return (
      <div className="page-header">
        <h1>API Keys</h1>
        <div className="card" style={{ marginTop: 16 }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <p className="text-sm text-ink-soft">
              You need admin privileges to manage API keys.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const revokedKeys = keys.filter((k) => k.revoked_at);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>API Keys</h1>
          <p className="page-kicker">Manage integration keys for crawlers, webhooks, and external tools</p>
        </div>
      </div>

      {/* Create new key */}
      <div className="card">
        <h2 className="section-title flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create new key
        </h2>
        <form onSubmit={createKey} className="space-y-4">
          <div className="field-group">
            <label>Name</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. Production Crawler"
              required
            />
          </div>

          <div className="field-group">
            <label>Scopes</label>
            <div className="flex flex-wrap gap-2">
              {availableScopes
                .filter((s) => s.includes("jobs") || s.includes("crawler") || s.includes("api_keys"))
                .map((scope) => (
                  <label
                    key={scope}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors border ${
                      selectedScopes.includes(scope)
                        ? "bg-accent-soft border-accent text-accent"
                        : "bg-surface border-border text-ink-soft hover:border-ink-soft/30"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedScopes.includes(scope)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedScopes((prev) => [...prev, scope]);
                        } else {
                          setSelectedScopes((prev) => prev.filter((s) => s !== scope));
                        }
                      }}
                    />
                    <Shield className="w-3 h-3" />
                    {scope}
                  </label>
                ))}
            </div>
            {selectedScopes.length === 0 && (
              <p className="form-error text-xs mt-1">Select at least one scope.</p>
            )}
          </div>

          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}

          {newKey && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-accent">Your new API key</span>
                <button type="button" onClick={() => setShowNewKey(!showNewKey)} className="text-xs text-ink-soft hover:text-ink">
                  {showNewKey ? <EyeOff className="w-3 h-3 inline" /> : <Eye className="w-3 h-3 inline" />}
                  {showNewKey ? " Hide" : " Show"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-surface border border-border rounded px-2 py-1.5 font-mono truncate">
                  {showNewKey ? newKey : `${newKey.slice(0, 16)}...`}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(newKey)}
                  className="btn flex items-center gap-1 text-xs"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[10px] text-ink-soft">Copy this now. It will not be shown again.</p>
            </div>
          )}

          <button
            className="btn-primary flex items-center gap-2"
            type="submit"
            disabled={creating || selectedScopes.length === 0}
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {creating ? "Creating..." : "Create API key"}
          </button>
        </form>
      </div>

      {/* Active keys */}
      <div>
        <h2 className="section-title flex items-center gap-2">
          <Key className="w-4 h-4" />
          Active keys ({activeKeys.length})
        </h2>
        {loading ? (
          <p className="muted">Loading API keys...</p>
        ) : activeKeys.length === 0 ? (
          <div className="empty" style={{ padding: "22px 12px" }}>
            No active API keys. Create one above to get started.
          </div>
        ) : (
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Last used</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {activeKeys.map((key) => (
                  <tr key={key.id}>
                    <td className="font-medium text-ink">{key.name}</td>
                    <td>
                      <code className="text-xs font-mono bg-surface border border-border rounded px-1.5 py-0.5">
                        {key.key_prefix}
                      </code>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span key={scope} className="badge badge-waiting text-[10px]">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="muted">
                      {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "Never"}
                    </td>
                    <td className="muted">{new Date(key.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn-danger btn-compact flex items-center gap-1"
                        onClick={() => revokeKey(key.id)}
                        disabled={revokingId === key.id}
                      >
                        {revokingId === key.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3" />
                        )}
                        {revokingId === key.id ? "Revoking..." : "Revoke"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div>
          <h2 className="section-title flex items-center gap-2 text-ink-soft">
            <X className="w-4 h-4" />
            Revoked keys ({revokedKeys.length})
          </h2>
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Scopes</th>
                  <th>Revoked</th>
                </tr>
              </thead>
              <tbody>
                {revokedKeys.map((key) => (
                  <tr key={key.id} className="opacity-50">
                    <td className="font-medium text-ink">{key.name}</td>
                    <td>
                      <code className="text-xs font-mono bg-surface border border-border rounded px-1.5 py-0.5">
                        {key.key_prefix}
                      </code>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span key={scope} className="badge text-[10px]">
                            {scope}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="muted">
                      {key.revoked_at ? new Date(key.revoked_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
