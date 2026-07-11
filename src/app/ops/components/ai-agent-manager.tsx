// Admin Agent Manager UI — shows one card per agent with editable config,
// key binding, test button, and usage/status info.

"use client";

import { useEffect, useState, useCallback } from "react";

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

interface AutomationRoute {
  id: string;
  automation_id: string;
  ai_key_id: string | null;
  provider: string | null;
  rank: number;
  is_enabled: boolean;
  key_label?: string;
  key_provider?: string;
}

interface AutomationGroup {
  [groupLabel: string]: {
    id: string;
    label: string;
    description: string;
    routes: AutomationRoute[];
  }[];
}

export default function AiAgentManager() {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [automations, setAutomations] = useState<AutomationGroup>({});
  const [keys, setKeys] = useState<any[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [cfgRes, autoRes, keyRes] = await Promise.all([
        fetch("/api/admin/ai-agent-configs"),
        fetch("/api/admin/ai-automations"),
        fetch("/api/admin/ai-keys"),
      ]);
      if (cfgRes.ok) {
        const d = await cfgRes.json();
        setConfigs(d.configs ?? []);
      }
      if (autoRes.ok) {
        const d = await autoRes.json();
        setAutomations(d.groups ?? {});
      }
      if (keyRes.ok) {
        const d = await keyRes.json();
        setKeys(d.keys ?? []);
      }
    } catch (err: any) {
      console.error("Failed to load agent data:", err);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateConfig = async (automationId: string, field: string, value: any) => {
    setSaving(automationId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-agent-configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automation_id: automationId, [field]: value }),
      });
      if (res.ok) {
        const d = await res.json();
        setConfigs((prev) => prev.map((c) => c.automation_id === automationId ? d.config : c));
        setMessage({ type: "success", text: "Saved" });
      } else {
        const d = await res.json();
        setMessage({ type: "error", text: d.error ?? "Save failed" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(null);
    }
  };

  const configMap = new Map(configs.map((c) => [c.automation_id, c]));

  const agentCards = Object.entries(automations).flatMap(([group, items]) =>
    items.filter((item) => configMap.has(item.id)).map((item) => ({
      ...item,
      groupLabel: group,
      config: configMap.get(item.id)!,
    }))
  );

  return (
    <div className="card">
      <div className="card-header">
        <h3>AI Agent Manager</h3>
        <span className="badge badge-info">{agentCards.length} agents</span>
      </div>
      {message && (
        <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`}>
          {message.text}
        </div>
      )}
      <div className="table-container" style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Temperature</th>
              <th>Max Tokens</th>
              <th>Timeout (ms)</th>
              <th>Max Attempts</th>
              <th>Approval Policy</th>
              <th>Min Score</th>
              <th>Routes</th>
            </tr>
          </thead>
          <tbody>
            {agentCards.map((card) => (
              <tr key={card.id}>
                <td>
                  <strong>{card.config.display_name}</strong>
                  <br />
                  <small className="text-muted">{card.id}</small>
                </td>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={card.config.is_active}
                      onChange={(e) => updateConfig(card.id, "is_active", e.target.checked)}
                      disabled={saving === card.id}
                    />
                    <span className="switch-slider" />
                  </label>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="2"
                    value={card.config.temperature ?? 0.2}
                    onChange={(e) => updateConfig(card.id, "temperature", parseFloat(e.target.value))}
                    className="input"
                    style={{ width: 70 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="128"
                    min="128"
                    max="16384"
                    value={card.config.max_output_tokens ?? 2048}
                    onChange={(e) => updateConfig(card.id, "max_output_tokens", parseInt(e.target.value, 10))}
                    className="input"
                    style={{ width: 80 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="5000"
                    min="5000"
                    max="300000"
                    value={card.config.timeout_ms ?? 30000}
                    onChange={(e) => updateConfig(card.id, "timeout_ms", parseInt(e.target.value, 10))}
                    className="input"
                    style={{ width: 80 }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={card.config.max_attempts ?? 2}
                    onChange={(e) => updateConfig(card.id, "max_attempts", parseInt(e.target.value, 10))}
                    className="input"
                    style={{ width: 60 }}
                  />
                </td>
                <td>
                  <select
                    value={card.config.approval_policy}
                    onChange={(e) => updateConfig(card.id, "approval_policy", e.target.value)}
                    className="input"
                  >
                    <option value="auto">Auto</option>
                    <option value="risk_based">Risk-based</option>
                    <option value="always_human">Always Human</option>
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="10"
                    value={card.config.minimum_score ?? 0}
                    onChange={(e) => updateConfig(card.id, "minimum_score", parseFloat(e.target.value))}
                    className="input"
                    style={{ width: 60 }}
                  />
                </td>
                <td>
                  {card.routes.length > 0 ? (
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "0.85em" }}>
                      {card.routes
                        .filter((r) => r.is_enabled)
                        .sort((a, b) => a.rank - b.rank)
                        .map((r) => (
                          <li key={r.id}>
                            #{r.rank}{" "}
                            {r.key_label
                              ? `${r.key_label} (${r.key_provider ?? r.provider})`
                              : r.provider ?? "global chain"}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <span className="text-muted">Global chain</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-footer">
        <small className="text-muted">
          Configure agent routing in AI Automation Routing. Keys are managed in AI Key Manager.
        </small>
      </div>
    </div>
  );
}
