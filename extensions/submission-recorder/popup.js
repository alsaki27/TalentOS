const $=id=>document.getElementById(id);
let editing=false, refreshPromise;
async function call(type,data={}) { const result=await chrome.runtime.sendMessage({type,...data}); if(result.error)throw new Error(result.error); return result.data; }
async function refresh(loadCandidates=true) {
  const s=await call('STATUS'),c=s.config;
  $('setup').hidden=!!c.ownerId&&!editing; $('record').hidden=!c.ownerId||editing; $('cancel').hidden=!c.ownerId;
  if(!c.ownerId)return;
  $('recording').hidden=!c.enabled; $('selection').hidden=!!c.enabled;
  $('candidateName').textContent=c.candidateName||'Selected candidate';
  $('candidates').disabled=!!c.enabled; $('select').disabled=!!c.enabled;
  $('settings').hidden=!!c.enabled; $('edit').disabled=!!c.enabled;
  $('syncState').textContent=s.syncError|| (s.queued?`${s.queued} ${s.queued===1?'entry':'entries'} waiting to sync. Your answers are kept on this browser.`:s.lastSync?'All caught up · 0 entries queued':'Ready to record · 0 entries queued');
  $('lastSync').textContent=s.lastSync?'Last saved '+new Date(s.lastSync).toLocaleString():'Syncs automatically as you fill out forms.';
  $('candidateLink').hidden=!c.candidateId;
  if(c.candidateId)$('candidateLink').href=c.server+'/candidates/'+encodeURIComponent(c.candidateId)+'?tab=Submission%20Records';
  if(loadCandidates&&!c.enabled){
    try { const people=await call('CANDIDATES');$('candidates').replaceChildren(new Option('Choose a candidate',''));
      for(const person of people)$('candidates').add(new Option(`${person.name} · ${person.id.slice(0,8)}`,person.id));$('candidates').value=c.candidateId||'';
    }catch(e){$('message').textContent=e.message;}
  }
}
function action(id,fn,reload=true) { $(id).onclick=async()=>{const button=$(id);button.disabled=true;$('message').textContent='';try{await fn();if(reload)await refresh();}catch(e){$('message').textContent=e.message;}finally{button.disabled=false;}}; }
action('connect',async()=>{
  const server=new URL($('server').value.trim()).origin;
  if(server.startsWith('http:')&&!await chrome.permissions.request({origins:[server+'/*']}))throw new Error('Allow access to your local TalentOS server.');
  await call('CONNECT',{server,apiKey:$('apiKey').value,instanceName:$('instanceName').value});$('apiKey').value='';editing=false;
});
action('select',()=>call('SELECT',{id:$('candidates').value}));
action('stop',()=>call('STOP'));action('refresh',async()=>{});action('sync',()=>call('SYNC'));
action('edit',async()=>{const {config:c}=await call('STATUS');if(c.enabled)throw new Error('Stop recording before changing the connection.');editing=true;$('server').value=c.server;$('instanceName').value=c.instanceName;$('apiKey').value='';});
action('cancel',async()=>{editing=false;$('apiKey').value='';});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&(changes.config||changes.syncError||changes.lastSync)) {
    // Keep a long-lived options tab current without continually reloading its picker.
    if(!refreshPromise)refreshPromise=refresh(!!changes.config).catch(e=>$('message').textContent=e.message).finally(()=>refreshPromise=null);
  }
});
refresh().catch(e=>$('message').textContent=e.message);
