import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.TALENTOS_DATABASE_URL || process.env.DATABASE_URL;
const OPENCODE_GO_KEY = process.env.MIX923_OPENCODE_GO_KEY;
const ENCRYPTION_SECRET = process.env.AI_KEYS_ENCRYPTION_SECRET;
const EXPECTED_DB_HOST = process.env.MIX923_EXPECTED_DB_HOST || "40.160.139.188";
const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
const SESSION_ID = "talentos-mix-9.23";
const STATE_NAME = "mix 9.23";

const OPEN_CODE_MODELS = [
  "mimo-v2.6-flash",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "longcat-2.0",
];

const PROTECTED_RESUME_MODELS = {
  application_resume_forge: "gemini-3.1-pro-preview",
  application_hiring_panel: "gemini-3.7-flash",
  application_final_polish: "gemini-3.7-flash",
  application_tailoring: "gemini-2.5-flash-lite",
};

const MODEL_PLAN = {
  application_job_lens: "deepseek-v4-flash",
  job_categorization: "mimo-v2.6-flash",
  falood_ai: "mimo-v2.6-flash",
  job_match_score: "deepseek-v4-flash",
  email_triage: "deepseek-v4-flash",
  email_action_enrichment: "deepseek-v4-flash",
  email_interview_extraction: "deepseek-v4-flash",
  email_reply_draft: "longcat-2.0",
  recruiter_message_gen: "longcat-2.0",
  cover_letter_gen: "longcat-2.0",
  copilot_cover_letter: "longcat-2.0",
  ai_digest: "longcat-2.0",
  job_ceo_enricher: "deepseek-v4-flash",
  job_autofill: "deepseek-v4-flash",
  job_autofill_form: "deepseek-v4-flash",
  job_ai_analyze: "deepseek-v4-flash",
  job_ceo_orchestrator: "deepseek-v4-pro",
  job_ceo_scout: "deepseek-v4-pro",
  job_ceo_qa: "deepseek-v4-pro",
  job_ceo_deep_fetch: "deepseek-v4-pro",
  job_ceo_matchmaker: "deepseek-v4-pro",
  candidate_source_of_truth: "deepseek-v4-pro",
  jd_analysis: "deepseek-v4-pro",
  evidence_mapping: "deepseek-v4-pro",
  target_jobs_matching: "deepseek-v4-pro",
  resume_suggestions: "deepseek-v4-pro",
  BaseResume_TO_JobSearchKeyword: "deepseek-v4-pro",
  base_resume_studio: "deepseek-v4-pro",
  resume_parsing: "deepseek-v4-pro",
  keyword_extraction: "deepseek-v4-pro",
  candidate_markitdown: "deepseek-v4-pro",
  ats_extraction: "deepseek-v4-flash",
  ats_narrative: "deepseek-v4-flash",
  ats_scoring: "deepseek-v4-flash",
  copilot_ceo: "deepseek-v4-pro",
  copilot_fill_planner: "deepseek-v4-pro",
  copilot_form_analyst: "deepseek-v4-flash",
  copilot_compliance: "deepseek-v4-flash",
  copilot_correction_reviewer: "deepseek-v4-flash",
  chat_assistant: "longcat-2.0",
};

function fail(message) {
  throw new Error(message);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function encryptSecret(value, secret) {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const combined = Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  return `enc:${combined.toString("base64")}`;
}

async function assertOpenCodeModel(model) {
  const response = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENCODE_GO_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "TalentOS-AI-Router/1.0",
      "x-opencode-session": `${SESSION_ID}-smoke`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Return only OK." }],
      temperature: 0,
      max_tokens: 8,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`OpenCode smoke failed for ${model}: HTTP ${response.status}`);
  }
}

async function assertVertexHealth(baseUrl, label) {
  const candidates = [
    baseUrl.replace(/\/$/, "") + "/health",
    baseUrl.replace(/\/v1\/?$/, "") + "/health",
  ].filter((url, index, urls) => urls.indexOf(url) === index);
  for (const url of candidates) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) return;
    } catch {
      // Try the alternate gateway URL before failing the preflight.
    }
  }
  throw new Error(`${label} health check failed`);
}

function reasoningFor(model) {
  if (model === "deepseek-v4-pro") return "high";
  if (model === "longcat-2.0") return "medium";
  return "low";
}

function safeKeyMetadata(row) {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    model: row.model,
    status: row.status,
    is_enabled: row.is_enabled,
    is_protected: row.is_protected,
    priority: row.priority,
    created_at: row.created_at,
  };
}

