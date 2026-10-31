import {rendererMessages} from './renderer-messages.mjs';
import nativeSource from './locales/native-en.mjs';
import nativeFragments from './locales/native-fragments.mjs';
import {RENDERER_EXTRA} from './locales/renderer-extra.mjs';
import {RENDERER_MODEL} from './locales/renderer-model.mjs';
import { presentation, renderUi } from './i18n.mjs';
import { translateNative } from './native-i18n.mjs';

// PRD §§4.1 / 10.6: these are display states, never fabricated occurrence
// numbers or changes to ownerOf/holderAsOf. The legacy AssetView has addresses,
// but no independently verified transfer-sequence positions.
const copy = Object.freeze({
  en: Object.freeze({ own: 'Your wallet', hidden: 'Identity hidden; sequence position unavailable', unavailable: 'Identity unavailable', audit: 'This preview and download are privacy-filtered display copies, not the canonical raw audit record. Wallet labels are not verified sequence positions.' }),
  'zh-Hans': Object.freeze({ own: '你的钱包', hidden: '身份已隐藏；序列位置不可用', unavailable: '身份不可用', audit: '此预览和下载是经过隐私过滤的展示副本，并非原始审计记录。钱包标签不是已验证的序列位置。' }),
  'zh-Hant': Object.freeze({ own: '你的錢包', hidden: '身分已隱藏；序列位置無法取得', unavailable: '身分無法取得', audit: '此預覽與下載是經過隱私過濾的顯示副本，並非原始稽核記錄。錢包標籤不是已驗證的序列位置。' }),
  fr: Object.freeze({ own: 'Votre portefeuille', hidden: 'Identité masquée ; position dans la séquence indisponible', unavailable: 'Identité indisponible', audit: 'Cet aperçu et ce téléchargement sont des copies d’affichage filtrées pour protéger les identités, et non le relevé d’audit brut canonique. Les libellés des portefeuilles ne sont pas des positions vérifiées dans la séquence.' }),
  es: Object.freeze({ own: 'Tu billetera', hidden: 'Identidad oculta; posición en la secuencia no disponible', unavailable: 'Identidad no disponible', audit: 'Esta vista previa y esta descarga son copias de visualización filtradas por privacidad, no el registro de auditoría original canónico. Las etiquetas de billeteras no son posiciones verificadas en la secuencia.' }),
  ja: Object.freeze({ own: '自分のウォレット', hidden: '識別情報は非表示。シーケンス内の位置は取得できません', unavailable: '識別情報を取得できません', audit: 'このプレビューとダウンロードは、識別情報を除いた表示用コピーであり、正式な生の監査記録ではありません。ウォレットのラベルは、検証済みのシーケンス位置を示しません。' }),
});
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);

/** Reduce an individual identity to a non-identifying display state. Neither
 * addresses nor supplied labels/positions are retained in the presentation. */
export function walletIdentityState(identity, authenticatedAccount) {
  if (!address(identity) || !address(authenticatedAccount)) return 'unavailable';
  return identity.toLowerCase() === authenticatedAccount.toLowerCase() ? 'own' : 'hidden';
}
export function walletIdentityText(state, locale) {
  if (!Object.hasOwn(copy, locale) || !Object.hasOwn(copy[locale], state)) throw Error('IDENTITY_PRESENTATION_REFUSED');
  return copy[locale][state];
}
export function walletIdentityDisplay(identity, authenticatedAccount) {
  const state = walletIdentityState(identity, authenticatedAccount);
  // The locale binding closes over the reduced state only, not raw identities.
  return presentation(locale => walletIdentityText(state, locale));
}

const markers = Object.freeze({ own: '[wallet:self]', hidden: '[wallet:identity-hidden]', unavailable: '[wallet:identity-unavailable]' });
const identityFields = new Set(['owner','holder','initialHolder','expectedHolder','initiator','registering',
  'position','confirmedHolder','account','seller','buyer','payer','payee','from','to','recipient','sender','beneficiary']);
const identityNames = new Set(['walletName','ownerName','holderName','sellerName','buyerName','tenantName']);

