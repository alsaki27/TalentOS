import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('capture filters secrets, preserves blank answers, deduplicates blur and drops pending changes on person switch',async()=>{
  const source=await readFile(new URL('../content.js',import.meta.url),'utf8');
  const handlers={},messages=[],timers=new Map();let onMessage,counter=0;
  class Element {
    constructor(label,type='text',value=''){this.labels=[{textContent:label}];this.type=type;this.value=value;this.name=label;this.id='';this.autocomplete='';}
    matches(){return true;} closest(){return null;} getAttribute(){return null;}
    getClientRects(){return [{}];} getRootNode(){return {querySelectorAll:()=>[this]};}
  }
  class Select extends Element {}
  const state={enabled:true,profileId:'person-a',profileName:'Person A',server:'https://recorder.test',sites:['https://forms.test/*']};
  const context=vm.createContext({Element,HTMLSelectElement:Select,URL,crypto,Map,WeakMap,Array,JSON,String,Date,
    location:{origin:'https://forms.test',pathname:'/application',protocol:'https:'},
    window:{top:{},addEventListener:()=>{}},document:{title:'Test form',getElementById:()=>null,addEventListener:(name,fn)=>handlers[name]=fn},
    setTimeout:fn=>{timers.set(++counter,fn);return counter;},clearTimeout:id=>timers.delete(id),
    chrome:{runtime:{sendMessage:async m=>{if(m.type==='CONTEXT')return {data:state};messages.push(m);return {data:{saved:true}};},onMessage:{addListener:fn=>onMessage=fn}}}
  });
  vm.runInContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  const fire=(name,el)=>handlers[name]({composedPath:()=>[el]});
  const normal=new Element('Experience','textarea','Five years');fire('change',normal);fire('focusout',normal);
  assert.equal(messages.length,1);assert.equal(messages[0].event.label,'Experience');assert.equal(messages[0].event.value,'Five years');
  for(const field of [new Element('Password','password','never'),new Element('Verification code','text','123456'),new Element('Card number','text','4111111111111111'),new Element('Hidden','hidden','never')])fire('change',field);
  assert.equal(messages.length,1);
  normal.value='';fire('change',normal);assert.equal(messages.at(-1).event.value,'');
  normal.value='Pending A';fire('input',normal);assert.equal(timers.size,1);
  onMessage({type:'CONTEXT',state:{...state,profileId:'person-b',profileName:'Person B'}});
  assert.equal(timers.size,0);assert.equal(messages.length,2);
  normal.value='Person B answer';fire('change',normal);assert.equal(messages.at(-1).event.profile_id,'person-b');
  onMessage({type:'CONTEXT',state:{...state,enabled:false}});normal.value='Paused';fire('change',normal);assert.equal(messages.length,3);
});
