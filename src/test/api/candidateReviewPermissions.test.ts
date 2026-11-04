import {beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";

const mocks=vi.hoisted(()=>({cookie:vi.fn(),jwt:vi.fn(),query:vi.fn(),queryOne:vi.fn(),
  approve:vi.fn(),reject:vi.fn(),bulk:vi.fn(),legacyRetry:vi.fn()}));
vi.mock("next/headers",()=>({cookies:()=>({get:mocks.cookie})}));
vi.mock("@/server/auth/jwt",()=>({verifyJWT:mocks.jwt}));
vi.mock("@/server/db/neon",()=>({query:mocks.query,queryOne:mocks.queryOne}));
vi.mock("@/server/services/candidateJobReviewQueueService",()=>({approveReviewItem:mocks.approve,
  rejectReviewItem:mocks.reject,bulkApproveByTier:mocks.bulk,retryAiScoring:mocks.legacyRetry}));

// Exercise real cookie/JWT/profile authentication and each real route guard.
import {GET as list} from "@/app/api/admin/candidate-job-review/route";
import {POST as approve} from "@/app/api/admin/candidate-job-review/[id]/approve/route";
import {POST as reject} from "@/app/api/admin/candidate-job-review/[id]/reject/route";
import {POST as bulk} from "@/app/api/admin/candidate-job-review/bulk-approve/route";
import {POST as retry} from "@/app/api/admin/candidate-job-review/[id]/retry-ai/route";
import {GET as notifications} from "@/app/api/notifications/route";
import {CANDIDATE_JOB_REVIEW_ROLES,MASTER_DATA_MANAGER_ROLES,DESTRUCTIVE_MANAGER_ROLES,requireCurrentUser} from "@/lib/auth";
import {canAccessPath} from "@/lib/auth-edge";

const actor="11111111-1111-4111-8111-111111111111";
const review="22222222-2222-4222-8222-222222222222";
const params={params:{id:review}};
let role="application_engineer",active=true;
const request=(path:string,body?:unknown)=>new NextRequest(`https://talentos.test${path}`,body===undefined?{}:{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
});
const handlers=[
  ["list",()=>list(request("/api/admin/candidate-job-review"))],
  ["approve",()=>approve(request(`/api/admin/candidate-job-review/${review}/approve`,{}),params)],
  ["reject",()=>reject(request(`/api/admin/candidate-job-review/${review}/reject`,{note:"Recorded reason"}),params)],
  ["bulk approve",()=>bulk(request("/api/admin/candidate-job-review/bulk-approve",{tiers:["strong"]}))],
  ["retry AI",()=>retry(request(`/api/admin/candidate-job-review/${review}/retry-ai`,{}),params)],
  ["badge",()=>notifications(request("/api/notifications"))],
] as const;

describe("Review Queue permissions for admin, manager and Application Engineer",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();role="application_engineer";active=true;
    mocks.cookie.mockReturnValue({value:"fixture-session"});mocks.jwt.mockResolvedValue({user_id:actor,email:"staff@example.test"});
    mocks.queryOne.mockImplementation(async(sql:string)=>{
      if(sql.includes("FROM profiles WHERE"))return {user_id:actor,role,is_active:active,display_name:"Fixture staff",email:"staff@example.test"};
      if(sql.includes("SELECT source FROM candidate_job_review_queue"))return {source:"extension"};
      if(sql.includes("COUNT(*)::int AS count FROM candidate_job_review_queue"))return {count:7};
      if(sql.includes("pending_approvals"))return {pending_approvals:0,needs_reply:0};
      return null;
    });
    mocks.query.mockImplementation(async(sql:string)=>{
      if(sql.includes("GROUP BY q.status"))return [{status:"pending",count:1,strong_count:1,adjacent_count:0,stretch_count:0}];
      if(sql.includes("FROM profiles p WHERE"))return [{id:actor,name:"Fixture staff",role}];
      if(sql.includes("q.base_resume_id"))return [{id:review,assigned_to_user_id:"another-owner"}];
      return [];
    });
    mocks.approve.mockResolvedValue({applicationId:"application"});mocks.reject.mockResolvedValue(undefined);
    mocks.bulk.mockResolvedValue({approved:1,failed:[]});mocks.legacyRetry.mockResolvedValue(undefined);
  });

  describe.each(["admin","manager","application_engineer"])("active %s",userRole=>{
    beforeEach(()=>{role=userRole;});
    it.each(handlers)("can use the %s route",async(_name,invoke)=>{
      const response=await invoke();expect([200,202]).toContain(response.status);
    });
    it("passes the authenticated actor to approve, reject and bulk approval",async()=>{
      await handlers[1][1]();await handlers[2][1]();await handlers[3][1]();
      expect(mocks.approve).toHaveBeenCalledWith(review,actor);
      expect(mocks.reject).toHaveBeenCalledWith(review,actor,"Recorded reason");
      expect(mocks.bulk).toHaveBeenCalledWith(["strong"],actor,expect.any(Object));
    });
    it("sees reviews across owners and all active reviewer roles in the staff filter",async()=>{
      const data=await(await list(request("/api/admin/candidate-job-review"))).json();
      expect(data.items).toEqual([{id:review,assigned_to_user_id:"another-owner"}]);
      const owners=mocks.query.mock.calls.find(([sql])=>sql.includes("FROM profiles p WHERE"));
      expect(owners?.[1]).toEqual([["admin","manager","application_engineer"]]);
      expect(owners?.[0]).toContain("p.is_active = true");
    });
    it("gets the pending Review Queue badge and can reach the page through middleware policy",async()=>{
      const data=await(await notifications(request("/api/notifications"))).json();
      expect(data.candidateJobReview.pending).toBe(7);
      expect(canAccessPath(userRole,"/candidate-job-review")).toBe(true);
      expect(canAccessPath(userRole,`/api/admin/candidate-job-review/${review}/approve`)).toBe(true);
    });
  });

  it.each(handlers)("requires a staff session before %s",async(_name,invoke)=>{
    mocks.cookie.mockReturnValue(undefined);expect((await invoke()).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();expect(mocks.reject).not.toHaveBeenCalled();
    expect(mocks.bulk).not.toHaveBeenCalled();expect(mocks.legacyRetry).not.toHaveBeenCalled();
  });
  it.each(handlers)("blocks an inactive AE before %s",async(_name,invoke)=>{
    active=false;expect((await invoke()).status).toBe(401);expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.approve).not.toHaveBeenCalled();expect(mocks.reject).not.toHaveBeenCalled();
    expect(mocks.bulk).not.toHaveBeenCalled();expect(mocks.legacyRetry).not.toHaveBeenCalled();
  });
  it("rejects an invalid session JWT",async()=>{
    mocks.jwt.mockResolvedValue(null);expect((await handlers[1][1]()).status).toBe(401);
    expect(mocks.queryOne).not.toHaveBeenCalled();expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("does not grant AEs master-data, destructive or scheduled-configuration permissions",async()=>{
    expect(CANDIDATE_JOB_REVIEW_ROLES).toEqual(["admin","manager","application_engineer"]);
    expect(MASTER_DATA_MANAGER_ROLES).not.toContain("application_engineer");
    expect(DESTRUCTIVE_MANAGER_ROLES).not.toContain("application_engineer");
    expect((await requireCurrentUser(MASTER_DATA_MANAGER_ROLES)).response?.status).toBe(403);
    expect(canAccessPath("application_engineer","/team")).toBe(false);
  });
});
