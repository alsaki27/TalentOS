import { beforeEach, describe, expect, it, vi } from "vitest";
import { mutateCandidateCustomActivity } from "@/server/services/candidateCustomActivityService";
const mocks=vi.hoisted(()=>({auth:vi.fn(),query:vi.fn()}));
vi.mock("@/lib/auth",()=>({ALL_USER_ROLES:["admin","manager","application_engineer"],requireCurrentUser:mocks.auth}));
vi.mock("@/server/db/neon",()=>({queryOne:mocks.query}));
const id="11111111-1111-4111-8111-111111111111", activityId="22222222-2222-4222-8222-222222222222";
const request=(data:unknown)=>new Request("https://example.test/api/custom",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
describe("Custom activity API writes",()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({context:{profile:{user_id:id,email:null,role:"manager"}},response:null});});
 it("lets a Grunter edit an existing activity and keeps creation and deletion restricted",async()=>{
  mocks.auth.mockResolvedValue({context:{profile:{role:"application_engineer",role_variant:"application_engineer_grunter"}},response:null});
  for(const method of["POST","DELETE"] as const)expect((await mutateCandidateCustomActivity(request({}),{id,activityId},method)).status).toBe(403);
  expect(mocks.query).not.toHaveBeenCalled();
  mocks.query.mockResolvedValue({id:activityId,version:2});
  const result = await mutateCandidateCustomActivity(request({title:"Appointment",body:"Updated",version:1}),{id,activityId},"PATCH");
  expect(result.status).toBe(200);
  expect(mocks.query.mock.calls[0][1]).toContain("candidate_activity.updated");
 });
 it("validates required data before a write",async()=>{
  expect((await mutateCandidateCustomActivity(request({title:"Missing reason"}),{id},"POST")).status).toBe(400);expect(mocks.query).not.toHaveBeenCalled();
 });
 it("writes a create and its audit record in the same statement",async()=>{
  mocks.query.mockResolvedValue({id:activityId});
  expect((await mutateCandidateCustomActivity(request({title:"Vacation",body:"Family trip"}),{id},"POST")).status).toBe(201);
  expect(mocks.query.mock.calls[0][0]).toContain("candidate_activity.created");expect(mocks.query.mock.calls[0][1][0]).toBe(id);
 });
 it("requires an unchanged version for updates and deletions",async()=>{
  mocks.query.mockResolvedValueOnce(null).mockResolvedValueOnce({id:activityId});
  expect((await mutateCandidateCustomActivity(request({title:"Vacation",body:"Updated",version:1}),{id,activityId},"PATCH")).status).toBe(409);
  expect(mocks.query.mock.calls[0][0]).toContain("version=$12");
 });
 it("uses the candidate timezone even if a caller supplies a different timezone",async()=>{
  mocks.query.mockResolvedValueOnce({timezone:"Asia/Dhaka"}).mockResolvedValueOnce({id:activityId});
  const response=await mutateCandidateCustomActivity(request({title:"Vacation",body:"Family trip",schedule_mode:"time_range",start_date:"2026-12-01",end_date:"2026-12-02",start_time:"09:00",end_time:"17:00",time_zone:"America/New_York"}),{id},"POST");
  expect(response.status).toBe(201);
  expect(mocks.query.mock.calls[1][1][7]).toBe("2026-12-01T03:00:00.000Z");
  expect(mocks.query.mock.calls[1][1][9]).toBe("Asia/Dhaka");
 });
});
