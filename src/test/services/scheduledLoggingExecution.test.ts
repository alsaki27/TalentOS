import {beforeEach,describe,expect,it,vi} from "vitest";
import {writeFileSync} from "node:fs";
const mocks=vi.hoisted(()=>({transaction:vi.fn(),queryOne:vi.fn(),statements:[] as any[]}));
vi.mock("@/server/db/neon",()=>({queryOne:mocks.queryOne,sql:()=>({
  query:(text:string,values:unknown[]=[])=>({text,values}),
  transaction:async(statements:any[])=>{mocks.statements.push(...statements);return mocks.transaction(statements);},
})}));
import {requestLoggingRun,claimLoggingRun,checkpointLoggingRun,leasedWrites,leasePredicate,ScheduledLoggingLeaseLost,type LoggingRun} from "@/server/services/scheduledLoggingExecution";

function run():LoggingRun {
  return {id:"11111111-1111-4111-8111-111111111111",status:"running",jobs_seen:1,candidate_pairs_scored:1,applications_created:0,
    ai_calls:1,skipped_count:0,failed_count:0,input_tokens:0,output_tokens:0,config_snapshot:{execution:{version:1,phase:"working",
      heartbeatAt:new Date().toISOString(),leaseToken:"token-fixture",leaseUntil:new Date(Date.now()+180000).toISOString(),
      currentEventId:null,eventIds:[],startedEventIds:[],completedEventIds:[],recoveries:0}}};
}
describe("durable scheduled run control",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.statements=[];});
  it("serializes start requests on the existing config row and returns the existing active batch",async()=>{
    const active=run();mocks.transaction.mockResolvedValue([[{id:true}],[],[],[active]]);
    expect(await requestLoggingRun({runKey:"daily:test",triggerType:"scheduled",snapshot:{},jobsPerRun:100})).toBe(active);
    const statements=mocks.transaction.mock.calls[0][0];
    expect(statements[0].text).toMatch(/scheduled_candidate_logging_config.*FOR UPDATE/);
    expect(statements[1].text).toMatch(/WHERE NOT EXISTS[\s\S]*status = 'running'/);
    expect(statements[1].text).toContain("ON CONFLICT (run_key) DO NOTHING");
    expect(statements[1].values[4]).toBe(100);
    expect(statements[2].text).toContain("Legacy batch stopped without finalizing.");
    expect(statements[2].text).toContain("-r.jobs_seen");
    expect(statements[2].text).toContain("r.ai_calls<");
    expect(statements[2].text).not.toMatch(/SET[\s\S]*ai_calls\s*=\s*0/);
    expect(statements.some((s:any)=>/ALTER TABLE|CREATE TABLE|applications\s+SET/.test(s.text))).toBe(false);
  });
  it("fails closed if no durable run record was created or found",async()=>{
    mocks.transaction.mockResolvedValue([[],[],[],[]]);
    await expect(requestLoggingRun({runKey:"test",triggerType:"manual",snapshot:{},jobsPerRun:1})).rejects.toThrow("Could not enqueue");
  });
  it("claims one queued run, fences it with a fresh token and bounds lease recovery",async()=>{
    mocks.transaction.mockResolvedValue([[],[],[],[],[],[],[run()]]);
    const claimed=await claimLoggingRun();expect(claimed?.status).toBe("running");
    const statements=mocks.transaction.mock.calls[0][0];
    expect(statements[0].text).toContain("FOR UPDATE");
    expect(statements[1].text).toMatch(/scheduled_candidate_logging_runs[\s\S]*FOR UPDATE/);
    expect(statements[2].text).toContain("currentEventId");
    expect(statements[2].text).toContain("leaseUntil");
    expect(statements[3].text).toContain("THEN 'failed'");
    expect(statements[3].values).toEqual([3]);
    expect(statements[4].text).toContain("MAX(created_at)");
    expect(statements[4].text).toContain("MAX(updated_at)");
    expect(statements[5].text).toContain("Unowned legacy claim recovered");
    expect(statements[5].text).toContain("INTERVAL '30 minutes'");
    expect(statements[6].text).toContain("ORDER BY started_at ASC LIMIT 1");
    expect(statements[6].values).toEqual([expect.stringMatching(/^[a-f0-9-]{36}$/),180,true]);
  });
  it("a watchdog-only check never claims AI work",async()=>{
    mocks.transaction.mockResolvedValue([[],[],[],[],[],[],[]]);
    expect(await claimLoggingRun(false)).toBeNull();
    expect(mocks.transaction.mock.calls[0][0][6].values[2]).toBe(false);
  });
  it("requires a valid owner token and unexpired lease on every checkpoint",async()=>{
    const fixture=run();mocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({id:fixture.id});
    await expect(checkpointLoggingRun(fixture,fixture.config_snapshot.execution)).rejects.toBeInstanceOf(ScheduledLoggingLeaseLost);
    await checkpointLoggingRun(fixture,{...fixture.config_snapshot.execution,phase:"finished",leaseToken:null,leaseUntil:null},"completed");
    expect(fixture.status).toBe("completed");
    const [text,values]=mocks.queryOne.mock.calls[0];
    expect(text).toContain("leaseToken' = $2");expect(text).toContain("::timestamptz > NOW()");
    expect(values.slice(0,2)).toEqual([fixture.id,"token-fixture"]);
  });
  it("keeps decision/review/event writes in one locked, lease-fenced transaction",async()=>{
    const fixture=run(),predicate=leasePredicate(fixture,1);
    mocks.transaction.mockResolvedValueOnce([[],[]]).mockResolvedValueOnce([[{id:fixture.id}],[{id:"decision"}]]);
    const writes=[{text:`SELECT 1 WHERE ${predicate.text}`,values:predicate.values}];
    await expect(leasedWrites(fixture,writes)).rejects.toBeInstanceOf(ScheduledLoggingLeaseLost);
    expect(await leasedWrites(fixture,writes)).toEqual([[{id:"decision"}]]);
    expect(mocks.transaction.mock.calls[1][0][0].text).toContain("FOR UPDATE");
    expect(writes[0].text).toContain("status = 'running'");
  });
  it("can export only synthetic SQL statements for an optional read-only EXPLAIN verification",async()=>{
    mocks.transaction.mockImplementation(async statements=>statements.length===4?[[],[],[],[run()]]:[[],[],[],[],[],[],[]]);
    await requestLoggingRun({runKey:"synthetic-plan-check",triggerType:"manual",snapshot:{},jobsPerRun:1});
    await claimLoggingRun();
    mocks.queryOne.mockImplementation(async (text,values)=>{mocks.statements.push({text,values});return {id:run().id};});
    await checkpointLoggingRun(run(),run().config_snapshot.execution);
    if(process.env.TALENTOS_SQL_PLAN_OUTPUT) writeFileSync(process.env.TALENTOS_SQL_PLAN_OUTPUT,JSON.stringify(mocks.statements));
    expect(mocks.statements.length).toBe(12);
  });
});
