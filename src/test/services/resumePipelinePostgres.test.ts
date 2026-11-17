import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { recoverResumeWorkflows, manualResumeTransition } from "@/server/repositories/resumeWorkflowRecoveryRepository";
import { commitStageResult } from "@/server/repositories/applicationAiWorkflowRepository";
import { withResumeModelCheckpoint } from "@/server/repositories/resumeModelCheckpointRepository";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import { approveEvidenceResumeForApplication, evidenceResumeExportIsAllowed } from "@/server/services/resumeEvidenceReleaseService";
import { runApprovedResumePdfJobs } from "@/server/services/approvedResumePdfJobs";
import { readApprovedResumePdf } from "@/server/services/approvedResumePdfDownload";
import { findExportById } from "@/server/repositories/applicationResumeExportsRepository";
import { TEMPORARY_RESUME_PDF_PROVIDER } from "@/server/storage/approvedResumePdfStorage";
import { sha256Hex } from "@/lib/sha256";
import { archiveResumeToSharePoint } from "@/server/services/resumeSharePointArchiveService";
import { signApprovedResumePdfLink, verifyApprovedResumePdfLink } from "@/server/services/approvedResumePdfLink";

const holder = vi.hoisted(() => ({
  db: null as null | {
    query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; affectedRows: number }>;
    exec: (sql: string) => Promise<unknown>;
    close: () => Promise<void>;
  },
  staged: new Map<string, Uint8Array>(),
  copy: new Uint8Array(),
  mismatch: false,
  failDelete: false,
  uploads: 0,
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
    {
      query: (statement: string, values: unknown[]) => async () => (await holder.db!.query(statement, values)).rows,
      transaction: async (queries: (() => Promise<unknown>)[]) => {
        const db = holder.db!;
        await db.exec("BEGIN");
        try {
          const result = [];
          for (const query of queries) result.push(await query());
          await db.exec("COMMIT");
          return result;
        } catch (error) {
          await db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  ),
}));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { RESUME_PDF_STAGING: {
    put: async (key: string, data: Uint8Array) => {
      if (holder.staged.has(key)) return null;
      holder.staged.set(key, data);
      return { size: data.byteLength };
    },
    get: async (key: string) => {
      const data = holder.staged.get(key);
      return data ? { size: data.byteLength, arrayBuffer: async () => new Uint8Array(data).buffer } : null;
    },
    delete: async (key: string) => {
      const row = (await holder.db!.query(`SELECT x.storage_provider,q.state FROM application_resume_pdf_archive_jobs q
        JOIN application_resume_exports x ON x.id=q.export_id WHERE q.temporary_key=$1`, [key])).rows[0];
      expect(row).toEqual({ storage_provider: "sharepoint", state: "cleanup" });
      if (holder.failDelete) throw new Error("test cleanup interruption");
      holder.staged.delete(key);
    },
  } } }),
}));
vi.mock("@/server/services/studioResumePdf", () => ({
  StudioResumeLayoutError: class extends Error {},
  getStudioApprovalPdf: async (_id: string, content: unknown) => {
    const bytes = new TextEncoder().encode("%PDF-" + JSON.stringify(content));
    return {
      bytes, pdfHash: await sha256Hex(bytes), contentHash: await sha256Hex(JSON.stringify(content)),
      metrics: { pageCount: 1, pageUtilizations: [94] }, prepared: true, timings: {},
    };
  },
}));
vi.mock("@/lib/integrations/sharepoint", () => ({
  sharePointResumeArchiveRoot: async () => "/sites/TalentOS/Shared Documents/resumes",
  uploadToSharePoint: async (path: string, bytes: Uint8Array) => {
    expect(path.split("/").at(-1)!.length).toBeLessThanOrEqual(255);
    holder.copy = new Uint8Array(bytes);
    holder.uploads += 1;
    return { url: "https://example.test/archive", itemId: "item" };
  },
  openSharePointItem: async () => new Response(holder.mismatch ? "other content" : new Uint8Array(holder.copy)),
}));

