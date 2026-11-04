import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest,NextResponse} from "next/server";
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn(),bulk:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireCurrentUser:mocks.auth,CANDIDATE_JOB_REVIEW_ROLES:["admin","manager","application_engineer"]}));
vi.mock("@/server/db/neon",()=>({query:mocks.query}));
vi.mock("@/server/services/candidateJobReviewQueueService",()=>({bulkApproveByTier:mocks.bulk}));
import {GET} from "@/app/api/admin/candidate-job-review/route";
import {POST as bulkApprove} from "@/app/api/admin/candidate-job-review/bulk-approve/route";
const candidate="11111111-1111-4111-8111-111111111111",staff="22222222-2222-4222-8222-222222222222";
const request=(params:Record<string,string>={})=>new NextRequest(`https://talentos.test/api/admin/candidate-job-review?${new URLSearchParams(params)}`);
describe("Review Queue filtered API and bulk approval",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();mocks.auth.mockResolvedValue({context:{profile:{user_id:staff}},response:null});
    mocks.query.mockImplementation(async text=>text.includes("GROUP BY q.status")?[{status:"pending",count:126,strong_count:100,adjacent_count:25,stretch_count:1},{status:"approved",count:2}]
      :text.includes("FROM candidates c WHERE")?[{id:candidate,name:"Candidate",pipeline_stage:"applying"}]
      :text.includes("FROM profiles p WHERE")?[{id:staff,name:"Owner",role:"admin"}]:[{id:"item"}]);
    mocks.bulk.mockResolvedValue({approved:1,failed:[]});
  });
  it.each([401,403])("enforces staff access (%s) before reading options or results",async status=>{
    mocks.auth.mockResolvedValue({response:NextResponse.json({error:"Denied"},{status})});
    expect((await GET(request())).status).toBe(status);expect(mocks.query).not.toHaveBeenCalled();
  });
  it("filters rows before LIMIT and uses the same scope for status counts",async()=>{
    const response=await GET(request({candidate_id:candidate,staff_id:staff,source:"extension",tier:"strong",start:"2026-11-04T00:00:00Z",end:"2026-11-04T03:00:00Z",page:"2"}));
    const data=await response.json();expect(response.status).toBe(200);
    expect(data.pagination).toEqual({page:2,pageSize:50,total:126});expect(data.pendingTiers.strong).toBe(100);
    const counts=mocks.query.mock.calls.find(([text])=>text.includes("GROUP BY q.status"))!;
    const items=mocks.query.mock.calls.find(([text])=>text.includes("q.base_resume_id"))!;
    expect(counts[1]).toEqual([candidate,staff,"extension","strong","2026-11-04T00:00:00.000Z","2026-11-04T03:00:00.000Z"]);
    expect(items[1]).toEqual([["pending"],...counts[1],50,50]);
    expect(items[0].indexOf("q.candidate_id =")).toBeLessThan(items[0].indexOf("LIMIT"));
    expect(data.filterOptions).toEqual({candidates:[{id:candidate,name:"Candidate",pipeline_stage:"applying"}],staff:[{id:staff,name:"Owner",role:"admin"}]});
  });
  it("loads full candidate and active reviewer rosters independently of matching review items",async()=>{
    const candidates=["applying","not_started","paused"].map((pipeline_stage,i)=>({id:`candidate-${i}`,name:`Candidate ${i}`,pipeline_stage}));
    const staffOptions=[{id:"admin-without-reviews",name:"Administrator",role:"admin"},{id:"manager-without-reviews",name:"Manager",role:"manager"},{id:"ae-without-reviews",name:"Application Engineer",role:"application_engineer"}];
    mocks.query.mockImplementation(async text=>text.includes("FROM candidates c WHERE")?candidates
      :text.includes("FROM profiles p WHERE")?staffOptions:[]);
    const response=await GET(request({candidate_id:candidate,staff_id:staff,source:"extension",tier:"strong"}));
    const data=await response.json();
    expect(response.status).toBe(200);expect(data.items).toEqual([]);
    expect(data.filterOptions).toEqual({candidates,staff:staffOptions});
    const candidateOptions=mocks.query.mock.calls.find(([text])=>text.includes("FROM candidates c WHERE"))!;
    const ownerOptions=mocks.query.mock.calls.find(([text])=>text.includes("FROM profiles p WHERE"))!;
    expect(candidateOptions[1]).toEqual([["applying","not_started","paused"]]);
    expect(ownerOptions[1]).toEqual([["admin","manager","application_engineer"]]);
    expect(candidateOptions[0]).not.toContain("candidate_job_review_queue");
    expect(ownerOptions[0]).not.toContain("candidate_job_review_queue");
    expect(ownerOptions[0]).toContain("p.is_active = true");
  });
  it("clamps an out-of-range page after approvals reduce the result count",async()=>{
    const data=await(await GET(request({page:"1000"}))).json();expect(data.pagination.page).toBe(3);
    expect(mocks.query.mock.calls.find(([text])=>text.includes("q.base_resume_id"))?.[1]).toEqual([["pending"],50,100]);
  });
  it("shows all statuses and zero-result pages correctly",async()=>{
    mocks.query.mockResolvedValue([]);const data=await(await GET(request({status:"all",page:"2"}))).json();
    expect(data.counts).toEqual({pending:0,approved:0,rejected:0});expect(data.pagination).toEqual({page:1,pageSize:50,total:0});
  });
  it("rejects invalid date ranges without making any database query",async()=>{
    expect((await GET(request({start:"2026-11-05T00:00:00Z",end:"2026-11-04T00:00:00Z"}))).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns a visible storage error rather than misleading empty success",async()=>{
    mocks.query.mockRejectedValue(new Error("fixture"));expect((await GET(request())).status).toBe(500);
  });
  it("passes the current filter scope to bulk approval",async()=>{
    const filters=new URLSearchParams({candidate_id:candidate,staff_id:staff,start:"2026-11-04T00:00:00Z"}).toString();
    const response=await bulkApprove(new NextRequest("https://talentos.test/api/admin/candidate-job-review/bulk-approve",{method:"POST",body:JSON.stringify({tiers:["strong"],filters})}));
    expect(response.status).toBe(200);expect(mocks.bulk).toHaveBeenCalledWith(["strong"],staff,expect.objectContaining({candidateId:candidate,staffId:staff,start:"2026-11-04T00:00:00.000Z"}));
  });
  it("invalid bulk filters fail closed",async()=>{
    const response=await bulkApprove(new NextRequest("https://talentos.test/api/admin/candidate-job-review/bulk-approve",{method:"POST",body:JSON.stringify({tiers:["strong"],filters:"candidate_id=bad"})}));
    expect(response.status).toBe(400);expect(mocks.bulk).not.toHaveBeenCalled();
  });
  it.each([{filters:{candidate_id:candidate}},{filters:"status=approved"}])("does not widen malformed/non-pending bulk scopes",async body=>{
    const response=await bulkApprove(new NextRequest("https://talentos.test/api/admin/candidate-job-review/bulk-approve",{method:"POST",body:JSON.stringify({tiers:["strong"],...body})}));
    expect(response.status).toBe(400);expect(mocks.bulk).not.toHaveBeenCalled();
  });
});
