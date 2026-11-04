import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest,NextResponse} from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),queryOne:vi.fn(),enqueue:vi.fn(),process:vi.fn(),dispatch:vi.fn(),legacyRetry:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireCurrentUser:mocks.auth,CANDIDATE_JOB_REVIEW_ROLES:["admin","manager","application_engineer"]}));
vi.mock("@/server/db/neon",()=>({queryOne:mocks.queryOne}));
vi.mock("@/server/services/candidateReviewAiService",()=>({enqueueExtensionReviewAiRetry:mocks.enqueue,processPendingReviewAi:mocks.process}));
vi.mock("@/server/services/candidateJobReviewQueueService",()=>({retryAiScoring:mocks.legacyRetry}));
vi.mock("@/server/lib/waitUntil",()=>({backgroundDispatch:mocks.dispatch}));
import {POST as retry} from "@/app/api/admin/candidate-job-review/[id]/retry-ai/route";
import {POST as cron} from "@/app/api/cron/candidate-review-ai/route";
const request=(token?:string)=>new NextRequest("https://talentos.test/api/cron/candidate-review-ai",{method:"POST",headers:token?{authorization:`Bearer ${token}`}:{}});

describe("background review AI endpoints",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();vi.stubEnv("CRON_SECRET","fixture-secret");
    mocks.auth.mockResolvedValue({user:{id:"manager"}});
    mocks.queryOne.mockResolvedValue({source:"extension"});mocks.enqueue.mockResolvedValue(undefined);
    mocks.process.mockResolvedValue({processed:2});mocks.legacyRetry.mockResolvedValue(undefined);
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("returns 202 after persisting retry intent without waiting for a model",async()=>{
    mocks.process.mockImplementation(()=>new Promise(()=>{}));
    const result=await retry(request(),{params:{id:"review"}});
    expect(result.status).toBe(202);expect(await result.json()).toMatchObject({accepted:true,aiStatus:"pending"});
    expect(mocks.enqueue).toHaveBeenCalledWith("review");expect(mocks.dispatch).toHaveBeenCalledOnce();
    expect(mocks.legacyRetry).not.toHaveBeenCalled();
  });
  it("keeps the scheduled-source manual retry behavior scoped separately",async()=>{
    mocks.queryOne.mockResolvedValueOnce({source:"scheduled_logging"}).mockResolvedValueOnce({custom_prompt:"Guidance",ai_match_threshold:30});
    expect((await retry(request(),{params:{id:"review"}})).status).toBe(200);
    expect(mocks.legacyRetry).toHaveBeenCalledWith("review","Guidance",30);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("refuses unauthorized reviewers before any database access",async()=>{
    mocks.auth.mockResolvedValue({response:NextResponse.json({error:"Forbidden"},{status:403})});
    expect((await retry(request(),{params:{id:"review"}})).status).toBe(403);
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
  it("does not dispatch missing or invalid review items",async()=>{
    mocks.queryOne.mockResolvedValueOnce(null);
    expect((await retry(request(),{params:{id:"missing"}})).status).toBe(404);
    mocks.enqueue.mockRejectedValueOnce(new Error("Only a pending extension review can be re-scored."));
    expect((await retry(request(),{params:{id:"review"}})).status).toBe(400);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it.each([undefined,"wrong"])("rejects a recovery tick with invalid credentials (%s)",async token=>{
    expect((await cron(request(token))).status).toBe(401);expect(mocks.process).not.toHaveBeenCalled();
  });
  it("fails closed if the cron secret is absent",async()=>{
    vi.stubEnv("CRON_SECRET","");expect((await cron(request("fixture-secret"))).status).toBe(401);
  });
  it("runs a bounded recovery batch under the existing cron secret",async()=>{
    const result=await cron(request("fixture-secret"));expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ok:true,processed:2});expect(mocks.process).toHaveBeenCalledWith({budgetMs:50_000});
  });
  it("reports a recovery error without pretending the saved review disappeared",async()=>{
    mocks.process.mockRejectedValue(new Error("Database unavailable"));
    expect((await cron(request("fixture-secret"))).status).toBe(500);
  });
});
