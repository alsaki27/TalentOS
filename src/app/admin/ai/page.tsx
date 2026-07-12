"use client";

import { useEffect, useState, useCallback } from "react";
import { PROVIDER_LABELS, PROVIDER_NATIVE_DEFAULTS, PROVIDER_MODEL_PRESETS } from "@/lib/ai/providerPresets";

// ── Types ──

interface KeyItem {
  id: string;
  provider: string;
  label: string;
  key_fingerprint: string;
  model: string | null;
  base_url: string | null;
  priority: number;
  is_enabled: boolean;
  status: string;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_latency_ms: number | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  usage_count: number;
  failure_count: number;
  today_calls: number;
  today_tokens: number;
  today_cost: number;
  success_rate: number | null;
  avg_latency: number | null;
  assignment_count: number;
  fallback_count: number;
  daily_request_warning: number | null;
  daily_request_limit: number | null;
  monthly_request_limit: number | null;
  monthly_budget_warning_usd: number | null;
  monthly_budget_limit_usd: number | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  supports_tools: boolean;
  supports_json_mode: boolean;
  supports_streaming: boolean;
}

interface AgentItem {
  id: string;
  label: string;
  description: string;
  group_label: string;
  is_active: boolean;
  route_version: number;
  config_status: string;
  routes: RouteItem[];
  config: AgentConfig | null;
  today_calls: number;
  today_success_rate: number | null;
  today_cost: number;
  avg_latency: number | null;
  last_call_at: string | null;
  last_error: string | null;
}

interface RouteItem {
  id: string;
  automation_id: string;
  ai_key_id: string | null;
  provider: string | null;
  rank: number;
  is_enabled: boolean;
  model_override: string | null;
  key_label: string | null;
  key_provider: string | null;
  key_model: string | null;
  key_fingerprint: string | null;
  key_status: string | null;
}

interface AgentConfig {
  automation_id: string;
  display_name: string;
  system_prompt: string | null;
  prompt_version: string | null;
  output_schema_version: string | null;
  temperature: number | null;
  max_output_tokens: number | null;
  timeout_ms: number | null;
  max_attempts: number | null;
  approval_policy: string;
  minimum_score: number | null;
  is_active: boolean;
}

interface OverviewData {
  summary: {
    totalKeys: number; activeKeys: number; healthyKeys: number; keysWithErrors: number;
    totalAgents: number; configuredAgents: number; unroutedAgents: number;
    callsToday: number; tokensToday: number; costToday: number; successRate: number;
    fallbackActivations: number; avgLatency: number;
  };
  readiness: {
    encryptionConfigured: boolean; allKeysEncrypted: boolean;
    criticalAgentsRouted: boolean; usageTrackingOperational: boolean;
  };
  alerts: Array<{ type: string; severity: string; message: string; resourceType: string; resourceId: string }>;
  securityWarnings: Array<{ type: string; keyId?: string; keyLabel?: string; agentCount?: number; count?: number; message: string }>;
  trafficByProvider: Array<{ provider: string; calls: number; cost: number }>;
  recentIncidents: Array<{ timestamp: string; keyId: string; keyLabel: string; event: string }>;
}

interface UsageEvent {
  id: string;
  automation_id: string;
  automation_label?: string;
  ai_key_id: string;
  key_label?: string;
  provider: string;
  model: string | null;
  outcome: string;
  route_rank: number | null;
  attempt_number: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  error_code: string | null;
  error_message: string | null;
  workflow_id: string | null;
  application_id: string | null;
  triggered_by_user_id: string | null;
  created_at: string;
}

interface UsageMetrics {
  totalCalls: number; successCalls: number; failedCalls: number; timeouts: number;
  fallbackActivations: number; totalInputTokens: number; totalOutputTokens: number;
  totalCost: number; avgLatency: number; p95Latency: number; successRate: number;
}

const TAB_NAMES = ["Overview", "API Keys", "Agents & Routing", "Usage & Logs"] as const;
type Tab = typeof TAB_NAMES[number];

const STATUS_BADGE: Record<string, string> = {
  working: "badge-success",
  healthy: "badge-success",
  untested: "badge-warning",
  unknown: "badge-warning",
  degraded: "badge-warning",
  rate_limited: "badge-warning",
  quota_exhausted: "badge-danger",
  invalid: "badge-danger",
  invalid_credential: "badge-danger",
  provider_unavailable: "badge-danger",
  disabled: "badge-muted",
  failing: "badge-danger",
};

// PROVIDER_LABELS imported from @/lib/ai/providerPresets above
// PROVIDER_MODEL_PRESETS imported from @/lib/ai/providerPresets above
// PROVIDER_NATIVE_DEFAULTS imported from @/lib/ai/providerPresets above

const PIPELINE_AGENT_IDS = new Set([
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
]);

function statusBadge(status: string): string {
  return STATUS_BADGE[status] || "badge-info";
}

function formatCost(cost: number | null | undefined): string {
  if (cost == null || isNaN(cost)) return "—";
  return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString();
}