const renderMessageSymbol=Symbol.for('8415wallet.render-messages/1');
const renderMessageSources=Object.freeze({...nativeSource,...nativeFragments.en,...RENDERER_MODEL.en,...RENDERER_EXTRA.en,'renderer.join':'{v0} — {v1}'});
const ownData=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)&&'value' in Object.getOwnPropertyDescriptor(value,key));
function copyRenderMetadata(source,target,reduce){
 const fields=Object.getOwnPropertyDescriptor(source,renderMessageSymbol)?.value;
 if(!fields||typeof fields!=='object'||Array.isArray(fields))return target;
 const copy=(message,depth=0)=>{
  if(depth>12||!ownData(message,['schema','key','template','values'])||message.schema!=='8415-render-message/1'||
   typeof message.key!=='string'||typeof message.template!=='string'||message.template.length>16384||
   renderMessageSources[message.key]!==message.template.trim())return null;
  const values=message.values;
  if(!values||typeof values!=='object'||Array.isArray(values)||Reflect.ownKeys(values).length>32)return null;
  const allowed=new Set([...message.template.matchAll(/\{(v[0-9]+)\}/g)].map(match=>match[1]));
  const out={};
  for(const key of Reflect.ownKeys(values)){
   if(typeof key!=='string'||!allowed.has(key)||!('value' in Object.getOwnPropertyDescriptor(values,key)))return null;
   const value=values[key];
   const safe=typeof value==='string'&&value.length<=65536?reduce(value,'presentationValue',''):copy(value,depth+1);
   if(safe===null)return null;out[key]=safe;
  }
  if(allowed.size!==Object.keys(out).length)return null;
  return Object.freeze({schema:message.schema,key:message.key,template:message.template,values:Object.freeze(out)});
 };
 const accepted={};
 for(const key of Reflect.ownKeys(fields)){
  if(typeof key!=='string'||!Object.hasOwn(target,key)||typeof target[key]!=='string'||!('value' in Object.getOwnPropertyDescriptor(fields,key)))continue;
  const safe=copy(fields[key]);if(safe)accepted[key]=safe;
 }
 if(Object.keys(accepted).length)Object.defineProperty(target,renderMessageSymbol,{value:Object.freeze(accepted),enumerable:false,writable:false,configurable:false});
 return target;
}

/** Only for SDK read-only view copies. Never pass a signed document, transaction
 * review, operation request or grant through this seam. Metadata is copied and
 * subject to the same identity filtering; original metadata remains untouched.
 * Contract addresses are explicit source/asset identity, not wallet identities.
 * The original SDK objects and its comparisons remain untouched. */
export function privateReadProjection(value, authenticatedAccount) {
  // Exact paths from the mounted native SDK models. An arbitrary field called
  // contract, or a contract address repeated in wallet prose, is not exempt.
  const contractPaths = new Set(['identity.address','source.address','source.contract','asset.contract',
    'asset.value.identity.address','temporal.value.identity.address','linked.value.asset.contract',
    'ownershipHistory.value.identity.address','settlementLog.value.identity.address',
    'responsibility.asset.contract','occurrenceEvidence.asset.contract']);
  if (value?.kind === 'verified-detached-history') { contractPaths.add('controller'); contractPaths.add('token'); }
  const reduce = (item, key = '', path = '') => {
    if (typeof item === 'string') {
      if (identityNames.has(key)) return markers.hidden;
      if (identityFields.has(key) && !/^(0|[1-9][0-9]*)$/.test(item)) return markers[walletIdentityState(item, authenticatedAccount)];
      if (contractPaths.has(path) && address(item)) return item;
      // Prose can interpolate identities which are not separate fields, e.g.
      // registration meaning and acquisition disclosures. Keep contract IDs and
      // 32-byte commitments/hashes exact; never guess a sequence occurrence.
      return item.replace(/0x[0-9a-f]{40}(?![0-9a-f])/gi, match => markers[walletIdentityState(match, authenticatedAccount)]);
    }
    if (Array.isArray(item)) return Object.freeze(copyRenderMetadata(item,item.map(child => reduce(child, key, path + '[]')),reduce));
    if (!item || typeof item !== 'object') return item;
    // Arbitrary metadata can place identities in property names. Do not rename
    // those keys into a shared marker: collisions would silently discard data.
    // Suppress the smallest affected object in this display copy instead.
    if (Object.keys(item).some(field => /0x[0-9a-f]{40}(?![0-9a-f])/i.test(field))) return markers.hidden;
    return Object.freeze(copyRenderMetadata(item,Object.fromEntries(Object.entries(item).map(([field, child]) => [field,
      reduce(child, field, path ? path + '.' + field : field)])),reduce));
  };
  return reduce(value);
}
export function identityText(text, locale) {
  for (const [state, marker] of Object.entries(markers)) text = text.split(marker).join(walletIdentityText(state, locale));
  return text;
}
export function privateNativeUi(renderer, view, authenticatedAccount) {
  const safe = privateReadProjection(view, authenticatedAccount);
  return presentation(locale => identityText(renderer(safe, text => translateNative(text, locale)), locale));
}
/** Source-keyed native renderer seam. External narrative is never parsed as a template. */
export function privateKeyedNativeUi(renderer, view, authenticatedAccount) {
  const safe=privateReadProjection(view,authenticatedAccount);
  return presentation(locale=>identityText(renderer(safe,undefined,rendererMessages(locale)),locale));
}
export function privateReadDisplay(view, authenticatedAccount, disclosure = null) {
  const safe = privateReadProjection(view, authenticatedAccount);
  return presentation(locale => identityText(JSON.stringify(safe, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2), locale) +
    (disclosure === null ? '' : '\n\n' + renderUi(disclosure, locale)));
}

