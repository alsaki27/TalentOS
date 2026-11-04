import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {expect,it} from "vitest";
import {MatchEvidence} from "@/app/candidate-job-review/MatchEvidence";

it("shows exact evidence safely and leaves historical items without evidence readable",()=> {
  expect(renderToStaticMarkup(createElement(MatchEvidence,{}))).toBe("");
  const html=renderToStaticMarkup(createElement(MatchEvidence,{quality:{policyVersion:"precision-v1",reasons:[],assessment:{
    role_fit:"aligned",seniority_fit:"aligned",experience_fit:"meets",preferences_fit:"compatible",requirements:[
      {requirement:"CAD drafting",assessment:"met",jd_quote:"Use <script> rather than HTML.",resume_quote:"Prepared CAD drawings for OSP projects."},
    ]}}}));
  expect(html).toContain("Job requirement");expect(html).toContain("Resume evidence");
  expect(html).toContain("Prepared CAD drawings for OSP projects.");expect(html).not.toContain("<script>");
});
