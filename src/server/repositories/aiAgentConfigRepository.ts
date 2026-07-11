// Data-access abstraction for ai_agent_configs.

import { query, queryOne, execute } from "@/server/db/neon";

export interface AgentConfigRow {
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
  updated_by: string | null;
  updated_at: string;
}

export async function listAgentConfigs(): Promise<AgentConfigRow[]> {
  return query<AgentConfigRow>(
    "SELECT * FROM ai_agent_configs ORDER BY automation_id"
  );
}

export async function findAgentConfigByAutomationId(id: string): Promise<AgentConfigRow | null> {
  return queryOne<AgentConfigRow>(
    "SELECT * FROM ai_agent_configs WHERE automation_id = $1",
    [id]
  );
}

export async function updateAgentConfig(
  automationId: string,
  updates: Partial<AgentConfigRow>,
  userId?: string
): Promise<AgentConfigRow | null> {
  const keys = Object.keys(updates).filter(
    (k) => updates[k as keyof AgentConfigRow] !== undefined && k !== "automation_id"
  );
  if (keys.length === 0) return findAgentConfigByAutomationId(automationId);

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k as keyof AgentConfigRow]);
  values.push(userId ?? null);
  values.push(new Date().toISOString());
  values.push(automationId);

  const rows = await query<AgentConfigRow>(
    `UPDATE ai_agent_configs SET ${setClause}, updated_by = $${keys.length + 1}, updated_at = $${keys.length + 2} WHERE automation_id = $${keys.length + 3} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}