/** Explicit custom-event contract. No raw address, annotation, tooltip, extra
 * property or source object can cross from AssetView into the shell event. */
export function privateNativeSummary(view, authenticatedAccount) {
  const integer = value => typeof value === 'bigint' && value >= 0n && value < (1n << 256n) ? value.toString() : null;
  if (integer(view?.tokenId) === null || integer(view?.observedAt) === null ||
    integer(view?.confirmedHolder?.version) === null || typeof view?.presentFinality?.final !== 'boolean' ||
    !['open','none','unsupported'].includes(view?.gap?.kind) || view.gap.kind === 'open' && integer(view.gap.openedAt) === null)
    throw Error('IDENTITY_PRESENTATION_REFUSED');
  return Object.freeze({
    schema: '8415-native-summary/1', tokenId: integer(view?.tokenId),
    tradeablePosition: Object.freeze({ owner: walletIdentityState(view?.tradeablePosition?.owner, authenticatedAccount) }),
    confirmedHolder: Object.freeze({ holder: walletIdentityState(view?.confirmedHolder?.holder, authenticatedAccount), version: integer(view?.confirmedHolder?.version) }),
    presentFinality: Object.freeze({ final: view?.presentFinality?.final === true,
      agreement: ['consistent','disagrees'].includes(view?.presentFinality?.agreement) && typeof view?.presentFinality?.final === 'boolean' ? view.presentFinality.agreement : 'unverifiable' }),
    gap: Object.freeze({ kind: view.gap.kind, openedAt: integer(view?.gap?.openedAt) }),
    observedAt: integer(view?.observedAt),
  });
}
export function walletIdentityStateDisplay(state) {
  const reduced = Object.hasOwn(markers, state) ? state : 'unavailable';
  return presentation(locale => walletIdentityText(reduced, locale));
}

/** Human download is a distinctly named privacy projection, never the canonical
 * chain audit schema. The SDK export remains available unchanged internally. */
export function privateAuditDownload(download, authenticatedAccount) {
  const original = JSON.parse(download.json);
  if (original?.schema !== 'erc8415-wallet-audit/1') throw Error('IDENTITY_PRESENTATION_REFUSED');
  const projected = privateReadProjection(original, authenticatedAccount);
  const { schema: sourceSchema, ...view } = projected;
  const json = JSON.stringify({ schema: '8415-wallet-private-audit-view/1', sourceSchema,
    disclosure: 'Privacy-filtered display copy. Wallet identity markers are not addresses or verified sequence positions. This is not the canonical raw audit record.', view }, null, 2) + '\n';
  if (new TextEncoder().encode(json).byteLength > 2 * 1024 * 1024) throw Error('IDENTITY_PRESENTATION_REFUSED');
  return Object.freeze({ ...download, filename: 'erc8415-private-audit-' + original.tokenId + '.json', json });
}
