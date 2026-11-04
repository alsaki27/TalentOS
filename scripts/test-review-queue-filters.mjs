// Real page + synthetic APIs only. Never approve live records or call AI.
import assert from "node:assert/strict";
import {build} from "esbuild";
import {chromium} from "@playwright/test";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
const ownerA="33333333-3333-4333-8333-333333333333",ownerB="44444444-4444-4444-8444-444444444444";
const base={candidate_id:a,candidate_name:"Candidate Alpha",assigned_to_user_id:ownerA,assigned_to_name:"Staff Alpha",
  source:"scheduled_logging",status:"pending",ai_status:"scored",ai_tier:"strong",ats_score:80,ai_score:85,
  job_id:"job",job_title:"Design Engineer",company:"Fixture Company",base_resume_id:"resume",base_resume_name:"Draft resume",
  alternate_resumes:[],hard_gates:[],ai_reason:"Evidence-based match.",created_at:"2026-11-04T02:00:00Z",application_id:null};
const beta={candidate_id:b,candidate_name:"Candidate Beta",assigned_to_user_id:ownerB,assigned_to_name:"Staff Beta",source:"extension",ai_tier:"adjacent"};
const items=[
  {...base,id:"alpha"},
  {...base,...beta,id:"start-boundary",created_at:"2026-11-04T03:00:00Z"},
  {...base,...beta,id:"end-boundary",created_at:"2026-11-04T04:00:00Z"},
  {...base,...beta,id:"too-late",created_at:"2026-11-04T04:00:01Z"},
  {...base,...beta,id:"other-owner",assigned_to_user_id:ownerA},
  {...base,...beta,id:"other-candidate",candidate_id:a,candidate_name:"Candidate Alpha"},
  {...base,...beta,id:"unassigned",assigned_to_user_id:null,assigned_to_name:null,ai_status:"failed",ai_tier:null},
  {...base,id:"approved",status:"approved",application_id:"application-fixture"},
  {...base,id:"rejected",status:"rejected"},
  ...Array.from({length:55},(_,i)=>({...base,id:`filler-${i}`,created_at:"2026-11-03T20:00:00Z"})),
];
const built=await build({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import"./src/app/globals.css";import Page from"./src/app/candidate-job-review/page.tsx";createRoot(document.getElementById("root")).render(React.createElement(Page));',resolveDir:process.cwd(),loader:"jsx"},
  bundle:true,write:false,outdir:"fixture-build",platform:"browser",format:"iife",jsx:"automatic",logLevel:"silent",
  define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"link-fixture",setup(builder){
    builder.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"fixture"}));
    builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'import React from"react";export default function Link({href,children,...p}){return React.createElement("a",{href,...p},children)}',loader:"js",resolveDir:process.cwd()}));
  }}]});
