const $=id=>document.getElementById(id);
async function call(type,data={}) { const result=await chrome.runtime.sendMessage({type,...data}); if(result.error)throw new Error(result.error); return result.data; }
async function refresh(loadCandidates=true) {
  const s=await call('STATUS'),c=s.config;
  $('setup').hidden=!!c.ownerId; $('record').hidden=!c.ownerId;
  if(!c.ownerId)return;
  $('active').textContent=c.enabled?`Recording: ${c.candidateName}`:'Recording paused';$('toggle').textContent=c.enabled?'Pause':'Resume';
  $('sites').textContent=c.sites?.includes('https://*/*')?'All HTTPS websites enabled':c.sites?.join(', ')||'Choose websites below before starting.';
  $('syncState').textContent=`${s.queued} entries queued. ${s.syncError || (s.lastSync?'Last sync '+new Date(s.lastSync).toLocaleString():'No entries synced yet.')}`;
  $('candidateLink').hidden=!c.candidateId;
  if(c.candidateId)$('candidateLink').href=c.server+'/candidates/'+encodeURIComponent(c.candidateId)+'?tab=Submission%20Records';
  if(loadCandidates){
    try { const people=await call('CANDIDATES');$('candidates').replaceChildren(new Option('Choose a TalentOS candidate',''));
      for(const person of people)$('candidates').add(new Option(`${person.name} · ${person.id.slice(0,8)}`,person.id));$('candidates').value=c.candidateId||'';
    }catch(e){$('message').textContent=e.message;}
  }
}
function action(id,fn,reload=true) { $(id).onclick=async()=>{const button=$(id);button.disabled=true;$('message').textContent='';try{await fn();if(reload)await refresh();}catch(e){$('message').textContent=e.message;}finally{button.disabled=false;}}; }
action('connect',async()=>{
  const server=new URL($('server').value.trim()).origin;
  if(!await chrome.permissions.request({origins:[server+'/*']}))throw new Error('Allow access to your TalentOS server.');
  await call('CONNECT',{server,apiKey:$('apiKey').value,instanceName:$('instanceName').value});$('apiKey').value='';
});
action('select',()=>call('SELECT',{id:$('candidates').value}));
action('toggle',()=>call('TOGGLE')); action('refresh',async()=>{}); action('sync',()=>call('SYNC')); action('clear',()=>call('CLEAR_SITES'));
action('all',async()=>{const origin='https://*/*';if(await chrome.permissions.request({origins:[origin]}))await call('ADD_SITE',{origin});});
action('site',async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const url=new URL(tab.url);if(url.protocol!=='https:')throw new Error('Open an HTTPS form website first.');const origin=url.origin+'/*';if(await chrome.permissions.request({origins:[origin]}))await call('ADD_SITE',{origin});});
action('edit',async()=>{const {config:c}=await call('STATUS');$('setup').hidden=false;$('record').hidden=true;$('server').value=c.server;$('instanceName').value=c.instanceName;$('apiKey').value='';},false);
refresh().catch(e=>$('message').textContent=e.message);
