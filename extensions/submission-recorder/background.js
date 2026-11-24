let databasePromise, syncing;
function database() {
  return databasePromise ||= new Promise((resolve,reject) => {
    const request = indexedDB.open('talentos-submission-recorder',1);
    request.onupgradeneeded = () => request.result.createObjectStore('records',{keyPath:'id'});
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function store(mode,action) {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('records',mode), request = action(tx.objectStore('records'));
    tx.oncomplete = () => resolve(request?.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
const config = async () => (await chrome.storage.local.get('config')).config || {};
function safeServer(value) {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Use your HTTPS TalentOS address.');
  return url.origin;
}
async function api(c,path,options={}) {
  const response = await fetch(c.server+'/api/extension/v1/submission-records'+path, {
    ...options, headers:{Authorization:`Bearer ${c.apiKey}`,'Content-Type':'application/json','X-TalentOS-Client':'submission-recorder/2.0.0'}, signal:AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error?.message || `TalentOS returned ${response.status}.`); error.status=response.status; throw error; }
  return data;
}
async function badge() {
  const c = await config(), {syncError} = await chrome.storage.local.get('syncError');
  await chrome.action.setBadgeText({text:syncError?'!':c.enabled&&c.candidateId?'REC':'OFF'});
  await chrome.action.setBadgeBackgroundColor({color:syncError?'#b54708':c.enabled?'#176b52':'#64748b'});
  await chrome.action.setTitle({title:syncError?`TalentOS recorder: ${syncError}`:c.enabled?`Recording for ${c.candidateName}`:'TalentOS recorder paused'});
}
async function context() {
  const c = await config();
  return {enabled:!!c.enabled,profileId:c.candidateId,profileName:c.candidateName,server:c.server,sites:c.sites||[]};
}
async function notifyTabs() {
  const state = await context();
  for (const tab of await chrome.tabs.query({})) if (tab.id) chrome.tabs.sendMessage(tab.id,{type:'CONTEXT',state}).catch(() => {});
  await badge();
}
async function register() {
  const c = await config(), matches = [];
  for (const site of c.sites||[]) if (await chrome.permissions.contains({origins:[site]})) matches.push(site);
  if (matches.length !== (c.sites||[]).length) {
    await chrome.storage.local.set({config:{...c,sites:matches,enabled:!!c.enabled && matches.length>0}});
  }
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  if (scripts.some(script => script.id === 'recorder')) await chrome.scripting.unregisterContentScripts({ids:['recorder']});
  if (matches.length) await chrome.scripting.registerContentScripts([{id:'recorder',matches,js:['content.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true}]);
  for (const tab of await chrome.tabs.query({})) if (tab.id && matches.length) {
    await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']}).catch(() => {});
  }
}
async function candidates(c) {
  const data = await api(c,'/candidates');
  if (!Array.isArray(data.candidates) || typeof data.ownerUserId !== 'string') throw new Error('This TalentOS server does not support the recorder yet.');
  return data;
}
async function sync() {
  if (syncing) return syncing;
  syncing = (async () => {
    const c = await config(); if (!c.apiKey) return;
    try {
      const pending = await store('readonly',s => s.getAll(null,50));
      if (pending.length) {
        let bytes=0; const records=[];
        for (const item of pending) {
          if (item.server !== c.server || item.ownerId !== c.ownerId) throw new Error('Queued records belong to a different TalentOS connection. They have not been sent.');
          const size = new TextEncoder().encode(JSON.stringify(item.record)).length;
          if (records.length && bytes+size>1000000) break;
          records.push(item.record); bytes+=size;
        }
        const data = await api(c,'',{method:'POST',body:JSON.stringify({records})});
        if (!Array.isArray(data.accepted) || !Array.isArray(data.excluded)) throw new Error('TalentOS did not acknowledge the records; they remain queued.');
        const sentIds = new Set(records.map(record=>record.id));
        await store('readwrite',s => { for (const id of [...data.accepted,...data.excluded]) if(sentIds.has(id))s.delete(id); });
        await chrome.storage.local.set({lastSync:new Date().toISOString()});
        if (data.conflicts?.length) throw new Error('Some records were not accepted. They remain queued; check candidate access or contact your administrator.');
      }
      await chrome.storage.local.set({syncError:null});
    } catch(error) {
      await chrome.storage.local.set({syncError:error.message});
      if ([401,403,409].includes(error.status)) {
        // Do not keep collecting after a revoked key or unavailable candidate.
        const current = await config();
        if (current.apiKey===c.apiKey) { await chrome.storage.local.set({config:{...current,enabled:false}}); await notifyTabs(); }
      }
    }
    await badge();
  })().finally(() => syncing=null);
  return syncing;
}
function allowed(url,c) {
  try { const u = new URL(url); if (u.origin === new URL(c.server).origin) return false;
    return (c.sites||[]).some(site => site==='https://*/*'?u.protocol==='https:':site===u.origin+'/*');
  } catch { return false; }
}
async function handle(message,sender) {
  const c = await config();
  if (sender.tab) {
    if (message.type==='CONTEXT') return context();
    if (message.type!=='CAPTURE') throw new Error('Unsupported page request.');
    const e=message.event;
    if (!c.enabled || !c.candidateId || e.profile_id!==c.candidateId || !allowed(sender.url,c)) return {skipped:true};
    if (typeof e.value!=='string' || e.value.length>100000) throw new Error('Answer exceeds 100,000 characters; it was not recorded.');
    const u=new URL(sender.url);
    const record={id:e.id,candidate_id:e.profile_id,instance_id:c.instanceId,instance_name:c.instanceName,recorded_at:e.recorded_at,
      page_url:u.origin+u.pathname,page_title:e.page_title,field_key:e.field_key,question:e.label,answer:e.value,field_type:e.field_type,event_type:e.event_type};
    await store('readwrite',s=>s.put({id:e.id,server:c.server,ownerId:c.ownerId,record}));
    await sync(); return {saved:true};
  }
  if (sender.id!==chrome.runtime.id) throw new Error('Unsupported sender.');
  switch(message.type) {
    case 'STATUS': return {config:{...c,apiKey:undefined},queued:await store('readonly',s=>s.count()),...await chrome.storage.local.get(['syncError','lastSync'])};
    case 'CONNECT': {
      const server=safeServer(message.server), apiKey=String(message.apiKey||'').trim(), instanceName=String(message.instanceName||'').trim();
      if (!apiKey.startsWith('tos_') || apiKey.length>200) throw new Error('Paste a TalentOS extension API key beginning with tos_.');
      if (!instanceName || instanceName.length>120) throw new Error('Name this browser / computer (up to 120 characters).');
      const data=await candidates({server,apiKey});
      if ((c.server && c.server!==server || c.ownerId && c.ownerId!==data.ownerUserId) && await store('readonly',s=>s.count())) throw new Error('Sync the queued records before connecting a different server or team member.');
      const sameConnection=c.server===server && c.ownerId===data.ownerUserId;
      const selected=sameConnection?data.candidates.find(person=>person.id===c.candidateId):null;
      await chrome.storage.local.set({config:{server,apiKey,ownerId:data.ownerUserId,instanceId:c.instanceId||crypto.randomUUID(),instanceName,
        candidateId:selected?.id,candidateName:selected?.name,enabled:false,sites:c.sites||[]},candidates:data.candidates,syncError:null});
      await notifyTabs(); return {ok:true};
    }
    case 'CANDIDATES': {
      const data=await candidates(c); await chrome.storage.local.set({candidates:data.candidates}); return data.candidates;
    }
    case 'SELECT': {
      const data=await candidates(c), selected=data.candidates.find(person=>person.id===message.id);
      if (!selected) throw new Error('This candidate is no longer available to your key.');
      if (!(c.sites||[]).length) throw new Error('Enable a recording website first.');
      await chrome.storage.local.set({config:{...c,candidateId:selected.id,candidateName:selected.name,enabled:true},syncError:null});
      await notifyTabs(); return {ok:true};
    }
    case 'TOGGLE':
      if (!c.candidateId) throw new Error('Choose a candidate first.');
      if (!c.enabled) { const data=await candidates(c); if (!data.candidates.some(person=>person.id===c.candidateId)) throw new Error('The selected candidate is unavailable.'); }
      await chrome.storage.local.set({config:{...c,enabled:!c.enabled}}); await notifyTabs(); return {ok:true};
    case 'ADD_SITE':
      if (!/^https:\/\/(\*|[^/]+)\/\*$/.test(message.origin)) throw new Error('Choose an HTTPS website.');
      if (!await chrome.permissions.contains({origins:[message.origin]})) throw new Error('Site permission was not granted.');
      await chrome.storage.local.set({config:{...c,sites:[...new Set([...(c.sites||[]),message.origin])]}});
      await register(); await notifyTabs(); return {ok:true};
    case 'CLEAR_SITES':
      await chrome.storage.local.set({config:{...c,sites:[],enabled:false}}); await register(); await notifyTabs(); return {ok:true};
    case 'SYNC': await sync(); return {ok:true};
    default: throw new Error('Unknown action.');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  handle(message,sender).then(data=>respond({data})).catch(async error=>{
    if (sender.tab && message.type==='CAPTURE') { await chrome.storage.local.set({syncError:error.message}); await badge(); }
    respond({error:error.message});
  }); return true;
});
async function init() {
  await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  await chrome.alarms.create('sync',{periodInMinutes:0.5});
  await register(); await badge(); await sync();
}
chrome.runtime.onInstalled.addListener(()=>{init();chrome.runtime.openOptionsPage();});
chrome.runtime.onStartup.addListener(()=>init());
chrome.alarms.onAlarm.addListener(()=>sync());
chrome.permissions.onRemoved.addListener(async()=>{await register();await notifyTabs();});
