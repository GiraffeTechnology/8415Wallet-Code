/** Original owner-session operation confirmation only. Never execute, change policy, or persist factors. */
import { TaskAuthorizationClient } from './task-authorization.mjs';
import { freezeChildOperation } from '../dist/browser/agent/taskContract.js';
import { sha256, toUtf8Bytes } from '../dist/browser/vendor/ethers.js';
const check = (value, code = 'TASK_OPERATION_REVIEW_REFUSED') => { if (!value) { const e = new Error(code); e.code = code; throw e; } };
const hash = value => sha256(toUtf8Bytes(JSON.stringify(value))).slice(2);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key)));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const policyKeys = ['schema','mode','revision','scopeDigest','taskDigest','executorDigest','credentialRevision'];
const bindingKeys = ['scopeDigest','policyRevision','credentialRevision','taskDigest','executorDigest','grantReference','grantPolicyVersion','grantKey','childDigest','operationId','nonceClaimDigest'];
function policy(raw, view) {
  exact(raw, policyKeys);
  check(raw.schema === '8415-task-verification-execution-view/1' && ['ON','OFF'].includes(raw.mode) &&
    uint(raw.revision) && uint(raw.credentialRevision) && hex(raw.scopeDigest) &&
    raw.taskDigest === view.task.digest && raw.executorDigest === view.executor.digest);
  return structuredClone(raw);
}
/** The supplied request is the same checked Wallet UI session transport. */
export class OperationVerificationFlow {
  #request; #decoder; #now; #notify; #epoch=0; #expected=null;
  #state={phase:'idle',challenge:null,error:null,busy:false,result:null};
  constructor({request,context,now=Date.now,onChange=()=>{}}) {
    check(typeof request==='function' && typeof now==='function');
    this.#request=request; this.#decoder=new TaskAuthorizationClient({request,context}); this.#now=now; this.#notify=onChange;
  }
  snapshot(){return freeze(structuredClone(this.#state));}
  #paint(value){this.#state={...this.#state,...value};this.#notify(this.snapshot());}
  #current(epoch){return epoch===this.#epoch;}
  cancel(){this.#epoch++;this.#expected=null;this.#paint({phase:'idle',challenge:null,error:null,busy:false,result:null});}
  #failure(error,epoch){if(this.#current(epoch)){this.#expected=null;this.#paint({phase:'error',challenge:null,busy:false,result:null,
    error:/^(TASK|AUTH|LOGIN)_[A-Z0-9_]+$/.test(error?.code??'')?error.code:'TASK_OPERATION_SERVICE_UNAVAILABLE'});}}
  async #status(expected){
    const raw=await this.#request('tasks/status',{taskDigest:expected.taskDigest});
    const view=this.#decoder.view(raw), p=policy(raw.humanVerification,view);
    const row=view.budget?.reservations.find(item=>item.operationId===expected.operationId);
    check(view.task.digest===expected.taskDigest && view.task.policy.intent.kind==='exact-operation' &&
      view.effectiveStatus==='authorized' && view.budget?.schema==='8415-task-budget/1' &&
      view.budget.revision===expected.expectedBudgetRevision && row?.status==='reserved' && row.childDigest===expected.childDigest &&
      view.executor.digest===expected.executorDigest && view.authorization?.reference===expected.grantReference &&
      view.authorization.grantPolicyVersion===expected.grantPolicyVersion,'TASK_OPERATION_REVIEW_CHANGED');
    if(expected.policy) check(JSON.stringify(p)===JSON.stringify(expected.policy),'TASK_OPERATION_REVIEW_CHANGED');
    return {view,policy:p};
  }
  async prepare(view,reservation){
    if(this.#state.busy)return;
    const epoch=++this.#epoch; this.#expected=null;
    this.#paint({phase:'preparing',busy:true,challenge:null,error:null,result:null});
    try {
      const task=this.#decoder.task(view.task);
      check(task.policy.intent.kind==='exact-operation' && view.effectiveStatus==='authorized' &&
        view.budget?.schema==='8415-task-budget/1' && reservation?.status==='reserved' &&
        view.budget.reservations.some(row=>row.operationId===reservation.operationId && row.childDigest===reservation.childDigest && row.status==='reserved'));
      const expected={taskDigest:task.digest,operationId:reservation.operationId,childDigest:reservation.childDigest,
        expectedBudgetRevision:view.budget.revision,executorDigest:view.executor.digest,
        grantReference:view.authorization.reference,grantPolicyVersion:view.authorization.grantPolicyVersion};
      const current=await this.#status(expected);if(!this.#current(epoch))return;
      expected.policy=current.policy;
      const body={taskDigest:expected.taskDigest,operationId:expected.operationId,childDigest:expected.childDigest,expectedBudgetRevision:expected.expectedBudgetRevision};
      const result=await this.#request('tasks/prepare-operation-verification',body);if(!this.#current(epoch))return;
      if(result?.required===false){
        exact(result,['required','policyRevision','reason']);
        const reason=expected.policy.mode==='OFF'?'policy-off':current.view.approvalFactor==='server-test-scope'?'server-test-scope':expected.policy.revision==='0'?'pre-operational-default-on':null;
        check(reason!==null && result.reason===reason && result.policyRevision===expected.policy.revision);
        this.#paint({phase:'not-required',busy:false,result:structuredClone(result)});return;
      }
      exact(result,['required','request','requestDigest','task','child']);check(result.required===true);
      check(expected.policy.mode==='ON' && expected.policy.revision!=='0');
      const returnedTask=this.#decoder.task(result.task),child=freezeChildOperation(result.child?.child);
      check(returnedTask.digest===expected.taskDigest && child.digest===result.child.digest && child.digest===expected.childDigest &&
        child.child.taskDigest===expected.taskDigest && child.child.operationId===expected.operationId &&
        child.child.operation.chainId===returnedTask.policy.chainId && child.child.operation.actor===returnedTask.policy.actor);
      exact(result.request,['schema','purpose','binding','challengeId','issuedAt','expiresAt']);
      // grantKey is an opaque original-server binding: the Wallet UI session deliberately
      // omits username. Validate its shape and inclusion in both original digests;
      // task/actor/chain/grant reference and revisions are checked independently.
      const r=result.request,b=r.binding;exact(b,[...bindingKeys,'digest']);
      const original=Object.fromEntries(bindingKeys.map(key=>[key,b[key]]));
      const operationKey=`task-operation:${hash([returnedTask.policy.chainId,returnedTask.policy.actor,expected.operationId])}`;
      check(r.schema==='8415-task-operation-verification-request/1' && r.purpose==='execute-exact-child' &&
        /^operation-challenge:[A-Za-z0-9_-]{43}$/.test(r.challengeId) &&
        Number.isSafeInteger(r.issuedAt) && Number.isSafeInteger(r.expiresAt) && r.issuedAt<=this.#now() && this.#now()<r.expiresAt &&
        r.expiresAt-r.issuedAt<=120000 && r.expiresAt<=Number(BigInt(child.child.expiresAt)*1000n) &&
        r.expiresAt<=Number(BigInt(returnedTask.policy.expiresAt)*1000n) &&
        b.scopeDigest===expected.policy.scopeDigest && b.policyRevision===expected.policy.revision && b.credentialRevision===expected.policy.credentialRevision &&
        b.taskDigest===expected.taskDigest && b.executorDigest===expected.executorDigest && b.grantReference===expected.grantReference &&
        b.grantPolicyVersion===expected.grantPolicyVersion && /^task-grant:[a-f0-9]{64}$/.test(b.grantKey) &&
        b.childDigest===expected.childDigest && b.operationId===expected.operationId &&
        b.nonceClaimDigest===hash({operationKey,taskDigest:expected.taskDigest,childDigest:expected.childDigest}) &&
        b.digest===hash(original) && result.requestDigest===hash(r),'TASK_OPERATION_CHALLENGE_REFUSED');
      this.#expected=freeze(expected);this.#paint({phase:'review',busy:false,challenge:freeze(structuredClone(result))});
    }catch(error){this.#failure(error,epoch);}
  }
  async confirm(code){
    if(this.#state.busy || this.#state.phase!=='review' || !this.#expected)return;
    const epoch=this.#epoch,expected=this.#expected,challenge=this.#state.challenge;
    this.#paint({phase:'confirming',busy:true,error:null});
    try {
      check(typeof code==='string' && /^[0-9]{6}$/.test(code),'TASK_OPERATION_CODE_REQUIRED');
      check(this.#now()<challenge.request.expiresAt,'TASK_OPERATION_CHALLENGE_EXPIRED');
      await this.#status(expected);if(!this.#current(epoch))return;
      check(this.#now()<challenge.request.expiresAt,'TASK_OPERATION_CHALLENGE_EXPIRED');
      const result=await this.#request('tasks/confirm-operation-verification',{challengeId:challenge.request.challengeId,requestDigest:challenge.requestDigest,code});code='';
      if(!this.#current(epoch))return;
      exact(result,['verified','purpose','childDigest','policyRevision','expiresAt']);
      check(result.verified===true && result.purpose==='execute-exact-child' && result.childDigest===expected.childDigest &&
        result.policyRevision===expected.policy.revision && result.expiresAt===challenge.request.expiresAt && this.#now()<result.expiresAt,'TASK_OPERATION_CONFIRMATION_REFUSED');
      const current=await this.#status(expected);if(!this.#current(epoch))return;
      this.#expected=null;this.#paint({phase:'verified',challenge:null,busy:false,result:{...structuredClone(result),statusReadBack:true,executionRequested:false}});
    }catch(error){this.#failure(error,epoch);}finally{code='';}
  }
}
