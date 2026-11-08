import { describe, expect, it, vi } from "vitest";
import { parseScheduledAssessment, scheduledJobQualityReasons, scheduledSuggestionQuality, type ScheduledMatchAssessment } from "@/lib/scheduledMatchQuality";
import { parsePrecisionEligibilityResponse } from "@/server/services/candidateJobScoring";

vi.mock("@/server/db/neon", () => ({query: vi.fn()}));
const JD = "Prepare OSP construction drawings using AutoCAD. Maintain GIS records and verify field measurements. Coordinate drawing revisions with the engineering team. ".repeat(5);
const RESUME = "Prepared OSP construction drawings using AutoCAD for fiber projects. Maintained GIS records and verified field measurements. Coordinated drawing revisions with the engineering team.";
function assessment(): ScheduledMatchAssessment {
  return {role_fit:"aligned",seniority_fit:"aligned",experience_fit:"meets",preferences_fit:"compatible",requirements:[
    {requirement:"OSP drafting",assessment:"met",jd_quote:"Prepare OSP construction drawings using AutoCAD.",resume_quote:"Prepared OSP construction drawings using AutoCAD for fiber projects."},
    {requirement:"GIS record maintenance",assessment:"met",jd_quote:"Maintain GIS records and verify field measurements.",resume_quote:"Maintained GIS records and verified field measurements."},
    {requirement:"Revision coordination",assessment:"met",jd_quote:"Coordinate drawing revisions with the engineering team.",resume_quote:"Coordinated drawing revisions with the engineering team."},
  ]};
}
function result() { return {tier:"strong",score:92,reason:"Relevant OSP duties are documented.",hard_gates:[],assessment:assessment()}; }
const admit = (a = assessment()) => scheduledSuggestionQuality({tier:"strong",score:92,hardGates:[],assessment:a});

describe("automated recommendation admission", () => {
  it("admits an evidenced entry-level OSP/CAD match", () => {
    const parsed=parsePrecisionEligibilityResponse(JSON.stringify(result()),JD,RESUME);
    expect(admit(parsed.assessment).reasons).toEqual([]);
  });
  it.each(["adjacent","stretch","reject"])("does not queue %s merely because keywords overlap",tier=> {
    expect(scheduledSuggestionQuality({tier,score:98,hardGates:[],assessment:assessment()}).reasons.length).toBeGreaterThan(0);
  });
  it.each([0,70,84,NaN])("does not admit a Strong claim scoring %s",score=> {
    expect(scheduledSuggestionQuality({tier:"strong",score,hardGates:[],assessment:assessment()}).reasons.length).toBeGreaterThan(0);
  });
  it("admits the 85 boundary only with all evidence and dimensions passing",()=> {
    expect(scheduledSuggestionQuality({tier:"strong",score:85,hardGates:[],assessment:assessment()}).reasons).toEqual([]);
  });
  it.each([
    ["seniority_fit","mismatch","junior applicant against director or manager ownership"],
    ["experience_fit","shortfall","two years against five mandatory relevant years"],
    ["role_fit","mismatch","CAD experience against a finance role"],
    ["preferences_fit","conflict","explicit location or employment conflict"],
    ["experience_fit","unknown","undocumented mandatory experience"],
  ])("blocks %s=%s (%s)",(key,value)=> {
    expect(admit({...assessment(),[key]:value} as ScheduledMatchAssessment).reasons.length).toBeGreaterThan(0);
  });
  it("blocks missing mandatory credentials even with a 99 model score",()=> {
    expect(scheduledSuggestionQuality({tier:"strong",score:99,hardGates:["Required PE license is not documented."],assessment:assessment()}).reasons).toContain("Required PE license is not documented.");
  });
  it("blocks an omitted assessment and an unmet core requirement",()=> {
    expect(scheduledSuggestionQuality({tier:"strong",score:99,hardGates:[]}).reasons.length).toBeGreaterThan(0);
    const a=assessment();a.requirements[0].assessment="unknown";
    expect(admit(a).reasons.length).toBeGreaterThan(0);
  });
});

describe("evidence validation",()=> {
  it("rejects invented resume and job quotes",()=> {
    for(const field of ["resume_quote","jd_quote"] as const) {
      const a=assessment();a.requirements[0][field]="This invented certification is not in the input.";
      expect(()=>parseScheduledAssessment(a,JD,RESUME)).toThrow(/quote/);
    }
  });
  it("rejects repeated evidence, missing requirements, malformed arrays, and string scores",()=> {
    const a=assessment();a.requirements[1].jd_quote=a.requirements[0].jd_quote;
    expect(()=>parseScheduledAssessment(a,JD,RESUME)).toThrow(/duplicate/);
    expect(()=>parseScheduledAssessment({...assessment(),requirements:[]},JD,RESUME)).toThrow();
    expect(()=>parsePrecisionEligibilityResponse(JSON.stringify({...result(),score:"92"}),JD,RESUME)).toThrow();
    expect(()=>parsePrecisionEligibilityResponse(JSON.stringify({...result(),hard_gates:"none"}),JD,RESUME)).toThrow();
  });
  it("accepts whitespace differences but never paraphrased evidence",()=> {
    const a=assessment();a.requirements[0].resume_quote="Prepared OSP construction drawings\nusing AutoCAD for fiber projects.";
    expect(parseScheduledAssessment(a,JD,RESUME).requirements).toHaveLength(3);
    a.requirements[0].resume_quote="Designed complex OSP networks and supervised engineers.";
    expect(()=>parseScheduledAssessment(a,JD,RESUME)).toThrow();
  });
  it("cannot omit mandatory experience or claim it was not stated",()=> {
    expect(()=>parseScheduledAssessment(assessment(),`${JD} Minimum 5 years of GIS administration experience required.`,RESUME)).toThrow(/mandatory/);
    const a=assessment();a.experience_fit="not_stated";
    a.requirements[0].jd_quote="Minimum 5 years of GIS administration experience required.";
    expect(()=>parseScheduledAssessment(a,`${JD} Minimum 5 years of GIS administration experience required.`,RESUME)).toThrow(/not stated/);
  });
  it("cannot cover an experience clause by quoting only its easy duty",()=> {
    const jd=JD.replace("Prepare OSP construction drawings using AutoCAD.","Prepare OSP construction drawings using AutoCAD with minimum 5 years experience required.");
    expect(()=>parseScheduledAssessment(assessment(),jd,RESUME)).toThrow(/mandatory/);
    expect(()=>parseScheduledAssessment(assessment(),`${JD} No security clearance is required.`,RESUME)).not.toThrow();
  });
});

describe("publisher job quality",()=> {
  const job={title:"OSP CAD Technician",company:"Example Engineering",posted_at:"2026-11-04"};
  const now=new Date("2026-11-04T03:00:00Z");
  it("accepts a current complete posting",()=>expect(scheduledJobQualityReasons(job,JD,7,now)).toEqual([]));
  it.each([null,"not a date","2026-01-01","2026-11-05"])("blocks missing/stale/future publisher date %s",posted_at=> {
    expect(scheduledJobQualityReasons({...job,posted_at},JD,7,now).length).toBeGreaterThan(0);
  });
  it("does not promote a thin description or missing employer",()=> {
    expect(scheduledJobQualityReasons({...job,company:null},"CAD job",7,now)).toHaveLength(2);
  });
});
