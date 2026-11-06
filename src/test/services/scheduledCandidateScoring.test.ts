import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({call:vi.fn(),send:vi.fn(),query:vi.fn(),truncation:vi.fn()}));
vi.mock("@/lib/ai/routing",()=>({callWithUsageTracking:mocks.call,assertNotTruncated:mocks.truncation,AiRouteCallError:class extends Error{}}));
vi.mock("@/server/db/neon",()=>({query:mocks.query}));
import {scoreStage2} from "@/server/services/candidateJobScoring";
const input={customPrompt:"",description:"Prepare OSP construction drawings using AutoCAD. Maintain GIS records and verify field measurements. Coordinate drawing revisions with the engineering team.",deterministicScore:85,
  job:{job_id:"job",title:"Engineer",company:null,location:null,seniority_level:null,freshnessReferenceDate:null,
    requires_citizenship:false,citizenship_countries:null,export_control_restricted:false,eligibility_restriction_evidence:null},
  candidate:{id:"candidate",name:"Fixture",priority:"default" as const,preferences:{},custom_requirements:"",work_authorization:null,visa_status:null,preferred_locations:null},
  resume:{id:"resume",candidate_id:"candidate",name:"Draft resume",target_industry:null,target_roles:null,content:"Prepared OSP construction drawings using AutoCAD for fiber projects. Maintained GIS records and verified field measurements. Coordinated drawing revisions with the engineering team.",status:"approved"},
};
describe("structured eligibility output and scoped retry policy",()=>{
  beforeEach(()=>{
    vi.resetAllMocks();mocks.query.mockResolvedValue([]);
    mocks.send.mockResolvedValue({content:[{type:"text",text:JSON.stringify({tier:"strong",score:90,reason:"Supported fit",hard_gates:[]})}],stopReason:"end_turn"});
    mocks.call.mockImplementation(async(_automation,_ctx,fn)=>({result:await fn({send:mocks.send}),providerName:"opencode",model:"glm-5.3-flash",inputTokens:10,outputTokens:5,latencyMs:20}));
  });
  it("opts in only for the scheduled executor, constrains JSON and checks truncation",async()=>{
    const deadline=Date.now()+20000;
    const requirements=[
      {requirement:"Drafting",assessment:"met",jd_quote:"Prepare OSP construction drawings using AutoCAD.",resume_quote:"Prepared OSP construction drawings using AutoCAD for fiber projects."},
      {requirement:"GIS records",assessment:"met",jd_quote:"Maintain GIS records and verify field measurements.",resume_quote:"Maintained GIS records and verified field measurements."},
      {requirement:"Revisions",assessment:"met",jd_quote:"Coordinate drawing revisions with the engineering team.",resume_quote:"Coordinated drawing revisions with the engineering team."},
    ];
    mocks.send.mockResolvedValue({content:[{type:"text",text:JSON.stringify({tier:"strong",score:90,base_resume_id:"resume",reason:"Supported fit",hard_gates:[],assessment:{role_fit:"aligned",seniority_fit:"aligned",experience_fit:"meets",preferences_fit:"compatible",requirements}})}]});
    const result=await scoreStage2({...input,scheduledExecution:{deadlineAt:deadline}});
    expect(result.status).toBe("scored");
    expect(mocks.call.mock.calls[0][1]).toEqual({scheduledPoolRecovery:true,deadlineAt:deadline});
    expect(mocks.send.mock.calls[0][0]).toMatchObject({maxTokens:2800,responseMimeType:"application/json",responseSchema:{required:["tier","score","reason","hard_gates","assessment","base_resume_id"]}});
    expect(mocks.truncation).toHaveBeenCalledOnce();
  });
  it("also constrains manual review output without enabling scheduled recovery by default",async()=>{
    await scoreStage2(input);
    expect(mocks.call.mock.calls[0][1]).toEqual({});
    expect(mocks.send.mock.calls[0][0]).toHaveProperty("responseSchema");
    expect(mocks.truncation).toHaveBeenCalledOnce();
    mocks.call.mockRejectedValue(new Error("Pool unavailable"));
    expect(await scoreStage2(input)).not.toHaveProperty("retryAfterMs");
  });
  it("can choose a better approved alternate lane and validates evidence against only that lane",async()=> {
    const primary={...input.resume,content:"Office support and retail customer service only."};
    const alternate={...input.resume,id:"alternate"};
    const requirements=[
      {requirement:"Drafting",assessment:"met",jd_quote:"Prepare OSP construction drawings using AutoCAD.",resume_quote:"Prepared OSP construction drawings using AutoCAD for fiber projects."},
      {requirement:"GIS records",assessment:"met",jd_quote:"Maintain GIS records and verify field measurements.",resume_quote:"Maintained GIS records and verified field measurements."},
      {requirement:"Revisions",assessment:"met",jd_quote:"Coordinate drawing revisions with the engineering team.",resume_quote:"Coordinated drawing revisions with the engineering team."},
    ];
    const response={tier:"strong",score:92,base_resume_id:"alternate",reason:"Supported OSP lane",hard_gates:[],assessment:{role_fit:"aligned",seniority_fit:"aligned",experience_fit:"meets",preferences_fit:"compatible",requirements}};
    mocks.send.mockResolvedValue({content:[{type:"text",text:JSON.stringify(response)}]});
    const request={...input,resume:primary,approvedResumes:[primary,alternate],scheduledExecution:{deadlineAt:Date.now()+20000}};
    expect(await scoreStage2(request)).toMatchObject({status:"scored",selectedResumeId:"alternate",inputHashes:{resumeContent:expect.any(String)}});
    response.base_resume_id="resume";
    mocks.send.mockResolvedValue({content:[{type:"text",text:JSON.stringify(response)}]});
    expect(await scoreStage2(request)).toMatchObject({status:"failed"});
    response.base_resume_id="not-supplied";
    mocks.send.mockResolvedValue({content:[{type:"text",text:JSON.stringify(response)}]});
    expect(await scoreStage2(request)).toMatchObject({status:"failed"});
  });
  it("does not spend on draft lanes or silently truncated oversized inputs",async()=> {
    expect(await scoreStage2({...input,resume:{...input.resume,status:"draft"},precisionMatching:true})).toMatchObject({status:"failed"});
    expect(await scoreStage2({...input,description:"x".repeat(20001),precisionMatching:true})).toMatchObject({status:"failed"});
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("bounds background review attempts and rotates healthy sibling accounts through the existing recovery policy",async()=>{
    const deadlineAt=Date.now()+25_000;
    expect((await scoreStage2({...input,reviewExecution:{deadlineAt}})).status).toBe("scored");
    expect(mocks.call.mock.calls[0][1]).toEqual({scheduledPoolRecovery:true,deadlineAt});
    expect(mocks.send.mock.calls[0][0]).toMatchObject({timeoutMs:15_000,maxTokens:1400});
  });
  it("pauses scheduled work on pool exhaustion instead of producing ATS-only review floods",async()=>{
    mocks.call.mockRejectedValue(new Error("All keys cooling"));
    expect(await scoreStage2({...input,scheduledExecution:{deadlineAt:Date.now()+20000}})).toMatchObject({status:"failed",retryAfterMs:60000});
  });
  it("treats a truncated structured response as retryable without accepting partial JSON",async()=>{
    mocks.truncation.mockImplementation(()=>{throw new Error("Truncated output");});
    expect(await scoreStage2({...input,scheduledExecution:{deadlineAt:Date.now()+20000}})).toMatchObject({status:"failed",retryAfterMs:60000,failureReason:"Truncated output"});
  });
});
