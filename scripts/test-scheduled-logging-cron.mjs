// Exercise the actual Worker entry with intercepted fetches. No live endpoints.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {build} from "esbuild";

const built=await build({entryPoints:["worker-entry.mjs"],bundle:true,write:false,platform:"node",format:"cjs",
  plugins:[{name:"opennext-fixture",setup(builder){
    builder.onResolve({filter:/\.open-next\/worker\.js$/},()=>({path:"worker",namespace:"fixture"}));
    builder.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export default {fetch(){return new Response('fixture')}}"}));
  }}],
});
const calls=[];
let failLogging=false,failReview=false;
const module={exports:{}};
const context=vm.createContext({module,exports:module.exports,Request,Response,Headers,AbortSignal,URL,Date,setTimeout,clearTimeout,
  process:{env:{}},console:{log(){},warn(){},error(){}},fetch:async(url,options)=>{
    calls.push({url:String(url),options});
    return new Response(JSON.stringify({ok:true}),{status:(failLogging&&String(url).includes("scheduled-candidate-logging"))||(failReview&&String(url).includes("candidate-review-ai"))?500:200});
  },
});
vm.runInContext(built.outputFiles[0].text,context);
const worker=module.exports.default;
const env={CRON_SECRET:"fixture-cron-secret",TALENTOS_BASE_URL:"https://talentos.test"};
const invoke=async(cron,time)=>{calls.length=0;await worker.scheduled({cron,scheduledTime:Date.parse(time)},env);};
await invoke("0 23 * * *","2026-11-03T23:00:00Z");
assert.equal(calls.length,1);
assert.equal(calls[0].options.headers["X-Scheduled-Logging-Trigger"],"daily");
assert.equal(calls[0].options.headers.Authorization,"Bearer fixture-cron-secret");
await invoke("* * * * *","2026-11-04T02:10:00Z");
assert.equal(calls.filter(c=>c.url.endsWith("/api/cron/scheduled-candidate-logging")).length,1);
assert.ok(calls.some(c=>c.url.endsWith("/api/application-ai-workflows/dispatch")),"existing resume dispatcher must remain scheduled");
assert.ok(calls.some(c=>c.url.endsWith("/api/cron/job-agent-poll")),"existing Apify poll must remain scheduled");
assert.equal(calls.filter(c=>c.url.endsWith("/api/cron/candidate-review-ai")).length,1,"extension AI recovery has an independent minute tick");
assert.equal(calls.find(c=>c.url.endsWith("scheduled-candidate-logging")).options.headers["X-Scheduled-Logging-Trigger"],"tick");
await invoke("0 18 * * *","2026-11-03T18:00:00Z");
assert.ok(calls.some(c=>c.url.endsWith("/api/cron/job-agent")));
assert.ok(!calls.some(c=>c.url.endsWith("scheduled-candidate-logging")));
await invoke("5 18 * * *","2026-11-03T18:05:00Z");
assert.ok(calls.some(c=>c.url.endsWith("/api/cron/job-agent-retention")));
failLogging=true;
await assert.rejects(invoke("* * * * *","2026-11-04T02:10:00Z"),/Scheduled candidate logging tick failed/);
assert.ok(calls.some(c=>c.url.endsWith("/api/application-ai-workflows/dispatch")),"one failed task must not prevent unrelated dispatches");
failLogging=false;failReview=true;
await assert.rejects(invoke("* * * * *","2026-11-04T02:10:00Z"),/Review AI recovery failed/);
assert.ok(calls.some(c=>c.url.endsWith("/api/cron/scheduled-candidate-logging")),"review scoring failure must not suppress scheduled matching");
assert.ok(calls.some(c=>c.url.endsWith("/api/application-ai-workflows/dispatch")),"review scoring failure must not suppress resume dispatch");
const config=readFileSync("wrangler.toml","utf8");
assert.match(config,/crons\s*=\s*\[.*"\* \* \* \* \*".*"0 23 \* \* \*"/);
const github=readFileSync(".github/workflows/scheduled-candidate-logging.yml","utf8");
assert.doesNotMatch(github,/^\s+schedule:\s*$/m,"Cloudflare must be the only daily scheduler");
assert.match(github,/workflow_dispatch:/);
assert.match(github,/X-Scheduled-Logging-Request-Id: github-\$\{GITHUB_RUN_ID\}/);
assert.doesNotMatch(github,/max-time 1200/);
console.log("Cron fixture passed: 05:00 BDT trigger, minute catch-up, existing dispatch/poll/nightly/retention preserved, failure isolation, manual GitHub acceptance and stable idempotency. No live requests.");
