(()=>{
  if(globalThis.__talentOSRecorderInstalled)return;
  globalThis.__talentOSRecorderInstalled=true;
  let state={enabled:false};
  const pending=new Map(), last=new WeakMap();
  const sensitive=/password|passwd|passcode|one.?time|\botp\b|\bcvv\b|\bcvc\b|credit.?card|card.?number|cc-|social.?security|\bssn\b|bank.?account|routing.?number|api.?key|access.?token|secret|security.?answer|verification.?code/i;
  function enabled(){
    if(!state.enabled||!state.profileId)return false;
    try{if(location.origin===new URL(state.server).origin)return false;}catch{return false;}
    return (state.sites||[]).some(s=>s==='https://*/*'?location.protocol==='https:':s===location.origin+'/*');
  }
  function update(next){
    if(state.profileId!==next.profileId||!next.enabled){for(const p of pending.values())clearTimeout(p.timer);pending.clear();}
    state=next;
  }
  chrome.runtime.sendMessage({type:'CONTEXT'}).then(r=>r?.data&&update(r.data)).catch(()=>{});
  chrome.runtime.onMessage.addListener(m=>{if(m.type==='CONTEXT')update(m.state);});
  function descriptor(el){
    if(!(el instanceof Element)||!el.matches('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return null;
    const type=el.type||el.getAttribute('role')||'contenteditable';
    if(['password','hidden','file','submit','button','reset','image'].includes(type)||el.closest('[data-recorder-ignore]'))return null;
    let label=(Array.from(el.labels||[]).map(x=>x.textContent).join(' ')||el.getAttribute('aria-label')||
      (el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||el.placeholder||el.name||el.id||'Unlabelled field').trim().slice(0,1000);
    const group=el.closest('fieldset,[role="radiogroup"],[role="group"]');
    const question=group?.querySelector('legend')?.textContent||group?.getAttribute('aria-label')||
      (group?.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
    if(question&&question.trim()!==label)label=(question.trim()+' — '+label).slice(0,1000);
    const meta=[type,label,el.name,el.id,el.autocomplete,el.getAttribute('data-testid')].join(' ');
    if(sensitive.test(meta))return null;
    if(!el.getClientRects().length)return null;
    const all=Array.from((el.getRootNode()).querySelectorAll('input,textarea,select,[contenteditable="true"],[role="textbox"]'));
    const fieldKey=[el.form?.id||el.form?.name||'form',el.name||el.id||label,all.indexOf(el)].join(':').slice(0,1000);
    let value=el.isContentEditable?el.innerText:el.value;
    if(type==='checkbox'||type==='radio')value=JSON.stringify({checked:el.checked,value:el.value});
    if(el instanceof HTMLSelectElement)value=JSON.stringify(Array.from(el.selectedOptions,o=>({value:o.value,text:o.text})));
    return {field_key:fieldKey,label,field_type:type,value:String(value??'')};
  }
  function send(el,p){
    clearTimeout(p.timer);pending.delete(el);
    if(!enabled()||p.profileId!==state.profileId)return;
    const fingerprint=JSON.stringify([p.profileId,p.data.value]);if(last.get(el)===fingerprint)return;
    const event={id:crypto.randomUUID(),profile_id:p.profileId,recorded_at:p.time,page_url:location.origin+location.pathname,page_title:document.title.slice(0,1000),...p.data,event_type:p.kind};
    last.set(el,fingerprint);
    chrome.runtime.sendMessage({type:'CAPTURE',event}).then(r=>{if(r?.error){last.delete(el);}}).catch(()=>last.delete(el));
  }
  function capture(el,kind,immediate=false){
    if(!enabled())return;
    const data=descriptor(el);if(!data)return;
    const old=pending.get(el);if(old)clearTimeout(old.timer);
    const p={data,profileId:state.profileId,time:new Date().toISOString(),kind};pending.set(el,p);
    if(immediate)send(el,p);else p.timer=setTimeout(()=>send(el,p),600);
  }
  for(const name of ['input','change','focusout'])document.addEventListener(name,e=>{
    const el=e.composedPath().find(x=>x instanceof Element&&x.matches?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'));
    capture(el,name,name!=='input');
  },true);
  document.addEventListener('submit',e=>{
    for(const el of e.target.querySelectorAll('input,textarea,select,[contenteditable="true"]'))capture(el,'submit',true);
  },true);
  function flush(){for(const [el,p]of pending)send(el,p);}
  window.addEventListener('pagehide',flush);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flush();});
})();
