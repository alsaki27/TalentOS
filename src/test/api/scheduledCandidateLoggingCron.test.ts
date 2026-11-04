import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
const mocks=vi.hoisted(()=>({enqueue:vi.fn(),continue:vi.fn()}));
vi.mock("@/server/services/scheduledCandidateLoggingService",()=>({enqueueScheduledCandidateLogging:mocks.enqueue,continueScheduledCandidateLogging:mocks.continue}));
import {POST} from "@/app/api/cron/scheduled-candidate-logging/route";
import {scheduledLoggingDay} from "@/lib/scheduledLoggingSchedule";
function request(trigger="tick",authorized=true,requestId?:string) {
  return new NextRequest("https://talentos.test/api/cron/scheduled-candidate-logging",{method:"POST",headers:{
    "X-Scheduled-Logging-Trigger":trigger,...(authorized?{Authorization:"Bearer fixture-cron-secret"}:{}),
    ...(requestId?{"X-Scheduled-Logging-Request-Id":requestId}:{}),
  }});
}
describe("Cloudflare daily scheduled logging + resumable tick",()=>{
  beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("CRON_SECRET","fixture-cron-secret");
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-03T23:00:00Z"));
    mocks.continue.mockResolvedValue({skipped:true});mocks.enqueue.mockResolvedValue({runId:"daily",status:"running",phase:"queued"});});
  afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
  it("requires cron authentication before touching a run",async()=>{
    expect((await POST(request("tick",false))).status).toBe(401);expect(mocks.continue).not.toHaveBeenCalled();
  });
  it("starts at 05:00 BDT using the Bangladesh calendar date",async()=>{
    await POST(request("daily"));expect(mocks.enqueue).toHaveBeenCalledWith({triggerType:"scheduled",runKey:"scheduled-candidate-logging:daily:2026-11-04"});
    expect(mocks.continue).toHaveBeenCalledTimes(2);
  });
  it("catches up at 08:00 BDT if the exact daily tick was missed",async()=>{
    vi.setSystemTime(new Date("2026-11-04T02:00:00Z"));await POST(request());
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({runKey:"scheduled-candidate-logging:daily:2026-11-04"}));
  });
  it("continues manual work before 05:00 without creating a daily batch early",async()=>{
    vi.setSystemTime(new Date("2026-11-03T22:59:59Z"));await POST(request());
    expect(mocks.continue).toHaveBeenCalledOnce();expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("does not create another batch while one is still processing",async()=>{
    mocks.continue.mockResolvedValue({runId:"existing",status:"running",phase:"queued"});
    const response=await POST(request());expect(await response.json()).toMatchObject({result:{runId:"existing"}});
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("does not execute an already completed daily key again",async()=>{
    mocks.enqueue.mockResolvedValue({runId:"existing",status:"completed"});await POST(request());
    expect(mocks.continue).toHaveBeenCalledOnce();
  });
  it("accepts GitHub manual requests quickly with a stable retry idempotency key",async()=>{
    const response=await POST(request("manual",true,"github-12345"));
    expect(response.status).toBe(202);expect(mocks.continue).not.toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith({triggerType:"manual",runKey:"scheduled-candidate-logging:workflow-dispatch:github-12345"});
  });
  it("surfaces storage errors so monitoring can detect failed ticks",async()=>{
    mocks.continue.mockRejectedValue(new Error("Read fixture unavailable"));
    expect((await POST(request())).status).toBe(500);
  });
  it("handles month/year rollover and never uses the machine timezone",()=>{
    expect(scheduledLoggingDay(new Date("2026-12-31T23:00:00Z"))).toEqual({day:"2027-01-01",due:true});
    expect(scheduledLoggingDay(new Date("2026-11-03T22:59:59Z"))).toEqual({day:"2026-11-04",due:false});
  });
});
