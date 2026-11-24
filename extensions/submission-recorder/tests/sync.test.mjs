import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function fixture() {
  const data={config:{server:'https://talentos.test',apiKey:'tos_test',ownerId:'owner',instanceId:'browser',instanceName:'Work',candidateId:'candidate-a',candidateName:'A',enabled:true,sites:['https://forms.test/*']}};
  const records=new Map(),requests=[]; let reply=()=>{throw new Error('Offline');};
  const listener={addListener:()=>{}};
  const chrome={runtime:{id:'extension',getURL:path=>'chrome-extension://extension/'+path,onMessage:listener,onInstalled:listener,onStartup:listener},storage:{local:{
    get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,data[key]])),set:async updates=>Object.assign(data,updates)}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    tabs:{query:async()=>[]},alarms:{onAlarm:listener},permissions:{onRemoved:listener,contains:async()=>true},
    scripting:{getRegisteredContentScripts:async()=>[],registerContentScripts:async()=>{},unregisterContentScripts:async()=>{}}};
  const context=vm.createContext({chrome,URL,TextEncoder,AbortSignal,crypto,Map,Set,Date,fetch:async(url,options)=>{requests.push({url,options});return reply(url,options);}});
  vm.runInContext(await readFile(new URL('../background.js',import.meta.url),'utf8'),context);
  context.fakeStore=async(mode,action)=>{const request=action({put:item=>{records.set(item.id,item);return {result:item.id};},getAll:(_,limit)=>({result:[...records.values()].slice(0,limit)}),count:()=>({result:records.size}),delete:id=>records.delete(id)});return request?.result;};
  vm.runInContext('store = fakeStore',context);
  return {data,records,requests,context,setReply:fn=>reply=fn,handle:(message,sender={id:'extension',url:'chrome-extension://extension/popup.html'})=>context.handle(message,sender),sync:()=>context.sync()};
}
const page={id:'extension',tab:{id:1},url:'https://forms.test/application?private=token'};
const event={id:'event-a',profile_id:'candidate-a',value:'Answer A',label:'Question',field_key:'q',field_type:'text',event_type:'change',page_title:'Application',recorded_at:'2026-01-01T00:00:00Z'};

for (const inTab of [false,true]) test(`setup can connect and select a candidate in ${inTab?'an options tab':'the toolbar popup'}`,async()=>{
  const f=await fixture();
  f.data.config={};
  const sender={id:'extension',url:'chrome-extension://extension/popup.html',...(inTab?{tab:{id:10}}:{})};
  const people=[{id:'candidate-a',name:'Candidate A'}];
  f.setReply(async()=>({ok:true,json:async()=>({ownerUserId:'owner',candidates:people})}));
  assert.equal((await f.handle({type:'STATUS'},sender)).queued,0);
  await f.handle({type:'CONNECT',server:'https://talentos.test',apiKey:'tos_test',instanceName:'Work'},sender);
  assert.equal(f.data.config.ownerId,'owner');
  assert.equal((await f.handle({type:'STATUS'},sender)).config.apiKey,undefined);
  assert.deepEqual(await f.handle({type:'CANDIDATES'},sender),people);
  assert.deepEqual(Array.from(f.data.config.sites),['https://*/*']);
  await f.handle({type:'SELECT',id:'candidate-a'},sender);
  assert.equal(f.data.config.enabled,true);
  assert.equal(f.data.config.candidateId,'candidate-a');
});
test('webpages and other extensions cannot invoke setup controls',async()=>{
  const f=await fixture();
  for(const type of ['STATUS','CONNECT','SELECT','CANDIDATES']) {
    await assert.rejects(f.handle({type},page),/Unsupported page request/);
    await assert.rejects(f.handle({type},{id:'other',url:'chrome-extension://extension/popup.html',tab:{id:1}}),/Unsupported sender/);
    await assert.rejects(f.handle({type},{id:'extension',url:'chrome-extension://other/popup.html',tab:{id:1}}),/Unsupported sender/);
  }
  assert.equal(f.requests.length,0);
});

