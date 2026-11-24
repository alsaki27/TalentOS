// Explicit local-only integration fixture. Never reads DATABASE_URL.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
const local = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/server/db/neon", () => ({
  query: async (text: string, params: unknown[]) => (await local.pool!.query(text, params)).rows,
  queryOne: async (text: string, params: unknown[]) => (await local.pool!.query(text, params)).rows[0] ?? null,
}));
import { listCandidateSubmissionRecords, listRecordingCandidates, saveSubmissionRecords } from "@/server/services/submissionRecordService";
const candidate="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", actor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const entry={id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",instance_id:"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",candidate_id:candidate,instance_name:"Browser one",question:"Experience?",answer:"Five years",page_url:"https://example.test/apply",page_title:"Apply",field_key:"experience",field_type:"textarea",event_type:"change",recorded_at:"2026-01-01T00:00:00.000Z"};
describe.skipIf(process.env.RECORDER_LOCAL_DB_TEST !== "1")("recorder real local PostgreSQL", () => {
  beforeAll(async () => {
    local.pool=new Pool({host:"127.0.0.1",port:55439,database:"postgres",user:process.env.USER,max:1});
    await local.pool.query(`CREATE SCHEMA recorder_test; SET search_path=recorder_test;
      CREATE TABLE candidates(id uuid PRIMARY KEY,name text,status text,pipeline_stage text);
      CREATE TABLE profiles(user_id uuid PRIMARY KEY,display_name text,is_active boolean);
      CREATE TABLE extension_api_keys(id uuid PRIMARY KEY,owner_user_id uuid,candidate_id uuid,scopes text[],revoked_at timestamptz);`);
    const migration=await readFile("sql/neon_fixes/148_candidate_submission_records.sql","utf8");
    await local.pool.query(migration); await local.pool.query(migration);
    await local.pool.query("INSERT INTO candidates VALUES($1,'Synthetic candidate','active','not_started')",[candidate]);
    await local.pool.query("INSERT INTO profiles VALUES($1,'Synthetic staff',true)",[actor]);
    await local.pool.query("INSERT INTO extension_api_keys VALUES($1,$2,$3,ARRAY['extension:submission-records:write'],NULL)",[key,actor,candidate]);
  });
  afterAll(async () => { if(local.pool){ await local.pool.query("DROP SCHEMA recorder_test CASCADE"); await local.pool.end(); }});
  it("inserts once, preserves conflicting originals, separates instances and rechecks revocation", async () => {
    expect((await listRecordingCandidates(candidate)).map(c=>c.id)).toEqual([candidate]);
    expect(await saveSubmissionRecords([entry],actor,key)).toEqual({accepted:[entry.id],conflicts:[]});
    expect(await saveSubmissionRecords([entry],actor,key)).toEqual({accepted:[entry.id],conflicts:[]});
    expect(await saveSubmissionRecords([{...entry,answer:"Collision"}],actor,key)).toEqual({accepted:[],conflicts:[entry.id]});
    const second={...entry,instance_id:"ffffffff-ffff-4fff-8fff-ffffffffffff",instance_name:"Browser two",answer:""};
    expect((await saveSubmissionRecords([second],actor,key)).accepted).toEqual([entry.id]);
    const result=await listCandidateSubmissionRecords(candidate,"",1,25);
    expect(result?.total).toBe(2);
    expect(result?.records.map(r=>r.answer).sort()).toEqual(["","Five years"]);
    expect((await listCandidateSubmissionRecords(candidate,"Five",1,25))?.total).toBe(1);
    await local.pool!.query("UPDATE extension_api_keys SET revoked_at=now() WHERE id=$1",[key]);
    const denied={...entry,id:"11111111-1111-4111-8111-111111111111"};
    expect(await saveSubmissionRecords([denied],actor,key)).toEqual({accepted:[],conflicts:[denied.id]});
    expect((await listCandidateSubmissionRecords(candidate,"",1,25))?.total).toBe(2);
  });
});
