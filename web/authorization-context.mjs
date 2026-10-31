/** The expected identity comes from the authenticated session, independently of
 * task/grant/evidence payloads. HTTP transport always stays on its current origin. */
const refuse = () => { throw Error('AUTHORIZATION_CONTEXT_BINDING_REFUSED'); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length !== keys.length || keys.some(k => !properties[k] ||
    !Object.hasOwn(properties[k], 'value') || !properties[k].enumerable)) refuse();
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && !/^0+$/.test(value);
export async function validateAuthorizationContext(value, session, transportOrigin, crypto = globalThis.crypto) {
  exact(value, ['schema','tenant','transportOrigin','authorizationOrigin','username','account','chainId','continuation']);
  if (!session || session.origin !== transportOrigin || value.schema !== '8415wallet-authorization-context/1' ||
      value.transportOrigin !== transportOrigin || value.tenant !== session.tenant || value.username !== session.username ||
      value.account !== session.account || value.chainId !== session.chainId) refuse();
  let from, to; try { from = new URL(value.authorizationOrigin); to = new URL(transportOrigin); } catch { refuse(); }
  if (from.origin !== value.authorizationOrigin || to.origin !== transportOrigin) refuse();
  let continuation = null;
  if (value.continuation === null) {
    if (value.authorizationOrigin !== transportOrigin) refuse();
  } else {
    exact(value.continuation,['reference','digest','revision']);
    const c = value.continuation;
    if (from.protocol !== 'https:' || to.protocol !== 'https:' || to.port !== '' || from.hostname !== to.hostname ||
        value.authorizationOrigin === transportOrigin || !hash(c.digest) || typeof c.revision !== 'string' ||
        !/^[1-9][0-9]{0,77}$/.test(c.revision) || BigInt(c.revision) >= 1n << 256n || !crypto?.subtle) refuse();
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([session.tenant,transportOrigin])));
    const reference = '@origin-continuation:' + Array.from(new Uint8Array(bytes),b => b.toString(16).padStart(2,'0')).join('');
    if (c.reference !== reference) refuse();
    continuation = Object.freeze({reference:c.reference,digest:c.digest,revision:c.revision});
  }
  return Object.freeze({...value,continuation});
}
