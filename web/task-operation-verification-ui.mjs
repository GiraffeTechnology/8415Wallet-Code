/** Explicit owner ceremony only. Never schedules execution or stores OTPs. */
import {getLocale} from './i18n.mjs';
import catalogs from './locales/task-operation-verification.mjs';
export function mountOperationVerificationUI({document,Flow,request,context,onBarrier=()=>{},onVerificationOnly=()=>{}}){
  const el=id=>document.getElementById(id), panel=el('task-operation-verification');
  if(!panel)return {setView(){},cancel(){},destroy(){},blocksContinuation:()=>false};
  let view=null, active=null, frozenTask=null, unavailable=false;
  const presentations=new Map();
  const msg=(key,parameters={})=>({key,parameters});
  const translated=value=>typeof value==='string'?value:(catalogs[getLocale()]??catalogs.en)[value.key].replace(/\{([A-Za-z]+)\}/g,(_,key)=>String(value.parameters[key]));
  const paint=(element,value)=>{presentations.set(element,value);element.textContent=translated(value);};
  function localize(){
    for(const element of panel.querySelectorAll?.('[data-operation-i18n]')??[])element.textContent=translated(msg(element.getAttribute('data-operation-i18n')));
    for(const [element,value] of presentations){if(element.isConnected===false){presentations.delete(element);continue;}element.textContent=translated(value);}
  }
  const onLocale=()=>queueMicrotask(localize);
  document.addEventListener?.('change',onLocale);
  const Observer=document.defaultView?.MutationObserver??globalThis.MutationObserver;
  const observer=Observer&&document.documentElement?new Observer(localize):null;
  observer?.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  localize();
  const clear=()=>{el('task-operation-code').value='';el('task-operation-ack').checked=false;};
  const blocked=()=>active && ['preparing','review','confirming','verified'].includes(active.phase);
  function render(snapshot){
    active=snapshot;
    const review=snapshot.phase==='review',busy=['preparing','confirming'].includes(snapshot.phase);
    paint(el('task-operation-status'),msg(`operationVerification.${snapshot.phase}`));
    paint(el('task-operation-error'),snapshot.error??'');
    el('task-operation-review').hidden=!snapshot.challenge||['idle','not-required','error','preparing'].includes(snapshot.phase);
    const c=snapshot.challenge;
    el('task-operation-canonical').textContent=c?JSON.stringify({taskPolicy:c.task?.policy,child:c.child?.child,requestBinding:c.request?.binding},null,2):'';
    el('task-operation-confirm').disabled=!review;
    el('task-operation-code').disabled=!review;el('task-operation-ack').disabled=!review;
    el('task-operation-cancel').disabled=snapshot.phase==='idle';
    if(!review)clear();
    for(const button of el('task-operation-options').children)button.disabled=unavailable||busy||blocked();
    onBarrier(Boolean(blocked()));
  }
  const flow=new Flow({request,context,onChange:render});
  function cancel(){clear();frozenTask=null;flow.cancel();}
  function setView(next,{busy=false}={}){
    if(frozenTask && next?.task?.digest!==frozenTask)cancel();
    view=next?.task?.policy?.intent?.kind==='exact-operation' && next?.budget?.schema==='8415-task-budget/1'?next:null;unavailable=busy;
    const options=el('task-operation-options');options.replaceChildren();panel.hidden=!view;
    for(const reservation of view?.budget?.reservations??[]){
      if(reservation.status!=='reserved')continue;
      const button=document.createElement('button');button.type='button';
      paint(button,msg('operationVerification.prepare',{operation:reservation.operationId}));
      button.disabled=busy||Boolean(blocked());
      button.addEventListener('click',()=>{
        if(unavailable||blocked()||!view)return;
        clear();frozenTask=view.task.digest;if(onVerificationOnly(frozenTask)===false){paint(el('task-operation-error'),'TASK_VERIFICATION_ONLY_STATE_REFUSED');return;}void flow.prepare(view,reservation);
      });options.append(button);
    }
    el('task-operation-empty').hidden=options.children.length!==0;
  }
  el('task-operation-confirm').addEventListener('click',()=>{
    if(active?.phase!=='review')return;
    if(!el('task-operation-ack').checked){paint(el('task-operation-error'),msg('operationVerification.ackRequired'));return;}
    let code=el('task-operation-code').value;clear();void flow.confirm(code);code='';
  });
  el('task-operation-cancel').addEventListener('click',cancel);
  render({phase:'idle',challenge:null,error:null});
  return {setView,cancel,destroy(){cancel();document.removeEventListener?.('change',onLocale);observer?.disconnect();presentations.clear();},blocksContinuation:()=>Boolean(blocked())};
}