const script=built.outputFiles.find(f=>f.path.endsWith(".js")).text;
const rawCss=built.outputFiles.find(f=>f.path.endsWith(".css")).text;
const {css}=await postcss([tailwindcss({content:[{raw:script,extension:"js"}],corePlugins:{preflight:true}})]).process(rawCss,{from:undefined});
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({timezoneId:"Asia/Dhaka"});
  let requests=0,bulkBody=null;
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());if(url.origin!=="https://talentos.test")return route.abort();
    if(url.pathname==="/fixture.js")return route.fulfill({contentType:"text/javascript",body:script});
    if(url.pathname==="/fixture.css")return route.fulfill({contentType:"text/css",body:css});
    if(url.pathname.endsWith("/bulk-approve")) {bulkBody=route.request().postDataJSON();return route.fulfill({json:{approved:0,failed:[]}});}
    if(url.pathname==="/api/admin/candidate-job-review") {
      requests++;const p=url.searchParams;
      const filtered=items.filter(item=>(!p.get("candidate_id")||item.candidate_id===p.get("candidate_id"))
        &&(!p.get("staff_id")||(p.get("staff_id")==="unassigned"?!item.assigned_to_user_id:item.assigned_to_user_id===p.get("staff_id")))
        &&(!p.get("source")||p.get("source")==="all"||item.source===p.get("source"))
        &&(!p.get("tier")||p.get("tier")==="all"||(p.get("tier")==="unscored"?item.ai_status!=="scored":item.ai_tier===p.get("tier")))
        &&(!p.get("start")||Date.parse(item.created_at)>=Date.parse(p.get("start")))
        &&(!p.get("end")||Date.parse(item.created_at)<=Date.parse(p.get("end"))));
      const counts={pending:0,approved:0,rejected:0},pendingTiers={strong:0,adjacent:0,stretch:0};
      for(const item of filtered){counts[item.status]++;if(item.status==="pending"&&item.ai_tier)pendingTiers[item.ai_tier]++;}
      const matched=filtered.filter(item=>p.get("status")==="all"||item.status===(p.get("status")||"pending"));
      const currentPage=Math.min(Number(p.get("page")||1),Math.max(1,Math.ceil(matched.length/50)));
      return route.fulfill({json:{items:matched.slice((currentPage-1)*50,currentPage*50),counts,pendingTiers,
        pagination:{page:currentPage,pageSize:50,total:matched.length},filterOptions:{candidates:[{id:a,name:"Candidate Alpha"},{id:b,name:"Candidate Beta"}],staff:[{id:ownerA,name:"Staff Alpha"},{id:ownerB,name:"Staff Beta"}]}}});
    }
    if(url.pathname.startsWith("/api/"))throw new Error("Unexpected mutation in filter fixture");
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><main class="page"><div id="root"></div></main><script src="/fixture.js"></script></body></html>'});
  });
  await page.goto("https://talentos.test/candidate-job-review");
  await page.getByText("Page 1 of 2",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await page.getByText("Page 2 of 2",{exact:true}).waitFor();
  await page.getByLabel("Filter by candidate").selectOption(b);
  await page.getByText("Page 1 of 1",{exact:true}).waitFor();
  assert.equal(await page.locator("section.card").count(),5);
  await page.getByLabel("Filter by staff owner").selectOption(ownerB);
  await page.getByLabel("Filter by source").selectOption("extension");
  await page.getByLabel("Filter by AI tier").selectOption("adjacent");
  await page.getByLabel("Queued from").fill("2026-11-04T09:00");
  await page.getByLabel("Queued until").fill("2026-11-04T10:00");
  await page.getByText("1–2 of 2 matching results",{exact:true}).waitFor();
  assert.equal(await page.locator("section.card").count(),2,"inclusive start/end timestamps must be included");
  await page.getByText(/Queued time in Asia\/Dhaka/).waitFor();
  await page.getByRole("button",{name:"Strong + Adjacent (2)",exact:true}).click();
  await page.getByText("Approved 0 item(s).",{exact:true}).waitFor();
  const scope=new URLSearchParams(bulkBody.filters);
  assert.equal(scope.get("candidate_id"),b);assert.equal(scope.get("staff_id"),ownerB);
  assert.equal(scope.get("start"),"2026-11-04T03:00:00.000Z");assert.equal(scope.get("end"),"2026-11-04T04:00:00.000Z");
  const beforeInvalid=requests;
  await page.getByLabel("Queued until").fill("2026-11-04T08:00");
  await page.getByRole("alert").filter({hasText:"Start time must be"}).waitFor();
  assert.equal(requests,beforeInvalid,"invalid ranges must not reach the API");
  assert.ok(await page.getByRole("button",{name:/Strong \+ Adjacent/}).isDisabled());
  await page.getByRole("button",{name:"Clear filters",exact:true}).click();
  await page.getByText("Page 1 of 2",{exact:true}).waitFor();
  await page.getByLabel("Filter by staff owner").selectOption("unassigned");
  await page.getByLabel("Filter by AI tier").selectOption("unscored");
  await page.getByText("1–1 of 1 matching results",{exact:true}).waitFor();
  assert.equal(await page.locator("section.card").count(),1);
  await page.getByRole("button",{name:"Clear filters",exact:true}).click();
  await page.getByRole("button",{name:"Approved",exact:false}).filter({has:page.locator(".stat-label")}).click();
  await page.getByText("1–1 of 1 matching results",{exact:true}).waitFor();
  await page.getByRole("button",{name:"All",exact:false}).filter({has:page.locator(".stat-label")}).click();
  await page.getByText("Page 1 of 2",{exact:true}).waitFor();
  for(const width of [320,390,768,1440])for(const dark of [false,true]) {
    await page.setViewportSize({width,height:900});await page.evaluate(dark=>document.documentElement.classList.toggle("dark",dark),dark);
    assert.deepEqual(await page.evaluate(()=>Array.from(document.querySelectorAll(".candidate-job-review-page input,.candidate-job-review-page select,.candidate-job-review-page label,.candidate-job-review-page nav")).filter(node=>{const r=node.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;}).map(node=>node.tagName)),[],`filter controls overflow at ${width}/${dark}`);
  }
  assert.deepEqual(errors,[]);
  console.log("Review filters browser fixture passed: combined filters, BDT/UTC boundaries, open/invalid ranges, pagination/reset, scoped bulk approval, unassigned/ATS-only, status tabs, clear, and 8 responsive/theme combinations. No live mutations.");
} finally {await browser.close();}
