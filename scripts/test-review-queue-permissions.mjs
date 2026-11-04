// Actual navigation/review components with synthetic APIs. No live decisions.
import assert from "node:assert/strict";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const built=await build({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import"./src/app/globals.css";import Nav from"./src/app/NavBar.tsx";import Review from"./src/app/candidate-job-review/page.tsx";createRoot(document.getElementById("root")).render(<><Nav/><main className="page"><Review/></main></>);',resolveDir:process.cwd(),loader:"jsx"},
  bundle:true,write:false,outdir:"fixture-build",platform:"browser",format:"iife",jsx:"automatic",logLevel:"silent",
  define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"fixture-shell",setup(b){
    b.onResolve({filter:/^next\/(link|navigation)$/},args=>({path:args.path,namespace:"fixture"}));
    b.onResolve({filter:/(ThemeToggle|NotificationBell)$/},()=>({path:"empty",namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="next/link"?'import React from"react";export default function Link({href,children,...p}){return React.createElement("a",{href,...p},children)}':args.path==="next/navigation"?'export const usePathname=()=>"/candidate-job-review";':'export default function Empty(){return null}',loader:"js",resolveDir:process.cwd()}));
  }}]});
const js=built.outputFiles.find(f=>f.path.endsWith(".js")).text;
const {css}=await postcss([tailwindcss({content:[{raw:js,extension:"js"}]} )]).process(built.outputFiles.find(f=>f.path.endsWith(".css")).text,{from:undefined});
const browser=await chromium.launch({headless:true});
const staffRoles=["admin","manager","application_engineer"];
const staff=staffRoles.map((role,i)=>({id:`staff-${i}`,name:`Fixture ${role}`,role}));
const review={id:"review-fixture",candidate_id:"candidate",candidate_name:"Fixture Candidate",job_id:"job",
  job_title:"Fixture Engineer",company:"Fixture Company",base_resume_id:"resume",base_resume_name:"Selected resume",
  assigned_to_user_id:staff[2].id,assigned_to_name:staff[2].name,source:"extension",status:"pending",ats_score:85,
  ai_status:"scored",ai_tier:"strong",ai_score:88,ai_reason:"Supported fit",hard_gates:[],alternate_resumes:[],created_at:"2026-11-04T02:00:00Z"};
let checks=0;
try {
  for(const role of staffRoles) for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:950}});
    const errors=[],mutations=[];let pending=true,aiPending=false;
    page.on("pageerror",e=>errors.push(e.message));
    page.on("dialog",dialog=>dialog.accept("Fixture rejection"));
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=="https://talentos.test")return route.abort();
      if(url.pathname==="/fixture.js")return route.fulfill({contentType:"text/javascript",body:js});
      if(url.pathname==="/fixture.css")return route.fulfill({contentType:"text/css",body:css});
      if(url.pathname==="/api/bootstrap")return route.fulfill({json:{profile:{display_name:"Fixture Staff",role}}});
      if(url.pathname==="/api/notifications")return route.fulfill({json:{queue:{overdue:0,pendingReview:0,urgent:0},candidateJobReview:{pending:7}}});
      if(url.pathname==="/api/admin/candidate-job-review")return route.fulfill({json:{
        items:pending?[{...review,...(aiPending?{ai_status:"pending",ai_tier:null,ai_score:null}:{})}]:[],
        counts:{pending:pending?1:0,approved:pending?0:1,rejected:0},pendingTiers:{strong:pending?1:0,adjacent:0,stretch:0},
        pagination:{page:1,pageSize:50,total:pending?1:0},filterOptions:{candidates:[{id:"candidate",name:"Fixture Candidate"}],staff},
      }});
      if(url.pathname.startsWith("/api/admin/candidate-job-review/") && route.request().method()==="POST") {
        mutations.push(url.pathname);if(url.pathname.endsWith("retry-ai"))aiPending=true;else pending=false;
        return route.fulfill({status:url.pathname.endsWith("retry-ai")?202:200,json:{ok:true,accepted:aiPending}});
      }
      if(url.pathname.startsWith("/api/"))throw new Error(`Unexpected API ${url.pathname}`);
      return route.fulfill({contentType:"text/html",body:'<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
    });
    await page.goto("https://talentos.test/candidate-job-review");
    await page.getByRole("button",{name:"Approve & start AI workflow",exact:true}).waitFor();
    const owner=page.getByLabel("Filter by staff owner");
    assert.ok((await owner.locator("option").allTextContents()).includes("Fixture application_engineer — Application Engineer"));
    if(width<600)await page.getByRole("button",{name:"Open menu",exact:true}).click();
    const navigation=page.locator(width<600?".mob-panel":".nav-desktop-links");
    await navigation.getByRole("link",{name:/Review Queue/}).waitFor();
    assert.match(await navigation.getByRole("link",{name:/Review Queue/}).textContent(),/7/);
    await navigation.getByRole("button",{name:/^More/}).click();
    assert.equal(await navigation.getByRole("link",{name:"Scheduled Candidate Logging",exact:true}).count(),role==="application_engineer"?0:1);
    if(width<600)await page.getByRole("button",{name:"Close menu",exact:true}).click();
    else await navigation.getByRole("button",{name:/^More/}).click();
    assert.equal(await page.getByRole("button",{name:"Reject",exact:true}).isEnabled(),true);
    await page.getByRole("button",{name:"Approve & start AI workflow",exact:true}).click();
    await page.getByText("Nothing in this view",{exact:true}).waitFor();
    assert.equal(mutations.length,1);assert.ok(mutations[0].endsWith("/approve"));
    pending=true;await page.reload();
    await page.getByRole("button",{name:"Reject",exact:true}).click();
    await page.getByText("Nothing in this view",{exact:true}).waitFor();
    assert.equal(mutations.length,2);assert.ok(mutations[1].endsWith("/reject"));
    assert.deepEqual(errors,[]);checks++;
    await page.close();
  }
  console.log(`Review permissions UI passed: ${checks} role/viewport combinations; desktop/mobile navigation, AE badge/filter label, approve/reject, and restricted automation navigation. Synthetic APIs only.`);
}finally{await browser.close();}