test('offline records keep candidate and connection; only acknowledged events leave queue',async()=>{
  const f=await fixture();
  await f.handle({type:'CAPTURE',event},page);
  assert.equal(f.records.size,1);assert.equal(f.data.syncError,'Offline');
  f.data.config.candidateId='candidate-b';
  f.setReply(async()=>({ok:true,json:async()=>({accepted:[],excluded:[],conflicts:['event-a']})}));
  await f.sync();assert.equal(f.records.size,1);
  assert.equal(JSON.parse(f.requests.at(-1).options.body).records[0].candidate_id,'candidate-a');
  assert.equal(f.records.get('event-a').record.page_url,'https://forms.test/application');
  f.setReply(async()=>({ok:true,json:async()=>({accepted:['event-a'],excluded:[],conflicts:[]})}));
  await f.sync();assert.equal(f.records.size,0);
});
test('rejected credentials pause capture and retain queued answers',async()=>{
  const f=await fixture();
  f.setReply(async()=>({ok:false,status:401,json:async()=>({error:{message:'Key revoked'}})}));
  await f.handle({type:'CAPTURE',event},page);
  assert.equal(f.records.size,1);assert.equal(f.data.config.enabled,false);
  await f.handle({type:'CAPTURE',event:{...event,id:'event-b'}},page);
  assert.equal(f.records.size,1);
});
test('different connection cannot receive pending entries or replace their owner',async()=>{
  const f=await fixture();await f.handle({type:'CAPTURE',event},page);
  await f.handle({type:'STOP'});
  f.setReply(async()=>({ok:true,json:async()=>({ownerUserId:'other',candidates:[]})}));
  await assert.rejects(f.handle({type:'CONNECT',server:'https://other.test',apiKey:'tos_other',instanceName:'Work'}),/Sync the queued records/);
  assert.equal(f.data.config.server,'https://talentos.test');
  f.data.config.server='https://other.test';const sent=f.requests.length;
  await f.sync();assert.equal(f.requests.length,sent);assert.equal(f.records.size,1);
});
test('recording locks candidate and credentials until Stop; queued answers remain with original person',async()=>{
  const f=await fixture();await f.handle({type:'CAPTURE',event},page);
  await assert.rejects(f.handle({type:'SELECT',id:'candidate-b'}),/Stop recording/);
  await assert.rejects(f.handle({type:'CONNECT',server:'https://other.test',apiKey:'tos_other',instanceName:'Work'}),/Stop recording/);
  assert.equal(f.data.config.candidateId,'candidate-a');
  await f.handle({type:'STOP'});
  assert.equal(f.data.config.enabled,false);
  await f.handle({type:'CAPTURE',event:{...event,id:'after-stop'}},page);
  assert.equal(f.records.size,1);
  f.setReply(async()=>({ok:true,json:async()=>({ownerUserId:'owner',candidates:[{id:'candidate-b',name:'B'}]})}));
  await f.handle({type:'SELECT',id:'candidate-b'});
  assert.equal(f.data.config.candidateId,'candidate-b');
  assert.equal(f.data.config.enabled,true);
  assert.equal(f.records.get('event-a').record.candidate_id,'candidate-a');
});
test('two open control pages cannot switch candidates during an active recording',async()=>{
  const f=await fixture();await f.handle({type:'STOP'});
  f.setReply(async()=>({ok:true,json:async()=>({ownerUserId:'owner',candidates:[{id:'candidate-a',name:'A'},{id:'candidate-b',name:'B'}]})}));
  const results=await Promise.allSettled([f.handle({type:'SELECT',id:'candidate-a'}),f.handle({type:'SELECT',id:'candidate-b'})]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.equal(f.data.config.candidateId,'candidate-a');
});
test('updates enable all HTTPS sites while preserving the current candidate and recording state',async()=>{
  const f=await fixture();await f.context.register();
  assert.deepEqual(Array.from(f.data.config.sites),['https://*/*']);
  assert.equal(f.data.config.enabled,true);assert.equal(f.data.config.candidateId,'candidate-a');
  await f.handle({type:'CAPTURE',event},{...page,url:'https://another-form.test/apply'});
  assert.equal(f.records.size,1);
});
test('late messages cannot be attributed to the newly selected candidate',async()=>{
  const f=await fixture();f.data.config.candidateId='candidate-b';
  await f.handle({type:'CAPTURE',event},page);assert.equal(f.records.size,0);
  f.data.config.candidateId='candidate-a';
  await f.handle({type:'CAPTURE',event},{...page,url:'https://talentos.test/admin/extension-keys'});assert.equal(f.records.size,0);
});
