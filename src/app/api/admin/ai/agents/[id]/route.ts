import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const auto = await queryOne<any>(
    `SELECT id, label, description, group_label, is_active,
            created_at AT TIME ZONE 'UTC' as created_at
     FROM ai_automations WHERE id = $1`,
    [params.id]
  );

  if (!auto) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  const routes = await query<any>(
    `SELECT ar.*, ak.label as key_label, ak.provider as key_provider,
            ak.model as key_model, ak.key_fingerprint, ak.status as key_status
     FROM ai_automation_routes ar
     LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
     WHERE ar.automation_id = $1
     ORDER BY ar.rank`,
    [params.id]
  );

  const config = await queryOne<any>(
    "SELECT * FROM ai_agent_configs WHERE automation_id = $1",
    [params.id]
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = await queryOne<any>(
    `SELECT
       COUNT(*)::int as calls,
       ROUND(COUNT(*) FILTER (WHERE outcome = 'success') * 100.0 / NULLIF(COUNT(*), 0), 1) as success_rate,
       COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
       COALESCE(AVG(latency_ms)::int, 0) as avg_latency
     FROM ai_usage_events
     WHERE automation_id = $1
       AND created_at >= $2::date
       AND created_at < $2::date + interval '1 day'`,
    [params.id, today]
  );

  const lastCall = await queryOne<any>(
    "SELECT created_at FROM ai_usage_events WHERE automation_id = $1 ORDER BY created_at DESC LIMIT 1",
    [params.id]
  );

  let configStatus: string;
  const hasActiveRoutes = routes.some((r: any) => r.is_enabled);
  const hasConfig = config !== null && config.is_active;
  const primaryHealthy = routes.length > 0 && routes[0].is_enabled;

  if (!hasActiveRoutes) configStatus = "no_route";
  else if (!hasConfig) configStatus = "no_config";
  else if (!primaryHealthy) configStatus = "primary_unhealthy";
  else if (!auto.is_active) configStatus = "disabled";
  else configStatus = "ready";

  return NextResponse.json({
    ...auto,
    routes,
    config,
    today_usage: todayUsage ?? { calls: 0, success_rate: 0, total_cost: 0, avg_latency: 0 },
    config_status: configStatus,
    last_call_at: lastCall?.created_at ?? null,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const auto = await queryOne<any>(
    "SELECT id, label FROM ai_automations WHERE id = $1",
    [params.id]
  );
  if (!auto) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validApprovalPolicies = ["auto", "risk_based", "always_human"];

  const display_name = typeof body.display_name === "string" ? body.display_name.trim() : undefined;
  const system_prompt = typeof body.system_prompt === "string" ? body.system_prompt : undefined;
  const prompt_version = body.prompt_version != null ? String(body.prompt_version) : undefined;
  const output_schema_version = body.output_schema_version != null ? String(body.output_schema_version) : undefined;

  let temperature: number | undefined;
  if (body.temperature !== undefined) {
    const t = Number(body.temperature);
    if (isNaN(t) || t < 0 || t > 2) {
      return NextResponse.json({ error: "temperature must be between 0 and 2" }, { status: 400 });
    }
    temperature = t;
  }

  let max_output_tokens: number | undefined;
  if (body.max_output_tokens !== undefined) {
    const m = Number(body.max_output_tokens);
    if (isNaN(m) || m < 1) {
      return NextResponse.json({ error: "max_output_tokens must be a positive integer" }, { status: 400 });
    }
    max_output_tokens = m;
  }

  let timeout_ms: number | undefined;
  if (body.timeout_ms !== undefined) {
    const t = Number(body.timeout_ms);
    if (isNaN(t) || t < 1000) {
      return NextResponse.json({ error: "timeout_ms must be at least 1000" }, { status: 400 });
    }
    timeout_ms = t;
  }

  let max_attempts: number | undefined;
  if (body.max_attempts !== undefined) {
    const m = Number(body.max_attempts);
    if (isNaN(m) || m < 1) {
      return NextResponse.json({ error: "max_attempts must be at least 1" }, { status: 400 });
    }
    max_attempts = m;
  }

  let approval_policy: string | undefined;
  if (body.approval_policy !== undefined) {
    if (!validApprovalPolicies.includes(body.approval_policy)) {
      return NextResponse.json(
        { error: `approval_policy must be one of: ${validApprovalPolicies.join(", ")}` },
        { status: 400 }
      );
    }
    approval_policy = body.approval_policy;
  }

  let minimum_score: number | undefined;
  if (body.minimum_score !== undefined) {
    const s = Number(body.minimum_score);
    if (isNaN(s) || s < 0 || s > 1) {
      return NextResponse.json({ error: "minimum_score must be between 0 and 1" }, { status: 400 });
    }
    minimum_score = s;
  }

  let is_active: boolean | undefined;
  if (body.is_active !== undefined) {
    is_active = Boolean(body.is_active);
  }

  const userId = context?.profile.user_id;

  const existing = await queryOne<any>(
    "SELECT automation_id FROM ai_agent_configs WHERE automation_id = $1",
    [params.id]
  );

  if (existing) {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (display_name !== undefined) { fields.push(`display_name = $${idx++}`); values.push(display_name); }
    if (system_prompt !== undefined) { fields.push(`system_prompt = $${idx++}`); values.push(system_prompt); }
    if (prompt_version !== undefined) { fields.push(`prompt_version = $${idx++}`); values.push(prompt_version); }
    if (output_schema_version !== undefined) { fields.push(`output_schema_version = $${idx++}`); values.push(output_schema_version); }
    if (temperature !== undefined) { fields.push(`temperature = $${idx++}`); values.push(temperature); }
    if (max_output_tokens !== undefined) { fields.push(`max_output_tokens = $${idx++}`); values.push(max_output_tokens); }
    if (timeout_ms !== undefined) { fields.push(`timeout_ms = $${idx++}`); values.push(timeout_ms); }
    if (max_attempts !== undefined) { fields.push(`max_attempts = $${idx++}`); values.push(max_attempts); }
    if (approval_policy !== undefined) { fields.push(`approval_policy = $${idx++}`); values.push(approval_policy); }
    if (minimum_score !== undefined) { fields.push(`minimum_score = $${idx++}`); values.push(minimum_score); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); values.push(is_active); }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    fields.push(`updated_by = $${idx++}`);
    values.push(userId);
    fields.push(`updated_at = NOW()`);

    values.push(params.id);

    await execute(
      `UPDATE ai_agent_configs SET ${fields.join(", ")} WHERE automation_id = $${idx}`,
      values
    );
  } else {
    const cols = ["automation_id", "updated_by", "updated_at"];
    const placeholders = ["$1", "$2", "NOW()"];
    const vals: any[] = [params.id, userId];
    let pIdx = 3;

    const addField = (col: string, val: any) => {
      cols.push(col);
      placeholders.push(`$${pIdx++}`);
      vals.push(val);
    };

    if (display_name !== undefined) addField("display_name", display_name);
    else addField("display_name", auto.label || params.id); // NOT NULL constraint — fall back to automation label
    if (system_prompt !== undefined) addField("system_prompt", system_prompt);
    if (prompt_version !== undefined) addField("prompt_version", prompt_version);
    if (output_schema_version !== undefined) addField("output_schema_version", output_schema_version);
    if (temperature !== undefined) addField("temperature", temperature);
    if (max_output_tokens !== undefined) addField("max_output_tokens", max_output_tokens);
    if (timeout_ms !== undefined) addField("timeout_ms", timeout_ms);
    if (max_attempts !== undefined) addField("max_attempts", max_attempts);
    if (approval_policy !== undefined) addField("approval_policy", approval_policy);
    if (minimum_score !== undefined) addField("minimum_score", minimum_score);
    if (is_active !== undefined) addField("is_active", is_active);

    await execute(
      `INSERT INTO ai_agent_configs (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
      vals
    );
  }

  const updated = await queryOne<any>(
    "SELECT * FROM ai_agent_configs WHERE automation_id = $1",
    [params.id]
  );

  return NextResponse.json({ config: updated });
}