async function main() {
  if (!DATABASE_URL) fail("TALENTOS_DATABASE_URL/DATABASE_URL is missing");
  if (!OPENCODE_GO_KEY) fail("MIX923_OPENCODE_GO_KEY is missing");
  if (!ENCRYPTION_SECRET) fail("AI_KEYS_ENCRYPTION_SECRET is missing");

  for (const model of OPEN_CODE_MODELS) await assertOpenCodeModel(model);

  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const dbIdentity = await client.query(
      "select inet_server_addr()::text as server_addr, current_database() as database_name"
    );
    if (dbIdentity.rows[0]?.server_addr !== EXPECTED_DB_HOST) {
      fail(`Refusing to mutate unexpected database host: ${dbIdentity.rows[0]?.server_addr || "unknown"}`);
    }

    const activeResult = await client.query(`
      select r.active_routing_state_id::text as id, s.name
      from ai_runtime_config r
      left join ai_routing_states s on s.id = r.active_routing_state_id
      where r.singleton = true
    `);
    const activeStateId = activeResult.rows[0]?.id;
    const activeStateName = activeResult.rows[0]?.name;
    if (!activeStateId) fail("No active routing state exists");

    const existingState = await client.query("select id::text, status from ai_routing_states where name = $1", [STATE_NAME]);
    if (existingState.rowCount) fail(`${STATE_NAME} already exists; refusing to overwrite it`);

    const oldKeysResult = await client.query(`
      select id::text, label, provider, model, status, is_enabled, is_protected, priority, created_at
      from ai_api_keys
      where provider = 'opencode'
      order by priority, created_at
    `);
    if (!oldKeysResult.rowCount) fail("No existing OpenCode keys found to snapshot");
    if (oldKeysResult.rows.some((row) => row.is_protected)) fail("A protected OpenCode key exists; refusing to delete it");

    const vertexResult = await client.query(`
      select id::text, label, provider, base_url, is_enabled
      from ai_api_keys
      where provider = 'google_vertex_proxy' and is_enabled = true
    `);
    const vertexA = vertexResult.rows.find((row) =>
      String(row.base_url || "").includes("vertex-gateway-mrrfnbzf2q-uc.a.run.app") ||
      /Skarion CRM Vertex Gateway/i.test(row.label)
    );
    const vertexB = vertexResult.rows.find((row) =>
      String(row.base_url || "").includes("vertex-gateway-b-qsvdzs4b4a-uc.a.run.app") ||
      /Vertex B Gateway/i.test(row.label)
    );
    if (!vertexA || !vertexB || vertexA.id === vertexB.id) fail("Could not identify distinct Vertex A and Vertex B keys");
    await assertVertexHealth(vertexA.base_url, "Vertex A");
    await assertVertexHealth(vertexB.base_url, "Vertex B");

    const activeRoutesResult = await client.query(`
      select automation_id, rank, model_override
      from ai_routing_state_routes
      where state_id = $1
      order by automation_id, rank
    `, [activeStateId]);
    const protectedModels = { ...PROTECTED_RESUME_MODELS };
    for (const id of Object.keys(protectedModels)) {
      const current = activeRoutesResult.rows.find((row) => row.automation_id === id && row.rank === 1);
      if (current?.model_override) protectedModels[id] = current.model_override;
    }

    await client.query("begin");

    const oldLegacyRoutes = await client.query(`
      select automation_id, rank, ai_key_id::text, provider, model_override, is_enabled
      from ai_automation_routes
      order by automation_id, rank
    `);
    const oldStateRoutes = await client.query(`
      select automation_id, rank, ai_key_id::text, provider, model_override, is_enabled
      from ai_routing_state_routes
      where state_id = $1
      order by automation_id, rank
    `, [activeStateId]);
    await client.query(`
      insert into ai_admin_audit_log (actor_email, action, metadata)
      values ($1, $2, $3::jsonb)
    `, [
      "mix923-automation",
      "mix923.snapshot",
      JSON.stringify({
        state_name: STATE_NAME,
        previous_active_state_id: activeStateId,
        previous_active_state_name: activeStateName,
        previous_opencode_keys: oldKeysResult.rows.map(safeKeyMetadata),
        previous_legacy_route_count: oldLegacyRoutes.rowCount,
        previous_active_state_route_count: oldStateRoutes.rowCount,
      }),
    ]);

    const encryptedKey = encryptSecret(OPENCODE_GO_KEY, ENCRYPTION_SECRET);
    const newKeyResult = await client.query(`
      insert into ai_api_keys (
        provider, label, encrypted_key, key_fingerprint, priority, is_enabled, status,
        model, base_url, provider_mode, models_endpoint, chat_endpoint,
        auth_header_name, auth_scheme, custom_headers, available_models,
        default_model, supports_model_discovery, supports_tools, supports_json_mode,
        supports_streaming, is_protected, provider_config, notes
      ) values (
        'opencode', 'OpenCode Go — mix 9.23', $1, $2, 1, true, 'working',
        'mimo-v2.6-flash', $3, 'openai_compatible', '/models', '/chat/completions',
        'Authorization', 'Bearer', '{}'::jsonb, $4::jsonb,
        'mimo-v2.6-flash', true, true, true,
        false, false, $5::jsonb, $6
      ) returning id::text
    `, [
      encryptedKey,
      fingerprint(OPENCODE_GO_KEY),
      OPENCODE_BASE_URL,
      JSON.stringify(OPEN_CODE_MODELS),
      JSON.stringify({ opencode_session_id: SESSION_ID }),
      "mix 9.23 OpenCode Go allocation; Job Lens uses DeepSeek V4 Flash because of observed volume; V4 Pro is reserved for low-volume work.",
    ]);
    const newKeyId = newKeyResult.rows[0].id;

    const stateResult = await client.query(`
      insert into ai_routing_states (name, description, status, created_by)
      values ($1, $2, 'draft', $3)
      returning id::text
    `, [
      STATE_NAME,
      "OpenCode Go mix for non-resume automations; Vertex A primary and Vertex B fallback for the resume pipeline.",
      "mix923-automation",
    ]);
    const stateId = stateResult.rows[0].id;

    const automationsResult = await client.query("select id from ai_automations where is_active = true order by id");
    if (!automationsResult.rowCount) fail("No active automations found");

    for (const { id: automationId } of automationsResult.rows) {
      if (Object.prototype.hasOwnProperty.call(protectedModels, automationId)) {
        const model = protectedModels[automationId];
        await client.query(`
          insert into ai_routing_state_routes
            (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
          values ($1, $2, 1, $3, null, $4, null, true),
                 ($1, $2, 2, $5, null, $4, null, true)
        `, [stateId, automationId, vertexA.id, model, vertexB.id]);
        continue;
      }

      const model = MODEL_PLAN[automationId] || "mimo-v2.6-flash";
      await client.query(`
        insert into ai_routing_state_routes
          (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
        values ($1, $2, 1, $3, null, $4, $5, true),
               ($1, $2, 2, $6, null, 'gemini-2.5-flash-lite', null, true),
               ($1, $2, 3, $7, null, 'gemini-2.5-flash-lite', null, true)
      `, [stateId, automationId, newKeyId, model, reasoningFor(model), vertexB.id, vertexA.id]);
    }

    await client.query(`
      update ai_task_category_config
      set ai_key_id = $1, provider = 'opencode', updated_at = now(), updated_by = $2
      where ai_key_id = any($3::uuid[])
    `, [newKeyId, "mix923-automation", oldKeysResult.rows.map((row) => row.id)]);

    await client.query("delete from ai_automation_routes where automation_id = any($1::text[])", [automationsResult.rows.map((row) => row.id)]);
    await client.query(`
      insert into ai_automation_routes
        (automation_id, rank, ai_key_id, provider, model_override, is_enabled, updated_at, updated_by)
      select automation_id, rank, ai_key_id, provider, model_override, is_enabled, now(), $2
      from ai_routing_state_routes
      where state_id = $1
    `, [stateId, "mix923-automation"]);

    await client.query("update ai_api_keys set label = 'Vertex A', updated_at = now() where id = $1", [vertexA.id]);
    await client.query("update ai_api_keys set label = 'Vertex B', updated_at = now() where id = $1", [vertexB.id]);

    await client.query("update ai_routing_states set status = 'archived', updated_at = now() where id = $1", [activeStateId]);
    await client.query(`
      update ai_routing_states
      set status = 'published', published_at = now(), updated_at = now()
      where id = $1
    `, [stateId]);
    await client.query(`
      update ai_runtime_config
      set active_routing_state_id = $1, updated_by = $2, updated_at = now()
      where singleton = true
    `, [stateId, "mix923-automation"]);

    await client.query(`
      update ai_api_keys
      set last_test_status = 'success', last_tested_at = now(), last_success_at = now(),
          last_error = null, last_error_code = null, last_error_message = null,
          notes = $2, updated_at = now()
      where id = $1
    `, [newKeyId, "mix 9.23 OpenCode Go smoke tests passed for Mimo V2.6 Flash, DeepSeek V4 Flash, DeepSeek V4 Pro, and LongCat 2.0."]);

    await client.query("delete from ai_api_keys where provider = 'opencode' and id <> $1", [newKeyId]);

    const counts = await client.query(`
      select
        (select count(*) from ai_routing_state_routes where state_id = $1) as state_routes,
        (select count(*) from ai_automation_routes) as legacy_routes,
        (select count(*) from ai_api_keys where provider = 'opencode') as opencode_keys
    `, [stateId]);
    await client.query(`
      insert into ai_admin_audit_log (actor_email, action, ai_key_id, metadata)
      values ($1, $2, $3, $4::jsonb)
    `, [
      "mix923-automation",
      "mix923.activated",
      newKeyId,
      JSON.stringify({
        state_name: STATE_NAME,
        state_id: stateId,
        vertex_a_id: vertexA.id,
        vertex_b_id: vertexB.id,
        state_route_count: Number(counts.rows[0].state_routes),
        legacy_route_count: Number(counts.rows[0].legacy_routes),
        remaining_opencode_keys: Number(counts.rows[0].opencode_keys),
        protected_resume_automations: Object.keys(protectedModels),
        job_lens_model: MODEL_PLAN.application_job_lens,
      }),
    ]);

    await client.query("commit");
    console.log(`mix 9.23 activated; state routes=${counts.rows[0].state_routes}; legacy routes=${counts.rows[0].legacy_routes}; OpenCode keys=${counts.rows[0].opencode_keys}`);
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`mix 9.23 activation failed: ${error.message}`);
  process.exitCode = 1;
});