const fixture = `
  CREATE TABLE ai_runtime_config (singleton boolean primary key);
  CREATE TABLE ai_automations (id text primary key,label text,description text,group_label text,is_active boolean);
  CREATE TABLE ai_api_keys (id uuid primary key, provider text, is_enabled boolean, key_fingerprint text, model text, default_model text);
  CREATE TABLE ai_automation_routes (automation_id text, rank int, ai_key_id uuid, provider text, model_override text, is_enabled boolean, primary key (automation_id,rank));
  CREATE TABLE ai_agent_configs (automation_id text primary key,display_name text,prompt_version text,max_output_tokens int,timeout_ms int,max_attempts int);
  CREATE TABLE applications (id uuid primary key,ai_workflow_id uuid, tailored_resume_version_id uuid, applied_at timestamptz,
    candidate_id uuid, job_id uuid, resume_generation_completed_at timestamptz, review_status text,
    ae_stage_updated_at timestamptz,ae_stage_updated_by_name text, application_stage_changed_at timestamptz,
    application_stage_changed_by_name text,resume_generation_status text,resume_generation_error text,application_stage text,ae_stage text);
  CREATE TABLE application_ai_workflows (id uuid primary key,application_id uuid,status text,current_stage int,
    created_at timestamptz default now(),updated_at timestamptz default now(),config_snapshot jsonb default '{}',base_resume_id uuid,completed_at timestamptz,
    claim_expires_at timestamptz,heartbeat_at timestamptz,claimed_at timestamptz,claimed_by text,next_retry_at timestamptz,cancelled_at timestamptz,
    recovery_count int default 0,stage_retry_count int default 0,cooldown_retry_count int default 0,lock_version int default 1,last_error text,
    routing_state_id uuid,route_snapshot jsonb);
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
  CREATE TABLE jobs (id uuid primary key,title text,company text);
  CREATE TABLE candidates (id uuid primary key,name text);
  CREATE TABLE application_stage_history (application_id uuid, from_stage text,to_stage text,changed_by_name text,reason text,source text);
  CREATE TABLE application_packets (application_id uuid primary key,base_resume_id uuid,target_job_id uuid,final_resume_version_id uuid,created_by uuid);
  CREATE TABLE application_resume_exports (id uuid primary key default gen_random_uuid(),application_id uuid,resume_version_id uuid,
    status text,export_type text,content_sha256 text, file_name text,file_path text,storage_provider text,storage_url text,
    storage_item_id text,file_size_bytes integer, error text,created_by uuid,candidate_name_snapshot text,company_name_snapshot text,
    job_title_snapshot text,created_at timestamptz default now(),updated_at timestamptz default now());
  CREATE UNIQUE INDEX exact_pdf ON application_resume_exports(application_id,resume_version_id,export_type,content_sha256)
    WHERE content_sha256 IS NOT NULL AND status <> 'deleted';
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

  it("refreshes routing on a guarded retry while retaining the successful Forge artifact", async () => {
    const db = holder.db!;
    const app = crypto.randomUUID(), workflow = crypto.randomUUID(), state = crypto.randomUUID();
    await db.query("INSERT INTO applications (id,ai_workflow_id) VALUES ($1,$2)", [app, workflow]);
    await db.query(`INSERT INTO application_ai_workflows (id,application_id,status,current_stage,config_snapshot)
      VALUES ($1,$2,'failed',1,'{"pipelineVariant":"resume_evidence_v2","frozenInputsHash":"original"}')`, [workflow, app]);
    const artifact = (await db.query(`INSERT INTO application_ai_artifacts (workflow_id,automation_id)
      VALUES ($1,'application_resume_forge') RETURNING id`, [workflow])).rows[0].id;
    await db.query(`INSERT INTO application_ai_stage_runs (workflow_id,automation_id,sequence_number,status,output_artifact_id)
      VALUES ($1,'application_resume_forge',1,'success',$2)`, [workflow, artifact]);
    const routes = [{ automation_id: "application_hiring_panel_evidence_v2", ai_key_id: null, provider: "opencode",
      model_override: "qwen3.7-plus", rank: 1 }];
    const routing = { routingStateId: state, routeSnapshot: routes, evidenceRoutes: null,
      evidenceRouteChains: { application_hiring_panel_evidence_v2: routes } };
    expect(await manualResumeTransition({ id: workflow, action: "retry", stage: null, staleHeartbeatSeconds: 300, routing }))
      .toEqual({ status: "queued", current_stage: 1 });
    const saved = (await db.query(`SELECT w.routing_state_id,w.route_snapshot,w.config_snapshot,s.output_artifact_id
        FROM application_ai_workflows w JOIN application_ai_stage_runs s ON s.workflow_id=w.id WHERE w.id=$1`, [workflow])).rows[0];
    expect(saved).toMatchObject({ routing_state_id: state, route_snapshot: routes, output_artifact_id: artifact,
      config_snapshot: { frozenInputsHash: "original", evidenceRouteChains: routing.evidenceRouteChains } });
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
    await db.query("INSERT INTO application_resume_exports(id,application_id,resume_version_id,status,export_type,content_sha256) VALUES ($1,$2,$3,'created','pdf','tested-sha')", [exportId,app,version]);
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

  it("refreshes the newest Studio save and deletes staged bytes only after a verified SharePoint switch", async () => {
    const db = holder.db!;
    const migration = readFileSync("sql/neon_fixes/144_approved_resume_pdf_archive_jobs.sql", "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const app = crypto.randomUUID(), wf = crypto.randomUUID(), version = crypto.randomUUID();
    const candidate = crypto.randomUUID(), job = crypto.randomUUID(), actor = crypto.randomUUID();
    await db.query("INSERT INTO candidates VALUES ($1,$2)", [candidate, "Example reviewer fixture"]);
    await db.query("INSERT INTO jobs VALUES ($1,$2,$3)", [job, "Long publishing operations title ".repeat(6), "Publisher"]);
    await db.query(`INSERT INTO applications (id,ai_workflow_id,tailored_resume_version_id,candidate_id,job_id,ae_stage,review_status)
      VALUES ($1,$2,$3,$4,$5,'ready_for_review','approved')`, [app, wf, version, candidate, job]);
    await db.query(`INSERT INTO application_ai_workflows (id,application_id,status,current_stage,config_snapshot)
      VALUES ($1,$2,'completed',4,'{"pipelineVariant":"resume_evidence_v2"}')`, [wf, app]);
    await db.query(`INSERT INTO application_resume_versions(id,workflow_id,application_id,status,content,updated_at,updated_by_user_id)
      VALUES ($1,$2,$3,'draft','{"theme":"studio-1"}',NOW(),$4)`, [version, wf, app, actor]);
    const result = await approveEvidenceResumeForApplication(app, actor, "ready_for_review", undefined, {
      advance: { updates: { ae_stage: "ready_for_application" }, previousReviewStatus: "approved" },
    });
    expect(result?.application?.ae_stage).toBe("ready_for_application");
    const getCurrent = async () => (await db.query(`SELECT status,release_receipt,pdf_refresh_state
      FROM application_resume_versions WHERE id=$1`, [version])).rows[0];
    const firstExportId = (await getCurrent()).release_receipt.exportId;
    const staged = (await findExportById(firstExportId))!;
    expect(staged.storage_provider).toBe(TEMPORARY_RESUME_PDF_PROVIDER);
    const firstBytes = await readApprovedResumePdf(staged);
    expect(await sha256Hex(firstBytes)).toBe(staged.content_sha256);
    expect(await evidenceResumeExportIsAllowed(app, version, firstExportId)).toBe(true);
    holder.mismatch = true;
    await runApprovedResumePdfJobs();
    expect((await findExportById(firstExportId))?.storage_provider).toBe(TEMPORARY_RESUME_PDF_PROVIDER);
    expect(holder.staged.has(staged.file_path!)).toBe(true);
    holder.mismatch = false;
    await db.query("UPDATE application_resume_pdf_archive_jobs SET state='pending',next_attempt_at=NOW() WHERE export_id=$1", [firstExportId]);
    holder.failDelete = true;
    await runApprovedResumePdfJobs();
    expect((await findExportById(firstExportId))?.storage_provider).toBe("sharepoint");
    expect(holder.staged.has(staged.file_path!)).toBe(true);
    const copies = holder.uploads;
    holder.failDelete = false;
    await db.query("UPDATE application_resume_pdf_archive_jobs SET next_attempt_at=NOW() WHERE export_id=$1", [firstExportId]);
    await runApprovedResumePdfJobs();
    expect(holder.uploads).toBe(copies);
    expect(holder.staged.has(staged.file_path!)).toBe(false);
    expect(await readApprovedResumePdf(staged)).toEqual(firstBytes);

    const save = (theme: string) => db.query(`UPDATE application_resume_versions SET content=jsonb_build_object('theme',$2::text),
      updated_source='human_falood_studio_save',updated_by_user_id=$3,updated_at=NOW() WHERE id=$1`, [version, theme, actor]);
    await save("studio-2");
    await save("studio-3");
    expect((await getCurrent()).pdf_refresh_state).toBe("pending");
    expect(await evidenceResumeExportIsAllowed(app, version, firstExportId)).toBe(false);
    await expect(db.query("UPDATE applications SET ae_stage='applied',applied_at=NOW() WHERE id=$1", [app])).rejects.toThrow("Approve and validate");
    await runApprovedResumePdfJobs();
    const second = await getCurrent();
    expect(second).toMatchObject({ status: "approved", pdf_refresh_state: "complete", release_receipt: { automaticRefresh: true } });
    const secondExportId = second.release_receipt.exportId;
    expect(secondExportId).not.toBe(firstExportId);
    expect(new TextDecoder().decode(await readApprovedResumePdf((await findExportById(secondExportId))!))).toContain("studio-3");
    await save("studio-3");
    expect((await getCurrent()).release_receipt.exportId).toBe(secondExportId);
    await db.query("UPDATE applications SET ae_stage='applied',applied_at=NOW() WHERE id=$1", [app]);
    await save("studio-4");
    await runApprovedResumePdfJobs();
    expect((await getCurrent()).release_receipt.exportId).not.toBe(secondExportId);
    expect((await db.query("SELECT submitted_resume_export_id,ae_stage FROM applications WHERE id=$1", [app])).rows[0])
      .toEqual({ submitted_resume_export_id: secondExportId, ae_stage: "applied" });
    await save("studio-5");
    await db.query(`UPDATE application_resume_versions SET content='{"theme":"other-workflow"}',
      updated_source='other_workflow',updated_at=NOW() WHERE id=$1`, [version]);
    await runApprovedResumePdfJobs();
    expect(await getCurrent()).toMatchObject({ status: "draft", pdf_refresh_state: "superseded", release_receipt: null });
  });

  it("keeps older non-evidence tickets on their normal review and applied path", async () => {
    const db = holder.db!, app = crypto.randomUUID(), version = crypto.randomUUID(), workflow = crypto.randomUUID();
    await db.query("INSERT INTO applications(id,ai_workflow_id,tailored_resume_version_id,ae_stage) VALUES ($1,$2,$3,'ready_for_review')", [app, workflow, version]);
    await db.query("INSERT INTO application_ai_workflows(id,application_id,status) VALUES ($1,$2,'completed')", [workflow, app]);
    await db.query("INSERT INTO application_resume_versions(id,application_id,workflow_id,status,content) VALUES ($1,$2,$3,'approved','{}')", [version, app, workflow]);
    expect(await approveEvidenceResumeForApplication(app, crypto.randomUUID(), "ready_for_review")).toBeUndefined();
    await db.query("UPDATE applications SET ae_stage='ready_for_application' WHERE id=$1", [app]);
    await db.query("UPDATE application_resume_versions SET content='{\"changed\":true}',updated_source='human_falood_studio_save',updated_by_user_id=$2 WHERE id=$1", [version, crypto.randomUUID()]);
    expect((await db.query("SELECT 1 FROM application_resume_pdf_refresh_jobs WHERE resume_version_id=$1", [version])).rows).toEqual([]);
    await expect(db.query("UPDATE applications SET ae_stage='applied',applied_at=NOW() WHERE id=$1", [app])).resolves.toBeTruthy();
  });

  it("reuses the failed long-filename export after the shortened-path retry", async () => {
    const db = holder.db!;
    const applicationId = crypto.randomUUID(), resumeVersionId = crypto.randomUUID();
    const exportId = crypto.randomUUID(), candidateId = crypto.randomUUID(), jobId = crypto.randomUUID();
    const buffer = new TextEncoder().encode("%PDF-path-length-fixture");
    const variantLabel = await sha256Hex(buffer);
    await db.query(`INSERT INTO application_resume_exports (id,application_id,resume_version_id,export_type,file_name,status,content_sha256)
      VALUES ($1,$2,$3,'pdf',$4,'failed',$5)`, [exportId, applicationId, resumeVersionId, "x".repeat(288) + ".pdf", variantLabel]);
    const input = { applicationId, resumeVersionId, candidateId, jobId, candidateName: "Example Candidate",
      companyName: "Publishing Operations Company", jobTitle: "Inventory operations analyst ".repeat(5),
      exportType: "pdf" as const, buffer, variantLabel, preferExistingFolder: true };
    expect(await archiveResumeToSharePoint(input)).toMatchObject({ ok: true, id: exportId });
    expect(await archiveResumeToSharePoint(input)).toMatchObject({ ok: true, id: exportId, duplicate: true });
    const { rows } = await db.query(`SELECT status,length(file_name) AS chars FROM application_resume_exports
      WHERE application_id=$1`, [applicationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("created");
    expect(rows[0].chars).toBeLessThanOrEqual(255);
  });
});

it("binds a temporary extension download to an exact export and application", async () => {
  vi.stubEnv("JWT_SECRET", "test-only-approval-link");
  try {
    const token = await signApprovedResumePdfLink("application", "export");
    await expect(verifyApprovedResumePdfLink("application", "export", token)).resolves.toBe(true);
    await expect(verifyApprovedResumePdfLink("different", "export", token)).resolves.toBe(false);
    await expect(verifyApprovedResumePdfLink("application", "different", token)).resolves.toBe(false);
    await expect(verifyApprovedResumePdfLink("application", "export", token.replace(/^\d+/, "1"))).resolves.toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
