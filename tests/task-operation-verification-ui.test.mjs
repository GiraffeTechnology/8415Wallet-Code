import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountOperationVerificationUI} from '../web/task-operation-verification-ui.mjs';
import {setLocale} from '../web/i18n.mjs';
import CATALOGS from '../web/locales/task-operation-verification.mjs';
class Element{
 constructor(){this.children=[];this.listeners={};this.value='';this.checked=false;this.hidden=false;this.disabled=false;this.textContent='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 click(){this.listeners.click?.({preventDefault(){}});}
}
function fixture(){
 const listeners=new Map(),elements=new Map(); const document={addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();}};
 const staticKeys=['title','boundary','empty','ack','code','confirm','cancel'];
 const labels=staticKeys.map(key=>{const element=new Element();element.getAttribute=()=>`operationVerification.${key}`;return element;});
 document.getElementById('task-operation-verification').querySelectorAll=()=>labels;
 let instance;const calls=[],barriers=[];
 class Flow{
  constructor({onChange}){this.onChange=onChange;instance=this;}
  emit(phase,challenge=null){this.onChange({phase,challenge,error:null});}
  prepare(view,reservation){calls.push(['prepare',view,reservation]);this.emit('preparing');}
  confirm(code){calls.push(['confirm',code]);this.emit('confirming');}
  cancel(){calls.push(['cancel']);this.emit('idle');}
 }
 const ui=mountOperationVerificationUI({document,Flow,request(){assert.fail('UI must not issue independent requests');},context:{},onBarrier:value=>barriers.push(value)});
 const reservation={operationId:'original:1',childDigest:'digest',status:'reserved'};
 const view={task:{digest:'task',policy:{intent:{kind:'exact-operation'}}},budget:{schema:'8415-task-budget/1',reservations:[reservation]}};
 return {ui,el:id=>document.getElementById(id),calls,barriers,view,reservation,flow:()=>instance,localeChange:()=>listeners.get('change')?.(),listeners,labels,staticKeys};
}
const challenge={task:{policy:{intent:{kind:'exact-operation'},secretHtml:'<img src=x onerror=alert(1)>'}},child:{child:{operationId:'original:1',nonce:'7'}},request:{binding:{taskDigest:'task',childDigest:'digest',policyRevision:'3'}}};
test('explicit original reservation selection and busy barrier; complete text-only review; acknowledgement and OTP clearing',()=>{
 const f=fixture();f.ui.setView(f.view);const button=f.el('task-operation-options').children[0];button.click();button.click();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],f.view);assert.equal(f.calls[0][2],f.reservation);assert.equal(f.ui.blocksContinuation(),true);
 f.flow().emit('review',challenge);
 assert.deepEqual(JSON.parse(f.el('task-operation-canonical').textContent),{taskPolicy:challenge.task.policy,child:challenge.child.child,requestBinding:challenge.request.binding});
 f.el('task-operation-code').value='123456';f.el('task-operation-confirm').click();assert.equal(f.calls.length,1);
 f.el('task-operation-ack').checked=true;f.el('task-operation-confirm').click();f.el('task-operation-confirm').click();
 assert.deepEqual(f.calls[1],['confirm','123456']);assert.equal(f.calls.length,2);assert.equal(f.el('task-operation-code').value,'');assert.equal(f.el('task-operation-ack').checked,false);
 f.flow().emit('verified',challenge);assert.equal(f.ui.blocksContinuation(),true);assert.equal(f.calls.length,2);
 f.ui.cancel();assert.equal(f.ui.blocksContinuation(),false);assert.equal(f.el('task-operation-canonical').textContent,'');
});
test('not-required displays server fact with no OTP prompt and no execution barrier; different task cancels old challenge',()=>{
 const f=fixture();f.ui.setView(f.view);f.el('task-operation-options').children[0].click();f.flow().emit('not-required',{required:false});
 assert.equal(f.el('task-operation-review').hidden,true);assert.equal(f.el('task-operation-code').disabled,true);assert.equal(f.ui.blocksContinuation(),false);
 f.flow().emit('review',challenge);f.el('task-operation-code').value='654321';f.ui.setView({...f.view,task:{...f.view.task,digest:'different'}});
 assert.equal(f.calls.at(-1)[0],'cancel');assert.equal(f.el('task-operation-code').value,'');assert.equal(f.el('task-operation-canonical').textContent,'');
});
test('only exact-operation budget/1 unattempted reservations; busy main flow blocks selection',()=>{
 const f=fixture();for(const kind of ['nft-sale','artfi-receipt']){
 f.ui.setView({...f.view,task:{...f.view.task,policy:{intent:{kind}}}});assert.equal(f.el('task-operation-verification').hidden,true);assert.equal(f.el('task-operation-options').children.length,0);}
 f.ui.setView({...f.view,budget:{...f.view.budget,reservations:[{...f.reservation,status:'submitted'}]}});assert.equal(f.el('task-operation-options').children.length,0);
 f.ui.setView(f.view,{busy:true});f.el('task-operation-options').children[0].click();assert.equal(f.calls.length,0);
});
test('six complete fixed locale catalogs and unchanged protocol literals in complete original JSON',()=>{
 const keys=Object.keys(CATALOGS.en).filter(k=>k.startsWith('operationVerification.'));assert.equal(keys.length,16);
 for(const locale of ['en','zh-Hans','zh-Hant','fr','es','ja']){for(const key of keys)assert.equal(typeof CATALOGS[locale][key],'string');setLocale(locale);const f=fixture();f.flow().emit('review',challenge);assert.equal(f.el('task-operation-status').textContent,CATALOGS[locale]['operationVerification.review']);}
 setLocale('en');
});
test('mounted lifecycle cancels on hidden, Escape, page leave and session replacement; continuation has ceremony barrier',()=>{
 const source=readFileSync(new URL('../web/task-authorization-ui-v3.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('verificationOnlyTasks.has(active?.selected?.task?.digest) || operationUI?.blocksContinuation()'));
 assert.match(source,/function leave\(\) \{ operationUI\?\.cancel\(\)/);
 assert.match(source,/visibilityState === 'hidden'\) \{ operationUI\?\.cancel\(\)/);
 assert.match(source,/event.key === 'Escape' && visible\) \{ operationUI\?\.cancel\(\)/);
 assert.match(source,/walletLogin.subscribe\(session => \{\s*operationUI\?\.destroy\(\); operationUI = null;/);
 const ui=readFileSync(new URL('../web/task-operation-verification-ui.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/innerHTML|localStorage|sessionStorage|\.execute\(|\.resume\(/);
 for(const entry of ['index.html','index-v3.html'])assert.match(readFileSync(new URL('../web/'+entry,import.meta.url),'utf8'),/id="task-operation-code"[^>]*autocomplete="off"/);
});

test('live locale changes repaint the same ceremony without resending or clearing consent, destroy removes listener',async()=>{
 const f=fixture();f.ui.setView(f.view);f.el('task-operation-options').children[0].click();f.flow().emit('review',challenge);
 f.el('task-operation-ack').checked=true;f.el('task-operation-code').value='123456';const original=f.el('task-operation-canonical').textContent;
 for(const locale of ['en','zh-Hans','zh-Hant','fr','es','ja']){setLocale(locale,{persist:false});f.localeChange();await Promise.resolve();assert.equal(f.el('task-operation-status').textContent,CATALOGS[locale]['operationVerification.review']);for(let i=0;i<f.labels.length;i++)assert.equal(f.labels[i].textContent,CATALOGS[locale]['operationVerification.'+f.staticKeys[i]]);assert.equal(f.el('task-operation-options').children[0].textContent,CATALOGS[locale]['operationVerification.prepare'].replace('{operation}','original:1'));assert.equal(f.calls.length,1);assert.equal(f.el('task-operation-canonical').textContent,original);assert.equal(f.el('task-operation-code').value,'123456');}
 f.ui.destroy();assert.equal(f.listeners.size,0);assert.equal(f.el('task-operation-code').value,'');setLocale('en',{persist:false});
});
