/** Exact owner-change transport binding from the pinned server realm resolver.
 * Callers cannot submit this as authority. Existing audit entries stay unchanged. */
import { originContinuationKey } from './origin-continuation.mjs';
const refuse = () => { throw Error('OWNER_CHANGE_ORIGIN_BINDING_REFUSED'); };
const check = v => { if (!v) refuse(); };
function exact(v, keys) {
  check(v && typeof v === 'object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v)));
  const d=Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(d).length===keys.length && keys.every(k=>d[k] && Object.hasOwn(d[k],'value') && d[k].enumerable));
}
export function ownerChangeOriginBinding(context, expected) {
  exact(context,['schema','tenant','transportOrigin','authorizationOrigin','username','account','chainId','continuation']);
  check(context.schema==='8415wallet-authorization-context/1' && context.tenant===expected.tenant &&
    context.authorizationOrigin===expected.origin && context.username===expected.username &&
    context.account.toLowerCase()===expected.account && context.chainId===expected.chainId);
  let to,from;try {to=new URL(context.transportOrigin);from=new URL(context.authorizationOrigin);}catch{refuse();}
  check(to.origin===context.transportOrigin && from.origin===context.authorizationOrigin);
  if(context.continuation===null){check(context.transportOrigin===expected.origin);return null;}
  return readOwnerChangeOriginBinding({schema:'8415-owner-change-origin/1',transportOrigin:context.transportOrigin,
    authorizationOrigin:context.authorizationOrigin,continuation:context.continuation},expected);
}
export function readOwnerChangeOriginBinding(value, expected) {
  exact(value,['schema','transportOrigin','authorizationOrigin','continuation']);
  check(value.schema==='8415-owner-change-origin/1' && value.authorizationOrigin===expected.origin);
  let to,from;try{to=new URL(value.transportOrigin);from=new URL(value.authorizationOrigin);}catch{refuse();}
  check(to.origin===value.transportOrigin && from.origin===value.authorizationOrigin);
  const c=value.continuation;exact(c,['reference','digest','revision']);
  check(to.protocol==='https:' && to.port==='' && from.protocol==='https:' && to.hostname===from.hostname &&
    from.origin!==to.origin && c.reference===originContinuationKey({tenant:expected.tenant,transportOrigin:to.origin}) &&
    typeof c.digest==='string' && /^[a-f0-9]{64}$/.test(c.digest) && !/^0+$/.test(c.digest) &&
    typeof c.revision==='string' && /^[1-9][0-9]{0,77}$/.test(c.revision) && BigInt(c.revision)<1n<<256n);
  return Object.freeze({schema:'8415-owner-change-origin/1',transportOrigin:to.origin,authorizationOrigin:from.origin,
    continuation:Object.freeze({reference:c.reference,digest:c.digest,revision:c.revision})});
}
