import {describe,expect,it} from "vitest";
import {parseCandidateReviewFilters,candidateReviewFilterSql} from "@/lib/candidateReviewFilters";
const candidate="11111111-1111-4111-8111-111111111111",staff="22222222-2222-4222-8222-222222222222";
describe("Review Queue filter contract",()=>{
  it("defaults to pending with no restrictions",()=>{
    const filters=parseCandidateReviewFilters(new URLSearchParams());
    expect(filters).toMatchObject({status:"pending",source:"all",tier:"all",page:1});
    expect(candidateReviewFilterSql(filters)).toEqual({where:"true",values:[]});
  });
  it("combines candidate, owner, source, tier, and inclusive timestamps with AND",()=>{
    const filters=parseCandidateReviewFilters(new URLSearchParams({candidate_id:candidate,staff_id:staff,source:"extension",tier:"strong",start:"2026-11-04T05:00:00+06:00",end:"2026-11-04T09:00:00+06:00"}));
    const sql=candidateReviewFilterSql(filters,2);
    expect(sql.values).toEqual([candidate,staff,"extension","strong","2026-11-03T23:00:00.000Z","2026-11-04T03:00:00.000Z"]);
    expect(sql.where).toContain("q.created_at >= $6::timestamptz");
    expect(sql.where).toContain("q.created_at <= $7::timestamptz");
    expect(sql.where).not.toContain(candidate);
    expect(sql.where.split(" AND ")).toHaveLength(6);
  });
  it("supports unassigned owners and distinguishes AI-unavailable from scored rejections",()=>{
    const sql=candidateReviewFilterSql(parseCandidateReviewFilters(new URLSearchParams({staff_id:"unassigned",tier:"unscored"})));
    expect(sql.where).toBe("q.assigned_to_user_id IS NULL AND q.ai_status <> 'scored'");expect(sql.values).toEqual([]);
  });
  it.each(["start","end"])("accepts an open-ended %s range",key=>{
    const filters=parseCandidateReviewFilters(new URLSearchParams({[key]:"2026-11-04T00:00:00Z"}));
    expect(candidateReviewFilterSql(filters).values).toEqual(["2026-11-04T00:00:00.000Z"]);
  });
  it("accepts exact equal start/end instants",()=>{
    expect(()=>parseCandidateReviewFilters(new URLSearchParams({start:"2026-11-04T05:00:00+06:00",end:"2026-11-03T23:00:00Z"}))).not.toThrow();
  });
  it.each([
    {candidate_id:"' OR true --"},{staff_id:"other"},{status:"deleted"},{source:"unknown"},{tier:"reject"},
    {page:"0"},{page:"1.5"},{page:"Infinity"},{start:"2026-11-04T05:00"},
    {start:"2026-02-30T00:00:00Z"},{end:"not-a-time"},
    {start:"2026-11-05T00:00:00Z",end:"2026-11-04T00:00:00Z"},
  ])("rejects invalid or ambiguous filters: %j",params=>{
    expect(()=>parseCandidateReviewFilters(new URLSearchParams(params))).toThrow();
  });
});