function formatPercent(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function relativeTime(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Main Page ──

export default function AiControlCenterPage() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [globalError, setGlobalError] = useState("");

  useEffect(() => {
    setGlobalError("");
  }, [tab]);

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>AI Control Center</h1>
          <div className="page-kicker" style={{ marginTop: 4 }}>
            Manage API keys, agent routing, usage, and health from one workspace.
          </div>
        </div>
      </div>

      {globalError && (
        <div className="alert alert-error" style={{ marginBottom: 16 }}>
          {globalError}
          <button className="alert-close" onClick={() => setGlobalError("")}>×</button>
        </div>
      )}

      <div className="stats-strip" style={{ marginBottom: 24 }}>
        {TAB_NAMES.map(t => (
          <button key={t} className={`stat-button ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}>
            <span className="stat-label">{t}</span>
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab onError={setGlobalError} />}
      {tab === "API Keys" && <ApiKeysTab onError={setGlobalError} />}
      {tab === "Agents & Routing" && <AgentsTab onError={setGlobalError} />}
      {tab === "Usage & Logs" && <UsageTab onError={setGlobalError} />}
    </div>
  );
}

// ── Overview Tab ──

function OverviewTab({ onError }: { onError: (e: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai/overview");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e: any) { onError(e.message); }
    finally { setLoading(false); }
  }

  if (loading) return <div className="loading-panel" style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
  if (!data) return <div className="empty-state">No data available</div>;

  const s = data.summary;
  const cards = [
    { label: "Total Keys", value: s.totalKeys },
    { label: "Active Keys", value: s.activeKeys },
    { label: "Healthy Keys", value: s.healthyKeys },
    { label: "Keys With Errors", value: s.keysWithErrors, warn: s.keysWithErrors > 0 },
    { label: "Configured Agents", value: s.configuredAgents },
    { label: "Unrouted Agents", value: s.unroutedAgents, warn: s.unroutedAgents > 0 },
    { label: "Calls Today", value: formatNumber(s.callsToday) },
    { label: "Tokens Today", value: formatNumber(s.tokensToday) },
    { label: "Cost Today", value: formatCost(s.costToday) },
    { label: "Success Rate", value: formatPercent(s.successRate) },
    { label: "Fallback Activations", value: s.fallbackActivations, warn: s.fallbackActivations > 10 },
    { label: "Avg Latency", value: s.avgLatency ? `${s.avgLatency}ms` : "—" },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        {cards.map(c => (
          <div key={c.label} className="stat-button" style={{ padding: 16, textAlign: "left", cursor: "default", borderLeft: c.warn ? "3px solid var(--danger, #e74c3c)" : undefined }}>
            <div className="stat-label" style={{ fontSize: 12, marginBottom: 4 }}>{c.label}</div>
            <div className="stat-value" style={{ fontSize: 24, fontWeight: 600 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "var(--surface-1)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Readiness</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ReadinessRow label="Encryption configured" ok={data.readiness.encryptionConfigured} />
            <ReadinessRow label="All keys encrypted" ok={data.readiness.allKeysEncrypted} />
            <ReadinessRow label="Critical agents routed" ok={data.readiness.criticalAgentsRouted} />
            <ReadinessRow label="Usage tracking active" ok={data.readiness.usageTrackingOperational} />
          </div>
        </div>

        <div style={{ background: "var(--surface-1)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Traffic by Provider</h3>
          {data.trafficByProvider.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>No traffic today</div>
          ) : (
            <table className="table table-compact" style={{ width: "100%" }}>
              <thead><tr><th>Provider</th><th>Calls</th><th>Cost</th></tr></thead>
              <tbody>
                {data.trafficByProvider.map(p => (
                  <tr key={p.provider}>
                    <td>{PROVIDER_LABELS[p.provider] || p.provider}</td>
                    <td>{formatNumber(p.calls)}</td>
                    <td>{formatCost(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {data.securityWarnings.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Security</h3>
          {data.securityWarnings.map((w, i) => (
            <div key={i}
              className={`alert ${w.type === "broken_key_in_use" ? "alert-error" : "alert-warning"}`}
              style={{ marginBottom: 8 }}>
              <span className={`badge ${w.type === "broken_key_in_use" ? "badge-danger" : "badge-warning"}`} style={{ marginRight: 8 }}>
                {w.type === "broken_key_in_use" ? "critical" : "warning"}
              </span>
              {w.message}
              {(w.type === "stale_key" || w.type === "broken_key_in_use") && w.keyId && (
                <span className="text-muted" style={{ marginLeft: 8, fontSize: 11 }}>
                  (key: {w.keyLabel ?? w.keyId.slice(0, 8)})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {data.alerts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3>Alerts</h3>
          {data.alerts.map((a, i) => (
            <div key={i} className={`alert alert-${a.severity === "critical" ? "error" : a.severity === "warning" ? "warning" : "info"}`}
              style={{ marginBottom: 8 }}>
              <span className={`badge ${statusBadge(a.severity)}`} style={{ marginRight: 8 }}>{a.severity}</span>
              {a.message}
            </div>
          ))}
        </div>
      )}

      <div>
        <h3>Recent Incidents</h3>
        {data.recentIncidents.length === 0 ? (
          <div className="text-muted" style={{ fontSize: 13 }}>No recent incidents</div>
        ) : (
          <table className="table table-compact" style={{ width: "100%" }}>
            <thead><tr><th>Time</th><th>Key</th><th>Event</th></tr></thead>
            <tbody>
              {data.recentIncidents.map((inc, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{relativeTime(inc.timestamp)}</td>
                  <td>{inc.keyLabel || inc.keyId?.slice(0, 8)}</td>
                  <td style={{ fontSize: 13 }}>{inc.event}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ReadinessRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className={`badge ${ok ? "badge-success" : "badge-danger"}`} style={{ fontSize: 12 }}>
        {ok ? "✓" : "✗"}
      </span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

// ── API Keys Tab ──

function ApiKeysTab({ onError }: { onError: (e: string) => void }) {
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [keyAssignments, setKeyAssignments] = useState<Record<string, any>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, any>>({});

  useEffect(() => { loadKeys(); }, []);

  async function loadKeys() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai/keys");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch (e: any) { onError(e.message); }
    finally { setLoading(false); }
  }

  async function testKey(id: string) {
    setTestingKey(id);
    try {
      const res = await fetch(`/api/admin/ai/keys/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResults(p => ({ ...p, [id]: data }));
    } catch (e: any) { onError(e.message); }
    finally { setTestingKey(null); loadKeys(); }
  }

  async function toggleKey(id: string, enabled: boolean) {
    await fetch(`/api/admin/ai/keys/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_enabled: !enabled }),
    });
    loadKeys();
  }

  async function deleteKey(id: string) {
    if (!confirm("Permanently delete this key?")) return;
    const res = await fetch(`/api/admin/ai/keys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Cannot delete key");
      return;
    }
    loadKeys();
  }

  async function loadAssignments(id: string) {
    if (keyAssignments[id]) { setExpandedKey(expandedKey === id ? null : id); return; }
    setExpandedKey(id);
    try {
      const res = await fetch(`/api/admin/ai/keys/${id}/assignments`);
      if (res.ok) {
        const data = await res.json();
        setKeyAssignments(p => ({ ...p, [id]: data }));
      }
    } catch {}
  }

  const filtered = keys.filter(k => {
    if (search && !k.label.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter && k.status !== statusFilter) return false;
    if (providerFilter && k.provider !== providerFilter) return false;
    return true;
  });

  if (loading) return <div className="loading-panel" style={{ padding: 40, textAlign: "center" }}>Loading keys...</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div className="filter-group" style={{ display: "flex", gap: 8 }}>
          <input className="input" placeholder="Search keys..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="working">Healthy</option>
            <option value="unknown">Untested</option>
            <option value="failing">Failing</option>
            <option value="disabled">Disabled</option>
          </select>
          <select className="input" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}>
            <option value="">All providers</option>
            {Object.entries(PROVIDER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Add API Key</button>
      </div>

      {showAdd && <AddKeyForm onDone={() => { setShowAdd(false); loadKeys(); }} onError={onError} />}

      {filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 40, textAlign: "center" }}>
          {keys.length === 0 ? "No API keys configured yet. Add your first key to get started." : "No keys match your filters."}
        </div>
      ) : (
        <div className="table-shell">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Key</th>
                <th>Provider</th>
                <th>Model</th>
                <th>Fingerprint</th>
                <th>Status</th>
                <th>Health</th>
                <th>Today</th>
                <th>Success</th>
                <th>Assignments</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(k => (
                <tr key={k.id}>
                  <td className="cell-main">
                    <div style={{ fontWeight: 500 }}>{k.label}</div>
                    {k.notes && <div className="text-muted" style={{ fontSize: 11 }}>{k.notes.slice(0, 60)}</div>}
                  </td>
                  <td><span className="badge badge-info">{PROVIDER_LABELS[k.provider] || k.provider}</span></td>
                  <td style={{ fontSize: 12 }}>{k.model || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{k.key_fingerprint?.slice(0, 8) || "—"}</td>
                  <td>
                    <span className={`badge ${k.is_enabled ? "badge-success" : "badge-muted"}`}>
                      {k.is_enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${statusBadge(k.status)}`}>
                      {k.status === "working" ? "Healthy" : k.status === "unknown" ? "Untested" : k.status.replace("_", " ")}
                    </span>
                    {k.last_tested_at && <div className="text-muted" style={{ fontSize: 10 }}>Tested {relativeTime(k.last_tested_at)}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div>{formatNumber(k.today_calls)} calls</div>
                    <div className="text-muted">{formatCost(k.today_cost)}</div>
                  </td>
                  <td>
                    <span className={`badge ${(k.success_rate ?? 0) >= 95 ? "badge-success" : (k.success_rate ?? 0) >= 80 ? "badge-warning" : "badge-danger"}`}>
                      {formatPercent(k.success_rate)}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <button className="btn-link" style={{ padding: 0, fontSize: 12 }} onClick={() => loadAssignments(k.id)}>
                      {k.assignment_count} primary / {k.fallback_count} fallback
                    </button>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn-compact btn-sm" onClick={() => testKey(k.id)} disabled={testingKey === k.id}>
                        {testingKey === k.id ? "⟳" : "Test"}
                      </button>
                      <button className="btn-compact btn-sm" onClick={() => toggleKey(k.id, k.is_enabled)}>
                        {k.is_enabled ? "Disable" : "Enable"}
                      </button>
                      <button className="btn-compact btn-sm btn-danger" onClick={() => deleteKey(k.id)}>Delete</button>
                    </div>
                    {testResults[k.id] && (
                      <div className={`alert ${testResults[k.id].success ? "alert-success" : "alert-error"}`} style={{ marginTop: 4, fontSize: 11, padding: "4px 8px" }}>
                        {testResults[k.id].success ? `OK (${testResults[k.id].latencyMs}ms)` : testResults[k.id].error || "Failed"}
                      </div>
                    )}
                    {expandedKey === k.id && keyAssignments[k.id] && (
                      <div style={{ marginTop: 8, padding: 8, background: "var(--surface-2)", borderRadius: 6, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Agents Using This Key</div>
                        {(keyAssignments[k.id].primaryFor || []).map((a: any) => (
                          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span>{a.label}</span>
                            <span className="badge badge-info">Primary</span>
                          </div>
                        ))}
                        {(keyAssignments[k.id].fallbackFor || []).map((a: any) => (
                          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                            <span>{a.label}</span>
                            <span className="badge badge-warning">Fallback</span>
                          </div>
                        ))}
                        {(!keyAssignments[k.id].primaryFor?.length && !keyAssignments[k.id].fallbackFor?.length) && (
                          <div className="text-muted">Not assigned to any agents</div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddKeyForm({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const [provider, setProvider] = useState("anthropic");
  const [providerMode, setProviderMode] = useState("native");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [chatEndpoint, setChatEndpoint] = useState("/chat/completions");
  const [modelsEndpoint, setModelsEndpoint] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("Authorization");
  const [authScheme, setAuthScheme] = useState<"Bearer" | "raw">("Bearer");
  const [notes, setNotes] = useState("");
  const [dailyLimit, setDailyLimit] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [supportsModelDiscovery, setSupportsModelDiscovery] = useState(false);
  const [supportsTools, setSupportsTools] = useState(true);
  const [supportsJsonMode, setSupportsJsonMode] = useState(true);
  const [supportsStreaming, setSupportsStreaming] = useState(false);

  const presetModels = (PROVIDER_MODEL_PRESETS[provider] || []).filter(
    (m) => !modelSearch || m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.label.toLowerCase().includes(modelSearch.toLowerCase())
  );

  const opencodeWarning = provider === "opencode" && providerMode !== "native" && !baseUrl.trim();

  function handleProviderChange(p: string) {
    setProvider(p);
    setModel("");
    setModelSearch("");
    setModelDropdownOpen(false);
    setCustomModelInput("");
  }

  function handleProviderModeChange(mode: string) {
    setProviderMode(mode);
    if (mode !== "native") {
      const defs = PROVIDER_NATIVE_DEFAULTS[provider];
      if (defs) {
        if (!baseUrl) setBaseUrl(defs.baseUrl);
        if (!chatEndpoint || chatEndpoint === "/chat/completions") setChatEndpoint(defs.chatEndpoint);
        if (!authHeaderName || authHeaderName === "Authorization") setAuthHeaderName(defs.authHeaderName);
        if (!authScheme || authScheme === "Bearer") setAuthScheme(defs.authScheme);
        if (!modelsEndpoint && defs.modelsEndpoint) setModelsEndpoint(defs.modelsEndpoint);
      } else {
        if (!baseUrl) setBaseUrl("");
        if (providerMode === "openai_compatible" && !chatEndpoint) setChatEndpoint("/chat/completions");
      }
    }
  }

  function selectModel(m: string) {
    setModel(m);
    setModelSearch("");
    setModelDropdownOpen(false);
    setCustomModelInput("");
  }

  async function submit() {
    if (!label.trim()) { setError("Name is required"); return; }
    if (!apiKey.trim()) { setError("API key is required"); return; }
    if (opencodeWarning) { setError("OpenCode requires a verified external API base URL"); return; }
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/admin/ai/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          provider_mode: providerMode !== "native" ? providerMode : undefined,
          label: label.trim(),
          apiKey: apiKey.trim(),
          model: model || null,
          default_model: model || null,
          base_url: providerMode !== "native" && baseUrl.trim() ? baseUrl.trim() : null,
          chat_endpoint: providerMode !== "native" && chatEndpoint.trim() ? chatEndpoint.trim() : null,
          models_endpoint: providerMode !== "native" && modelsEndpoint.trim() ? modelsEndpoint.trim() : null,
          auth_header_name: providerMode !== "native" && authHeaderName.trim() ? authHeaderName.trim() : null,
          auth_scheme: providerMode !== "native" ? authScheme : null,
          notes: notes || null,
          daily_request_limit: dailyLimit ? parseInt(dailyLimit) : null,
          monthly_budget_limit_usd: monthlyBudget ? parseFloat(monthlyBudget) : null,
          isEnabled: true,
          supports_model_discovery: supportsModelDiscovery,
          supports_tools: supportsTools,
          supports_json_mode: supportsJsonMode,
          supports_streaming: supportsStreaming,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to add key");
      }
      onDone();
    } catch (e: any) { setError(e.message); }
    finally { setAdding(false); }
  }

  return (
    <div style={{ background: "var(--surface-1)", borderRadius: 8, padding: 20, marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Add API Key</h3>
      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {opencodeWarning && (
        <div className="alert alert-warning" style={{ marginBottom: 12, fontSize: 13 }}>
          OpenCode Go is primarily documented for use inside OpenCode. To use it as a TalentOS backend, provide a verified external API base URL.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field-group">
          <label>Provider</label>
          <select className="input" value={provider} onChange={e => handleProviderChange(e.target.value)}>
            {Object.entries(PROVIDER_LABELS).filter(([k]) => k !== "openai_compatible").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label>Provider Mode</label>
          <select className="input" value={providerMode} onChange={e => handleProviderModeChange(e.target.value)}>
            <option value="native">Native</option>
            <option value="openai_compatible">OpenAI Compatible</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="field-group">
          <label>Friendly Name</label>
          <input className="input" placeholder="e.g. Production OpenAI" value={label} onChange={e => setLabel(e.target.value)} />
        </div>
        <div className="field-group">
          <label>API Key</label>
          <input className="input" type="password" placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} />
        </div>
        <div className="field-group" style={{ position: "relative" }}>
          <label>Default Model</label>
          <div style={{ position: "relative" }}>
            <input
              className="input"
              placeholder="Search or type model name..."
              value={modelDropdownOpen ? modelSearch : model || ""}
              onFocus={() => { setModelDropdownOpen(true); setModelSearch(""); }}
              onChange={e => {
                setModelSearch(e.target.value);
                setModelDropdownOpen(true);
                setCustomModelInput("");
              }}
              onBlur={() => setTimeout(() => setModelDropdownOpen(false), 200)}
            />
            {modelDropdownOpen && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                background: "var(--surface-1)", border: "1px solid var(--border-color, #ccc)",
                borderRadius: 6, maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              }}>
                {presetModels.map(m => (
                  <div
                    key={m.id}
                    onMouseDown={() => selectModel(m.id)}
                    style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--border-light, #eee)" }}
                  >
                    <span style={{ fontFamily: "monospace", fontSize: 12 }}>{m.id}</span>
                    <span className="text-muted" style={{ marginLeft: 8, fontSize: 11 }}>{m.label}</span>
                  </div>
                ))}
                <div
                  onMouseDown={() => {
                    setModelDropdownOpen(false);
                    setCustomModelInput(model || modelSearch || "");
                  }}
                  style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, color: "var(--primary, #3b82f6)", fontWeight: 500 }}
                >
                  + Custom model
                </div>
              </div>
            )}
          </div>
          {customModelInput !== null && customModelInput !== "" && !modelDropdownOpen && (
            <div style={{ marginTop: 4 }}>
              <input
                className="input"
                placeholder="Type any model string..."
                value={customModelInput}
                onChange={e => setCustomModelInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") selectModel(customModelInput); }}
              />
              <button className="btn-compact btn-sm" style={{ marginTop: 4 }} onClick={() => selectModel(customModelInput)}>Use "{customModelInput}"</button>
            </div>
          )}
          {model && !modelDropdownOpen && customModelInput === "" && !presetModels.some(p => p.id === model) && (
            <div style={{ marginTop: 2, fontSize: 11 }}>
              <span className="badge badge-warning">Custom: {model}</span>
            </div>
          )}
        </div>
      </div>

      {providerMode !== "native" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div className="field-group">
            <label>Base URL</label>
            <input className="input" placeholder="e.g. https://api.custom.com/v1" value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)} />
          </div>
          <div className="field-group">
            <label>Chat Endpoint</label>
            <input className="input" placeholder="/chat/completions" value={chatEndpoint}
              onChange={e => setChatEndpoint(e.target.value)} />
          </div>
          <div className="field-group">
            <label>Models Endpoint (optional)</label>
            <input className="input" placeholder="/models" value={modelsEndpoint}
              onChange={e => setModelsEndpoint(e.target.value)} />
          </div>
          <div className="field-group">
            <label>Auth Header Name</label>
            <input className="input" placeholder="Authorization" value={authHeaderName}
              onChange={e => setAuthHeaderName(e.target.value)} />
          </div>
          <div className="field-group">
            <label>Auth Scheme</label>
            <select className="input" value={authScheme} onChange={e => setAuthScheme(e.target.value as "Bearer" | "raw")}>
              <option value="Bearer">Bearer</option>
              <option value="raw">Raw</option>
            </select>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div className="field-group">
          <label>Notes</label>
          <input className="input" placeholder="Optional description" value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Daily Request Limit (optional)</label>
          <input className="input" type="number" placeholder="e.g. 10000" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)} />
        </div>
        <div className="field-group">
          <label>Monthly Budget USD (optional)</label>
          <input className="input" type="number" step="0.01" placeholder="e.g. 100" value={monthlyBudget} onChange={e => setMonthlyBudget(e.target.value)} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={{ fontWeight: 600, display: "block", marginBottom: 8 }}>Capabilities</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={supportsModelDiscovery} onChange={e => setSupportsModelDiscovery(e.target.checked)} />
            Model Discovery
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={supportsTools} onChange={e => setSupportsTools(e.target.checked)} />
            Tool Calling
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={supportsJsonMode} onChange={e => setSupportsJsonMode(e.target.checked)} />
            JSON Mode
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={supportsStreaming} onChange={e => setSupportsStreaming(e.target.checked)} />
            Streaming
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn-primary" onClick={submit} disabled={adding}>{adding ? "Saving & Testing..." : "Save & Test Key"}</button>
        <button className="btn-outline" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function RouteModelCombobox({ keyId, discovered, presets, value, isCustom, onChange }: {
  keyId: string;
  discovered: any[];
  presets: any[];
  value: string;
  isCustom: boolean;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allModels = [
    ...discovered.map((m: any) => ({ ...m, source: "provider" as const })),
    ...presets.map((m: any) => ({ ...m, source: "preset" as const })),
  ];

  const filtered = allModels.filter((m: any) =>
    !search || m.id.toLowerCase().includes(search.toLowerCase()) || (m.label && m.label.toLowerCase().includes(search.toLowerCase()))
  );

  const displayVal = open ? search : (value || "");

  function selectModel(m: { id: string; source: string }) {
    onChange(m.id);
    setOpen(false);
    setSearch("");
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        className="input"
        placeholder="Search or type model..."
        value={displayVal}
        onFocus={() => { setOpen(true); setSearch(""); }}
        onChange={e => {
          setSearch(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        style={{ width: "100%" }}
      />
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "var(--surface-1)", border: "1px solid var(--border-color, #ccc)",
          borderRadius: 6, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
          {filtered.length === 0 ? (
            <div
              onMouseDown={() => { onChange(search || value); setOpen(false); setSearch(""); }}
              style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, color: "var(--primary, #3b82f6)", fontWeight: 500 }}
            >
              Use custom: "{search || value}"
            </div>
          ) : (
            filtered.map((m: any) => (
              <div
                key={m.id}
                onMouseDown={() => selectModel(m)}
                style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--border-light, #eee)", display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>{m.id}</span>
                <span className={`badge ${m.source === "provider" ? "badge-success" : "badge-info"}`} style={{ fontSize: 10 }}>
                  {m.source === "provider" ? "Discovered" : "Preset"}
                </span>
              </div>
            ))
          )}
          <div
            onMouseDown={() => { onChange(search || ""); setOpen(false); setSearch(""); }}
            style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, color: "var(--primary, #3b82f6)", fontWeight: 500 }}
          >
            + Custom model
          </div>
        </div>
      )}
      {value && !open && (
        <div style={{ marginTop: 2, fontSize: 11 }}>
          {isCustom ? (
            <span className="badge badge-warning">Custom: {value}</span>
          ) : discovered.some((d: any) => d.id === value) ? (
            <span className="badge badge-success">Discovered</span>
          ) : presets.some((p: any) => p.id === value) ? (
            <span className="badge badge-info">Preset</span>
          ) : (
            <span className="badge badge-warning">Custom: {value}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Agents & Routing Tab ──

function AgentsTab({ onError }: { onError: (e: string) => void }) {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editRoutes, setEditRoutes] = useState<{ keyId: string; modelOverride: string; rank: number }[]>([]);
  const [editRouteVersion, setEditRouteVersion] = useState<number>(0);
  const [editConfig, setEditConfig] = useState<Partial<AgentConfig>>({});
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [keyModelsMap, setKeyModelsMap] = useState<Record<string, { models: any[]; default_model: string | null }>>({});

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [agentsRes, keysRes] = await Promise.all([
        fetch("/api/admin/ai/agents"),
        fetch("/api/admin/ai/keys"),
      ]);
      if (agentsRes.ok) setAgents((await agentsRes.json()).agents ?? []);
      if (keysRes.ok) setKeys((await keysRes.json()).keys ?? []);
    } catch (e: any) { onError(e.message); }
    finally { setLoading(false); }
  }

  async function fetchKeyModels(keyId: string) {
    if (!keyId || keyModelsMap[keyId]) return;
    try {
      const res = await fetch(`/api/admin/ai/keys/${keyId}/models`);
      if (res.ok) {
        const data = await res.json();
        setKeyModelsMap(prev => ({ ...prev, [keyId]: data }));
      }
    } catch {}
  }

  const enabledKeys = keys.filter(k => k.is_enabled);
  const groups = [...new Set(agents.map(a => a.group_label))].sort();
  const filtered = agents.filter(a => {
    if (search && !a.label.toLowerCase().includes(search.toLowerCase()) && !a.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (groupFilter && a.group_label !== groupFilter) return false;
    return true;
  });

  function startEdit(agent: AgentItem) {
    setEditingAgent(agent.id);
    setEditRoutes(agent.routes.map(r => ({ keyId: r.ai_key_id || "", modelOverride: r.model_override || "", rank: r.rank })));
    setEditRouteVersion(agent.route_version ?? 0);
    setEditConfig(agent.config || { is_active: agent.is_active } as any);
    setMessage(null);
  }

  async function saveRoutes(agentId: string) {
    setSaving(true);
    try {
      const routes = editRoutes
        .filter(r => r.keyId)
        .map((r, i) => ({ ai_key_id: r.keyId, model_override: r.modelOverride || null, rank: i + 1 }));
      const res = await fetch(`/api/admin/ai/agents/${agentId}/routes`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes, routeVersion: editRouteVersion }),
      });
      if (res.status === 409) {
        const d = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: d.error || "Another admin modified these routes. Please refresh and try again." });
        setEditRouteVersion(d.currentRouteVersion ?? 0);
        loadAll();
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save routes");
      }
      const data = await res.json();
      setEditRouteVersion(data.routeVersion ?? 0);
      setMessage({ type: "success", text: "Routes saved" });
      loadAll();
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setSaving(false); }
  }

  async function saveConfig(agentId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/ai/agents/${agentId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editConfig),
      });
      if (!res.ok) throw new Error("Failed to save config");
      setMessage({ type: "success", text: "Configuration saved" });
      loadAll();
    } catch (e: any) { setMessage({ type: "error", text: e.message }); }
    finally { setSaving(false); }
  }

  function addRouteRow() { setEditRoutes(p => [...p, { keyId: "", modelOverride: "", rank: p.length }]); }
  function removeRouteRow(idx: number) { setEditRoutes(p => p.filter((_, i) => i !== idx)); }

  if (loading) return <div className="loading-panel" style={{ padding: 40, textAlign: "center" }}>Loading agents...</div>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input className="input" placeholder="Search agents..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: 250 }} />
        <select className="input" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
          <option value="">All groups</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      {message && (
        <div className={`alert ${message.type === "error" ? "alert-error" : "alert-success"}`} style={{ marginBottom: 12 }}>
          {message.text} <button className="alert-close" onClick={() => setMessage(null)}>×</button>
        </div>
      )}

      <div className="table-shell">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Group</th>
              <th>Status</th>
              <th>Primary Key</th>
              <th>Fallback 1</th>
              <th>Today</th>
              <th>Success</th>
              <th>Last Call</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => {
              const primary = a.routes.find(r => r.rank === 0 && r.is_enabled);
              const fallback1 = a.routes.find(r => r.rank === 1 && r.is_enabled);
              return (
                <tr key={a.id}>
                  <td className="cell-main">
                    <div style={{ fontWeight: 500 }}>{a.label}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{a.description}</div>
                  </td>
                  <td style={{ fontSize: 12 }}>{a.group_label}</td>
                  <td>
                    <span className={`badge ${a.config_status === "ready" ? "badge-success" : a.config_status === "no_route" ? "badge-warning" : a.config_status === "disabled" ? "badge-muted" : "badge-danger"}`}>
                      {a.config_status.replace("_", " ")}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {primary?.key_label ? (
                      <div>
                        <div>{primary.key_label}</div>
                        <div className="text-muted">{primary.key_provider} {primary.key_model && `· ${primary.key_model}`}</div>
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {fallback1?.key_label ? (
                      <div>
                        <div>{fallback1.key_label}</div>
                        <div className="text-muted">{fallback1.key_provider}</div>
                      </div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div>{formatNumber(a.today_calls)} calls</div>
                    <div className="text-muted">{formatCost(a.today_cost)}</div>
                  </td>
                  <td><span className={`badge ${(a.today_success_rate ?? 0) >= 95 ? "badge-success" : "badge-warning"}`}>{formatPercent(a.today_success_rate)}</span></td>
                  <td style={{ fontSize: 12 }}>{relativeTime(a.last_call_at)}</td>
                  <td>
                    <button className="btn-compact btn-sm" onClick={() => startEdit(a)}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingAgent && (
        <div className="modal-overlay" onClick={() => setEditingAgent(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 700, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
            <h2>{agents.find(a => a.id === editingAgent)?.label || "Agent"} Configuration</h2>

              <div style={{ marginBottom: 20 }}>
                <h4>Routes</h4>
                {editRoutes.map((r, i) => {
                  const routeModelInfo = r.keyId ? keyModelsMap[r.keyId] : null;
                  const routeDiscovered = routeModelInfo?.models?.filter((m: any) => m.source === "provider") || [];
                  const routePresets = routeModelInfo?.models?.filter((m: any) => m.source === "preset") || [];
                  const isRouteModelCustom = !!(r.modelOverride && routeModelInfo &&
                    !routeModelInfo.models.some((m: any) => m.id === r.modelOverride));
                  const selectedKey = r.keyId ? enabledKeys.find(k => k.id === r.keyId) : null;
                  const capabilityWarnings: string[] = [];
                  if (editingAgent && PIPELINE_AGENT_IDS.has(editingAgent) && selectedKey) {
                    if (selectedKey.supports_tools === false) {
                      capabilityWarnings.push("Key does not support tool calling — this agent requires tools.");
                    }
                    if (selectedKey.supports_json_mode === false) {
                      capabilityWarnings.push("Key does not support structured output (JSON mode) — this agent may fail.");
                    }
                  }

                  return (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap" }}>
                    <span className="badge badge-info" style={{ minWidth: 60, textAlign: "center", marginTop: 6 }}>Rank {i}</span>
                    <select className="input" style={{ flex: 1, minWidth: 180 }} value={r.keyId} onChange={e => {
                      const keyId = e.target.value;
                      const updated = [...editRoutes];
                      updated[i].keyId = keyId;
                      setEditRoutes(updated);
                      if (keyId) fetchKeyModels(keyId);
                    }}>
                      <option value="">— Select key —</option>
                      {enabledKeys.map(k => (
                        <option key={k.id} value={k.id}>{k.label} ({PROVIDER_LABELS[k.provider] || k.provider})</option>
                      ))}
                    </select>
                    <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
                      {routeModelInfo ? (
                        <RouteModelCombobox
                          keyId={r.keyId}
                          discovered={routeDiscovered}
                          presets={routePresets}
                          value={r.modelOverride}
                          isCustom={isRouteModelCustom}
                          onChange={(val) => {
                            const updated = [...editRoutes];
                            updated[i].modelOverride = val;
                            setEditRoutes(updated);
                          }}
                        />
                      ) : (
                        <input className="input" placeholder="Model override (optional)" value={r.modelOverride}
                          onChange={e => {
                            const updated = [...editRoutes];
                            updated[i].modelOverride = e.target.value;
                            setEditRoutes(updated);
                          }} />
                      )}
                    </div>
                    <button className="btn-compact btn-danger btn-sm" onClick={() => removeRouteRow(i)} style={{ marginTop: 6 }}>×</button>
                    {capabilityWarnings.length > 0 && (
                      <div style={{ flexBasis: "100%", marginTop: 4 }}>
                        {capabilityWarnings.map((w, j) => (
                          <div key={j} className="alert alert-warning" style={{ fontSize: 12, padding: "4px 8px", marginBottom: 2 }}>
                            {w}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
                })}
                <button className="btn-compact btn-sm" onClick={addRouteRow}>+ Add Route</button>
                <div style={{ marginTop: 12 }}>
                  <button className="btn-primary btn-sm" onClick={() => saveRoutes(editingAgent)} disabled={saving}>
                    {saving ? "Saving..." : "Save Routes"}
                  </button>
                </div>
              </div>

            <hr />

            <div>
              <h4>Behavior Settings</h4>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field-group">
                  <label>Display Name</label>
                  <input className="input" value={editConfig.display_name || ""} onChange={e => setEditConfig(p => ({ ...p, display_name: e.target.value }))} />
                </div>
                <div className="field-group">
                  <label>Prompt Version</label>
                  <input className="input" value={editConfig.prompt_version || ""} onChange={e => setEditConfig(p => ({ ...p, prompt_version: e.target.value }))} />
                </div>
                <div className="field-group">
                  <label>Temperature</label>
                  <input className="input" type="number" step="0.05" min="0" max="2" value={editConfig.temperature ?? 0.2}
                    onChange={e => setEditConfig(p => ({ ...p, temperature: parseFloat(e.target.value) }))} />
                </div>
                <div className="field-group">
                  <label>Max Output Tokens</label>
                  <input className="input" type="number" value={editConfig.max_output_tokens ?? 2048}
                    onChange={e => setEditConfig(p => ({ ...p, max_output_tokens: parseInt(e.target.value) }))} />
                </div>
                <div className="field-group">
                  <label>Timeout (ms)</label>
                  <input className="input" type="number" value={editConfig.timeout_ms ?? 30000}
                    onChange={e => setEditConfig(p => ({ ...p, timeout_ms: parseInt(e.target.value) }))} />
                </div>
                <div className="field-group">
                  <label>Max Attempts</label>
                  <input className="input" type="number" min="1" max="10" value={editConfig.max_attempts ?? 2}
                    onChange={e => setEditConfig(p => ({ ...p, max_attempts: parseInt(e.target.value) }))} />
                </div>
                <div className="field-group">
                  <label>Approval Policy</label>
                  <select className="input" value={editConfig.approval_policy || "auto"}
                    onChange={e => setEditConfig(p => ({ ...p, approval_policy: e.target.value }))}>
                    <option value="auto">Auto</option>
                    <option value="risk_based">Risk Based</option>
                    <option value="always_human">Always Human</option>
                  </select>
                </div>
                <div className="field-group">
                  <label>Minimum Score (0-10)</label>
                  <input className="input" type="number" step="0.5" min="0" max="10" value={editConfig.minimum_score ?? 0}
                    onChange={e => setEditConfig(p => ({ ...p, minimum_score: parseFloat(e.target.value) }))} />
                </div>
              </div>
              <div className="field-group" style={{ marginTop: 12 }}>
                <label>System Prompt</label>
                <textarea className="input" rows={4} value={editConfig.system_prompt || ""}
                  onChange={e => setEditConfig(p => ({ ...p, system_prompt: e.target.value }))} />
              </div>
              <div className="field-group" style={{ marginTop: 12 }}>
                <label>
                  <input type="checkbox" checked={editConfig.is_active !== false} onChange={e => setEditConfig(p => ({ ...p, is_active: e.target.checked }))} />
                  {" "}Agent Enabled
                </label>
              </div>
              <button className="btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => saveConfig(editingAgent)} disabled={saving}>
                {saving ? "Saving..." : "Save Configuration"}
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn-outline" onClick={() => setEditingAgent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Usage & Logs Tab ──

function UsageTab({ onError }: { onError: (e: string) => void }) {
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [automationFilter, setAutomationFilter] = useState("");
  const [keyFilter, setKeyFilter] = useState("");
  const [fallbackOnly, setFallbackOnly] = useState(false);
  const [keys, setKeys] = useState<{ id: string; label: string }[]>([]);
  const pageSize = 50;

  useEffect(() => { load(); }, [page, outcomeFilter, automationFilter, keyFilter, fallbackOnly]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (outcomeFilter) params.set("outcome", outcomeFilter);
      if (automationFilter) params.set("automationId", automationFilter);
      if (keyFilter) params.set("aiKeyId", keyFilter);
      if (fallbackOnly) params.set("fallbackOnly", "true");

      const res = await fetch(`/api/admin/ai/usage?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEvents(data.events ?? []);
      setMetrics(data.metrics ?? null);
      setTotal(data.total ?? 0);

      if (keys.length === 0) {
        const keysRes = await fetch("/api/admin/ai/keys");
        if (keysRes.ok) setKeys((await keysRes.json()).keys ?? []);
      }
    } catch (e: any) { onError(e.message); }
    finally { setLoading(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {metrics && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
          {[
            { label: "Total Calls", value: formatNumber(metrics.totalCalls) },
            { label: "Success Rate", value: formatPercent(metrics.successRate) },
            { label: "Failed", value: formatNumber(metrics.failedCalls) },
            { label: "Timeouts", value: formatNumber(metrics.timeouts) },
            { label: "Fallback Events", value: formatNumber(metrics.fallbackActivations) },
            { label: "Total Tokens", value: formatNumber(metrics.totalInputTokens + metrics.totalOutputTokens) },
            { label: "Estimated Cost", value: formatCost(metrics.totalCost) },
            { label: "Avg Latency", value: metrics.avgLatency ? `${metrics.avgLatency}ms` : "—" },
            { label: "P95 Latency", value: metrics.p95Latency ? `${metrics.p95Latency}ms` : "—" },
            { label: "Cost/Success", value: metrics.successCalls > 0 ? formatCost(metrics.totalCost / metrics.successCalls) : "—" },
          ].map(m => (
            <div key={m.label} className="stat-button" style={{ padding: 12, cursor: "default" }}>
              <div className="stat-label" style={{ fontSize: 11 }}>{m.label}</div>
              <div className="stat-value" style={{ fontSize: 20, fontWeight: 600 }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select className="input" value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setPage(1); }}>
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="timeout">Timeout</option>
        </select>
        <select className="input" value={keyFilter} onChange={e => { setKeyFilter(e.target.value); setPage(1); }}>
          <option value="">All keys</option>
          {keys.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <input type="checkbox" checked={fallbackOnly} onChange={e => { setFallbackOnly(e.target.checked); setPage(1); }} />
          Fallback only
        </label>
      </div>

      {loading ? (
        <div className="loading-panel" style={{ padding: 40, textAlign: "center" }}>Loading events...</div>
      ) : events.length === 0 ? (
        <div className="empty-state" style={{ padding: 40, textAlign: "center" }}>No usage events found</div>
      ) : (
        <>
          <div className="table-shell">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Agent</th>
                  <th>Key</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Outcome</th>
                  <th>Route</th>
                  <th>Latency</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize: 11 }}>{new Date(e.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                    <td style={{ fontSize: 12 }}>{e.automation_label || e.automation_id?.replace(/_/g, " ")}</td>
                    <td style={{ fontSize: 12 }}>{e.key_label || e.ai_key_id?.slice(0, 8) || "—"}</td>
                    <td style={{ fontSize: 12 }}>{PROVIDER_LABELS[e.provider] || e.provider}</td>
                    <td style={{ fontSize: 11 }}>{e.model || "—"}</td>
                    <td>
                      <span className={`badge ${e.outcome === "success" ? "badge-success" : e.outcome === "failure" ? "badge-danger" : "badge-warning"}`}>
                        {e.outcome}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {e.attempt_number && e.attempt_number > 1 ? (
                        <span className="badge badge-warning" title="Fallback used">F#{e.attempt_number}</span>
                      ) : e.route_rank != null ? (
                        <span className="badge badge-info">R{e.route_rank}</span>
                      ) : "—"}
                    </td>
                    <td style={{ fontSize: 12 }}>{e.latency_ms ? `${e.latency_ms}ms` : "—"}</td>
                    <td style={{ fontSize: 11 }}>
                      {e.input_tokens || e.output_tokens ? `${formatNumber((e.input_tokens || 0) + (e.output_tokens || 0))}` : "—"}
                    </td>
                    <td style={{ fontSize: 12, fontFamily: "monospace" }}>{formatCost(e.estimated_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: 4, padding: "16px 0" }}>
            <button className="btn-compact" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
            <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>{total} total / page {page} of {totalPages}</span>
            <button className="btn-compact" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
          </div>
        </>
      )}
    </div>
  );
}
