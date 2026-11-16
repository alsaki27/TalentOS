import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recoverResumeWorkflows, manualResumeTransition } from "@/server/repositories/resumeWorkflowRecoveryRepository";
import { commitStageResult } from "@/server/repositories/applicationAiWorkflowRepository";
import { withResumeModelCheckpoint } from "@/server/repositories/resumeModelCheckpointRepository";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";

const holder = vi.hoisted(() => ({
  db: null as null | {
    query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; affectedRows: number }>;
    exec: (sql: string) => Promise<unknown>;
    close: () => Promise<void>;
  },
}));

const beforeMigrationSettings = {
  recoveryMode: "report" as const, staleHeartbeatSeconds: 300, recoveryLimit: 2, recoveryBatch: 5, recoveryDelaySeconds: 1,
  evidenceEnabled: false, cooldownLimit: 8, cooldownDelaySeconds: 900, forgeInputChars: 8000, resumeMaxPages: 2,
};

vi.mock("@/server/db/neon", () => ({
  query: async (text: string, args?: unknown[]) => (await holder.db!.query(text, args)).rows,
  queryOne: async (text: string, args?: unknown[]) => (await holder.db!.query(text, args)).rows[0] ?? null,
  execute: async (text: string, args?: unknown[]) => ({ rowCount: (await holder.db!.query(text, args)).affectedRows }),
  sql: () => Object.assign(
    async (pieces: TemplateStringsArray, ...args: unknown[]) =>
      (await holder.db!.query(pieces.reduce((text, piece, i) => i ? text + "$" + i + piece : piece, ""), args)).rows,
    { transaction: async (queries: Promise<unknown>[]) => Promise.all(queries) },
  ),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));

const fixture = `
  CREATE TABLE ai_runtime_config (singleton boolean primary key);
  CREATE TABLE ai_automations (id text primary key,label text,description text,group_label text,is_active boolean);
  CREATE TABLE ai_api_keys (id uuid primary key, provider text, is_enabled boolean, key_fingerprint text, model text, default_model text);
  CREATE TABLE ai_automation_routes (automation_id text, rank int, ai_key_id uuid, provider text, model_override text, is_enabled boolean, primary key (automation_id,rank));
  CREATE TABLE ai_agent_configs (automation_id text primary key,display_name text,prompt_version text,max_output_tokens int,timeout_ms int,max_attempts int);
  CREATE TABLE applications (id uuid primary key,ai_workflow_id uuid, tailored_resume_version_id uuid, applied_at timestamptz,
    candidate_id uuid, job_id uuid, resume_generation_completed_at timestamptz,
    ae_stage_updated_at timestamptz,ae_stage_updated_by_name text, application_stage_changed_at timestamptz,
    application_stage_changed_by_name text,resume_generation_status text,resume_generation_error text,application_stage text,ae_stage text);
  CREATE TABLE application_ai_workflows (id uuid primary key,application_id uuid,status text,current_stage int,
    created_at timestamptz default now(),updated_at timestamptz default now(),config_snapshot jsonb default '{}',base_resume_id uuid,completed_at timestamptz,
    claim_expires_at timestamptz,heartbeat_at timestamptz,claimed_at timestamptz,claimed_by text,next_retry_at timestamptz,cancelled_at timestamptz,
    recovery_count int default 0,stage_retry_count int default 0,cooldown_retry_count int default 0,lock_version int default 1,last_error text);
  CREATE TABLE application_ai_artifacts (id uuid primary key default gen_random_uuid(),workflow_id uuid,automation_id text,
    sequence_number int,schema_version text,content_hash text,data jsonb,created_at timestamptz default now());
  CREATE TABLE application_ai_stage_runs (id uuid primary key default gen_random_uuid(),workflow_id uuid,automation_id text,sequence_number int,
    attempt_number int default 1,status text,provider text,model text,ai_key_id uuid,prompt_version text,input_tokens int,output_tokens int,
    estimated_cost_usd numeric,latency_ms int,output_artifact_id uuid,error_code text,error_message text,completed_at timestamptz);
  CREATE TABLE application_resume_versions (id uuid primary key default gen_random_uuid(),workflow_id uuid,application_id uuid,status text,
    content jsonb,formatting jsonb,generated_text text, candidate_id uuid, target_job_id uuid, job_id uuid, base_resume_id uuid,
    title text, source_type text, ats_score double precision, truth_score double precision, recruiter_score double precision,
    role_fit_score double precision, one_page_fit_score numeric, page_fit_metrics jsonb, updated_by_user_id uuid,
    updated_source text, created_at timestamptz, updated_at timestamptz);
  CREATE UNIQUE INDEX ai_resume_once ON application_resume_versions(workflow_id) WHERE source_type='ai_agent';
  CREATE TABLE target_jobs (id uuid primary key, candidate_id uuid, job_id uuid, created_at timestamptz default now());
  CREATE TABLE jobs (id uuid primary key,title text);
  CREATE TABLE application_stage_history (application_id uuid, from_stage text,to_stage text,changed_by_name text,reason text,source text);
  CREATE TABLE application_packets (application_id uuid primary key,base_resume_id uuid,target_job_id uuid,final_resume_version_id uuid,created_by uuid);
  CREATE TABLE application_resume_exports (id uuid primary key,application_id uuid,resume_version_id uuid,status text,export_type text,content_sha256 text);
`;

describe.skipIf(!process.env.RESUME_PIPELINE_PGLITE_PATH)("resume recovery SQL in PostgreSQL", () => {
  beforeAll(async () => {
    const { PGlite } = createRequire(import.meta.url)(process.env.RESUME_PIPELINE_PGLITE_PATH!);
    holder.db = new PGlite();
    await holder.db!.exec(fixture);
  });
  afterAll(async () => { await holder.db?.close(); });

  it("can rerun or cancel an existing workflow before the migration is applied", async () => {
    const db = holder.db!;
    const app = crypto.randomUUID(), workflow = crypto.randomUUID();
    await db.query("INSERT INTO applications (id,ai_workflow_id) VALUES ($1,$2)", [app, workflow]);
    await db.query("INSERT INTO application_ai_workflows (id,application_id,status,current_stage) VALUES ($1,$2,'failed',1)", [workflow, app]);
    const output = (await db.query(`INSERT INTO application_ai_artifacts (workflow_id, automation_id)
      VALUES ($1,'application_resume_forge') RETURNING id`, [workflow])).rows[0].id;
    await db.query(`INSERT INTO application_ai_stage_runs (workflow_id, automation_id, sequence_number, status, output_artifact_id)
      VALUES ($1,'application_resume_forge',1,'success',$2)`, [workflow, output]);
    const action = { id: workflow, staleHeartbeatSeconds: 300 };
    expect(await manualResumeTransition({ ...action, action: "rerun", stage: 0 })).toEqual({ status: "queued", current_stage: 0 });
    const result = await db.query(`SELECT config_snapshot->'resumeReplayThrough' AS replay FROM application_ai_workflows WHERE id=$1`, [workflow]);
    expect(result.rows[0].replay).toEqual({ "1": 1 });
    expect(await manualResumeTransition({ ...action, action: "rerun", stage: 1 })).toBeNull();
    expect(await manualResumeTransition({ ...action, action: "cancel", stage: null })).toEqual({ status: "cancelled", current_stage: 0 });
    expect(await recoverResumeWorkflows(beforeMigrationSettings)).toEqual([]);
  });

  it("installs the additive migration twice without errors", async () => {
    const migration = readFileSync("sql/neon_fixes/143_resume_pipeline_evidence_and_recovery.sql", "utf8");
    await holder.db!.exec(migration);
    await holder.db!.exec(migration);
  });

  it("repairs a contradictory waiting row once, preserves a healthy claim and fences a stale writer", async () => {
    const db = holder.db!;
    const app = crypto.randomUUID(), waiting = crypto.randomUUID();
    const activeApp = crypto.randomUUID(), active = crypto.randomUUID();
    await db.query("INSERT INTO applications (id,ai_workflow_id) VALUES ($1,$2),($3,$4)", [app, waiting, activeApp, active]);
    await db.query(`INSERT INTO application_ai_workflows (id,application_id,status,current_stage,claim_expires_at,heartbeat_at,claimed_at)
      VALUES ($1,$2,'waiting',1,NULL,NULL,NULL),($3,$4,'running',0,now()+interval '12 minutes',now(),now())`,
    [waiting, app, active, activeApp]);
    const stage = (await db.query(`INSERT INTO application_ai_stage_runs (workflow_id,automation_id,sequence_number,status)
      VALUES ($1,'application_resume_forge',1,'running') RETURNING id`, [waiting])).rows[0].id;
    const settings = {
      recoveryMode: "report" as const, staleHeartbeatSeconds: 300, recoveryLimit: 2, recoveryBatch: 5, recoveryDelaySeconds: 1,
      evidenceEnabled: false, cooldownLimit: 8, cooldownDelaySeconds: 900, forgeInputChars: 8000, resumeMaxPages: 2,
    };
    const action = { stage: 2, action: "rerun" as const, staleHeartbeatSeconds: 300 };
    expect(await manualResumeTransition({ id: waiting, ...action })).toBeNull();
    expect(await manualResumeTransition({ ...action, id: active, stage: 0 })).toBeNull();
    expect(await recoverResumeWorkflows(settings)).toEqual([{ id: waiting, reason: "missing_artifact", first_missing: 0 }]);
    const results = await Promise.all([recoverResumeWorkflows({ ...settings, recoveryMode: "enabled" }), recoverResumeWorkflows({ ...settings, recoveryMode: "enabled" })]);
    expect(results.flat()).toHaveLength(1);
    expect((await db.query("SELECT status, current_stage, lock_version FROM application_ai_workflows WHERE id=$1", [waiting])).rows[0]).toEqual({status:"queued",current_stage:0,lock_version:2});
    expect((await db.query("SELECT status,error_code FROM application_ai_stage_runs WHERE id=$1", [stage])).rows[0]).toEqual({status:"failed",error_code:"missing_artifact"});
    const late = await commitStageResult({workflowId: waiting, lockVersion: 1, stageRunId: stage, sequence: 1,
      output:{ automationId: "application_resume_forge", schemaVersion: "v2", digest: "digest", data: {} },
      provider:"openai",model:"test-model",keyId:null,promptVersion:null,inputTokens:0,outputTokens:0,cost:0,latencyMs:0});
    expect(late).toEqual([]);
  });

  it("reuses a completed model result across identical runs and fences unknown outcomes", async () => {
    const db = holder.db!, wid = crypto.randomUUID(), other = crypto.randomUUID();
    await db.query("INSERT INTO application_ai_workflows (id,application_id,status,current_stage) VALUES ($1,$1,'queued',0),($2,$2,'queued',0)", [wid, other]);
    const task = { system: "test", body: "small", schema: {} };
    const complete = vi.fn(async () => ({ prioritize: ["s1"] }));
    expect((await withResumeModelCheckpoint({workflowId:wid,identity:{version:1},task},complete)).reused).toBe(false);
    expect((await withResumeModelCheckpoint({workflowId:other,identity:{version:1},task},complete)).reused).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    const unknown = vi.fn(async () => { throw new Error("connection interrupted"); });
    await expect(withResumeModelCheckpoint({workflowId:wid,identity:{version:2},task},unknown)).rejects.toThrow("did not return a confirmed draft");
    await expect(withResumeModelCheckpoint({workflowId:other,identity:{version:2},task},unknown)).rejects.toThrow("no confirmed result");
    expect(unknown).toHaveBeenCalledTimes(1);
  });

  it("requires approved exact bytes for the review handoff and resets approval when edited", async () => {
    const db = holder.db!, app = crypto.randomUUID(), workflow = crypto.randomUUID(), version = crypto.randomUUID(), exportId = crypto.randomUUID();
    await db.query("INSERT INTO applications (id, ai_workflow_id, tailored_resume_version_id, application_stage) VALUES ($1,$2,$3,'ready_for_review')", [app, workflow, version]);
    await db.query("INSERT INTO application_ai_workflows (id,application_id,status,current_stage,config_snapshot) VALUES ($1,$2,'completed',4,$3)", [workflow,app,JSON.stringify({pipelineVariant:"resume_evidence_v2"})]);
    await db.query("INSERT INTO application_resume_versions (id, workflow_id, application_id,status,content) VALUES ($1,$2,$3,'draft','{}')", [version,workflow,app]);
    const handoff = () => db.query("UPDATE applications SET application_stage='ready_for_application' WHERE id=$1", [app]);
    await expect(handoff()).rejects.toThrow("Approve and validate");
    await db.query("INSERT INTO application_resume_exports VALUES ($1,$2,$3,'created','pdf','tested-sha')", [exportId,app,version]);
    await db.query("UPDATE application_resume_versions SET status='approved',release_receipt=$2::jsonb WHERE id=$1", [version,JSON.stringify({exportId,pdfHash:"tested-sha"})]);
    await expect(handoff()).resolves.toBeTruthy();
    await db.query("UPDATE application_resume_versions SET content='{\"edited\":true}' WHERE id=$1", [version]);
    expect((await db.query("SELECT status, release_receipt FROM application_resume_versions WHERE id=$1", [version])).rows[0]).toEqual({ status: "draft", release_receipt: null });
    await expect(db.query("UPDATE applications SET applied_at=now() WHERE id=$1",[app])).rejects.toThrow("Approve and validate");
  });

  it("uses the live lock version for atomic finalization before attaching a draft", async () => {
    const db = holder.db!, app = crypto.randomUUID(), workflow = crypto.randomUUID();
    const candidate = crypto.randomUUID(), job = crypto.randomUUID(), targetJob = crypto.randomUUID();
    await db.query("INSERT INTO jobs(id,title) VALUES ($1,'Engineer')", [job]);
    await db.query("INSERT INTO target_jobs (id,candidate_id,job_id) VALUES ($1,$2,$3)", [targetJob,candidate,job]);
    await db.query(`INSERT INTO applications (id,ai_workflow_id,candidate_id,job_id,application_stage,ae_stage)
      VALUES ($1,$2,$3,$4,'in_ai_pipeline','in_ai_pipeline')`, [app,workflow,candidate,job]);
    await db.query(`INSERT INTO application_ai_workflows (id,application_id,status,current_stage,claim_expires_at,config_snapshot)
      VALUES ($1,$2,'running',4,now()+interval '10 minutes',$3::jsonb)`, [workflow,app,JSON.stringify({
        pipelineVariant: "resume_evidence_v2", job:{ title:"Engineer" }, baseResume:{ content:{} },
      })]);
    const final = {
      summary:null, experience:[], education:[], skills:[], certifications:[], projects:[], exportReady:true,
      finalQaScore:8, studioDocument:{header:{fullName:"Example Person"},skills:[],experience:[],education:[]},
    };
    const artifact = {id:crypto.randomUUID(),workflow_id:workflow,automation_id:"application_release_editor",
      sequence_number:5, schema_version:"EvidenceReleaseV2",content_hash:"test",data:final,created_at:new Date().toISOString()};
    await expect(finalizeWorkflow(workflow, 0, [artifact])).rejects.toThrow("claim or selected application changed");
    expect((await db.query("SELECT id FROM application_resume_versions WHERE workflow_id=$1",[workflow])).rows).toEqual([]);
    const version = await finalizeWorkflow(workflow, 1, [artifact]);
    expect((await db.query("SELECT tailored_resume_version_id,application_stage FROM applications WHERE id=$1",[app])).rows[0])
      .toEqual({ tailored_resume_version_id:version,application_stage:"ready_for_review" });
    expect((await db.query("SELECT status FROM application_resume_versions WHERE id=$1",[version])).rows[0]).toEqual({status:"draft"});
  });
});
