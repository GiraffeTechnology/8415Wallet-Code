import {renderUi} from '../web/i18n.mjs';
/** Synthetic model fixtures only: no external RPC, accounts, signing or deployment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {divergentToken,TOKEN} from '../src/adapters/memory/scenarios.ts';
import {buildAssetView} from '../src/wallet/assetView.ts';
import {buildTemporalView} from '../src/wallet/temporalQuery.ts';
import {describeRegistration} from '../src/wallet/registration.ts';
import {describeAcquisition} from '../src/wallet/acquisition.ts';
import {describePosture} from '../src/wallet/posture.ts';
import {buildRiskSurfaces} from '../src/wallet/riskSurfaces.ts';
import {noWatchtower} from '../src/wallet/freshness.ts';
import {buildOwnershipHistory} from '../src/wallet/ownershipHistory.ts';
import {buildSettlementLog} from '../src/wallet/settlementLog.ts';
import {describeFinality} from '../src/wallet/finality.ts';
import {renderAssetView} from '../src/wallet/renderAssetView.ts';
import {renderTemporalQuery} from '../src/wallet/renderTemporalQuery.ts';
import {renderRegistration,renderAcquisitionDisclosure,renderPosture,renderOwnershipHistory} from '../src/wallet/renderHolderViews.ts';
import {renderRiskSurfaces,renderSettlementLog} from '../src/wallet/renderGapView.ts';
import {RENDER_MESSAGES,presentationMessage,presentationText,renderPresentationField} from '../src/wallet/renderMessages.ts';
import {rendererMessages} from '../web/renderer-messages.mjs';
import {privateReadProjection,identityText,privateKeyedNativeUi} from '../web/wallet-identity-display.mjs';
import {RENDERER_MODEL} from '../web/locales/renderer-model.mjs';
import {RENDERER_EXTRA} from '../web/locales/renderer-extra.mjs';
const locales=['en','zh-Hans','zh-Hant','fr','es','ja'];
const canonical=(value)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const hash=(value)=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
async function fixture(){const{reader}=divergentToken();const asset=await buildAssetView(reader,TOKEN);const temporal=await buildTemporalView(reader,TOKEN,asset.observedAt);
return{asset,temporal,reg:describeRegistration(asset),acq:describeAcquisition(asset,asset.observedAt),fresh:noWatchtower(),posture:describePosture(temporal.finality,noWatchtower()),risk:await buildRiskSurfaces(reader,TOKEN),own:await buildOwnershipHistory(reader,TOKEN),gaps:await buildSettlementLog(reader,TOKEN)};}
const renderers={asset:renderAssetView,temporal:renderTemporalQuery,reg:renderRegistration,acq:renderAcquisitionDisclosure,posture:renderPosture,risk:renderRiskSurfaces,own:renderOwnershipHistory,gaps:renderSettlementLog};

const GOLDEN={
  "asset": {
    "json": "7c288eb8a747976bac7475a0766f7e2826f04d01f99c39964f60bf5a02d0397f",
    "render": "581cc4ff27ad26f4eb77b4f6af2b83d9924292315f2c2d8bd65e1b3296f3bacf"
  },
  "temporal": {
    "json": "85aa015abd080cead91b8ba58eb24572b76f6dda927b7c05fdd5c786c94c2418",
    "render": "e482ec8fc65aa2b64c319337efc5958e7f499426123d1e9f86edc0ea8f60e53f"
  },
  "reg": {
    "json": "aaca25060e87d217ea2b1b7901a0a611322c7e0ab60bb3c9e5e69888b536ae61",
    "render": "319ea7ad0b911612dd8aa7b10b307520420731651ff3a70e8963a49968fc642f"
  },
  "acq": {
    "json": "8c52c07bdb04df59257a973af369b9ae89eebcc5ad6649d48e69274438e0ace3",
    "render": "7a21fed7cdfd3bb343210e8471c72e21ad6b8c4fce379bf5fa2169cd6ffacf95"
  },
  "fresh": {
    "json": "8a3eda24d59309a1db51b1e6a21372f57b75d4513cf932c6ef43d2ddd2e40e25"
  },
  "posture": {
    "json": "81e1ed2205e16d09e97f89147b316e55e3fd9cfc4d145a8d050efe457123b954",
    "render": "35295917a9f3532ff5af2200223cd38dd9c84e79877d36666e1edf21765bf9fd"
  },
  "risk": {
    "json": "6795497fea5c158305391676f6ae01c22cee1b8c7d6e2529fa6a3eb73a4dd0aa",
    "render": "646926fb277b9ef4d2f83891e4ac4a8763b75897d6fd9b6ede31599064d3a8b0"
  },
  "own": {
    "json": "b64422436c7dbd8fd9b8193e53e45909208827f562833fdfc4cf12cc3c64eb70",
    "render": "4ba5954cfb9e7c6020631abc325b5802df2e4f80b0bed19ff411c92805bd0ed2"
  },
  "gaps": {
    "json": "43d965edd2e50f11572db71146deeac232d4748298a3dffb020a29ad564694ba",
    "render": "638e2f2811bcfe1c292f9e7b9a61a2beec9ffd34336340aafa280be13da40d08"
  }
};
test('model canonical JSON and default English render bytes retain frozen pre-localization goldens',async()=>{
 const models=await fixture();for(const[key,value]of Object.entries(models)){
  assert.equal(hash(value),GOLDEN[key].json,key+' JSON');if(renderers[key])assert.equal(hash(renderers[key](value)),GOLDEN[key].render,key+' render');
  assert.doesNotMatch(canonical(value),/8415-render-message|renderer\.model|protocol\.0/);
 }
});
test('all six locales render source-keyed native prose after privacy reduction without mutating facts',async()=>{
 const models=await fixture(),before=canonical(models),owner=models.asset.tradeablePosition.owner,other=models.asset.confirmedHolder.holder;
 for(const locale of locales)for(const[key,render]of Object.entries(renderers)){
  const safe=privateReadProjection(models[key],owner),text=identityText(render(safe,undefined,rendererMessages(locale)),locale);
  assert.doesNotMatch(text,new RegExp(other,'i'),key+' neighbor '+locale);assert.doesNotMatch(text,/\{v[0-9]+\}/,key+' placeholder '+locale);
  if(locale!=='en')assert.notEqual(text,identityText(render(safe),locale),key+' localized '+locale);
 }
 assert.equal(canonical(models),before);
});
test('nested model descriptors are explicitly privacy-filtered and never appear in JSON, spread or toJSON paths',async()=>{
 const models=await fixture(),owner=models.asset.tradeablePosition.owner,other=models.asset.confirmedHolder.holder;
 const raw=models.acq.points[RENDER_MESSAGES];assert.ok(raw);assert.ok(JSON.stringify(raw).includes(other));
 const safe=privateReadProjection(models.acq,owner),meta=safe.points[RENDER_MESSAGES];assert.ok(meta);assert.doesNotMatch(JSON.stringify(meta),new RegExp(other,'i'));
 assert.doesNotMatch(canonical({...safe}),/8415-render-message/);assert.doesNotMatch(canonical(safe),/8415-render-message/);
 const cloned=JSON.parse(canonical(safe));assert.equal(cloned[RENDER_MESSAGES],undefined);assert.equal(renderAcquisitionDisclosure(cloned),renderAcquisitionDisclosure(safe));
});
test('unknown external narrative and placeholder-looking opaque values remain verbatim; no recursive interpolation',async()=>{
 const f=await fixture(),external='TRADEABLE POSITION {v0} <img src=x onerror=evil()>';
 const altered={...f.asset,tradeablePosition:{...f.asset.tradeablePosition,disclosure:external}};
 const text=renderAssetView(altered,undefined,rendererMessages('zh-Hans'));assert.ok(text.includes(external));
 const descriptor=presentationMessage('protocol.148','Token {v0}  ·  {v1}  ·  chain {v2}',{v0:'{v1}<script>',v1:'opaque',v2:'1'});
 assert.ok(presentationText(descriptor,rendererMessages('ja')).includes('{v1}<script>'));
});
test('privacy metadata rejects unknown templates, getters and extra fields without reading a getter',()=>{
 let getters=0;const value={note:'opaque'};const forged={schema:'8415-render-message/1',key:'protocol.002',template:'opaque',values:{}};
 Object.defineProperty(value,RENDER_MESSAGES,{value:{note:forged}});const reduced=privateReadProjection(value,'0x'+'1'.repeat(40));assert.equal(reduced[RENDER_MESSAGES],undefined);assert.equal(reduced.note,'opaque');
 const getter={note:'opaque'};Object.defineProperty(getter,RENDER_MESSAGES,{get(){getters++;return {};}});privateReadProjection(getter,'0x'+'1'.repeat(40));assert.equal(getters,0);
 assert.equal(renderPresentationField(getter,'note',rendererMessages('zh-Hans')),'opaque');assert.equal(getters,0);
});
test('unavailable finality keeps an external reason opaque while localizing the first-party explanation',()=>{
 const reason='TRADEABLE POSITION {v0} <raw external reason>';
 const view=describeFinality({tokenId:1n,instant:10n,reported:undefined,firstEffectiveAt:undefined,latestEffectiveAt:undefined,unavailableReason:reason});
 const localized=renderPresentationField(view,'explanation',rendererMessages('zh-Hans'));assert.ok(localized.includes(reason));assert.notEqual(localized,view.explanation);
 assert.equal(JSON.parse(canonical(view)).explanation,view.explanation);
});
test('new first-party model and supplementary catalogs cover the same keys and opaque placeholder sets in every locale',()=>{
 for(const catalog of [RENDERER_MODEL,RENDERER_EXTRA])for(const locale of locales){
  assert.deepEqual(Object.keys(catalog[locale]).sort(),Object.keys(catalog.en).sort());
  for(const[key,text]of Object.entries(catalog.en))assert.deepEqual([...catalog[locale][key].matchAll(/\{v[0-9]+\}/g)].map(x=>x[0]).sort(),[...text.matchAll(/\{v[0-9]+\}/g)].map(x=>x[0]).sort(),locale+':'+key);
 }
});

test('actual keyed private presentation caller changes locale without rescanning rendered prose',async()=>{
 const models=await fixture(),own=models.asset.tradeablePosition.owner,other=models.asset.confirmedHolder.holder;
 const display=privateKeyedNativeUi(renderRegistration,models.reg,own);
 const zh=renderUi(display,'zh-Hans'),fr=renderUi(display,'fr');
 assert.notEqual(zh,fr);assert.doesNotMatch(zh+fr,new RegExp(other,'i'));assert.match(zh,/登记/);assert.match(fr,/enregistr/i);
});
test('all finality branches retain exact reported facts and localize labels/explanations from descriptors',()=>{
 const cases=[{reported:undefined,firstEffectiveAt:undefined,latestEffectiveAt:undefined},
  {reported:true,firstEffectiveAt:20n,latestEffectiveAt:5n},{reported:false,firstEffectiveAt:20n,latestEffectiveAt:5n},
  {reported:true,firstEffectiveAt:20n,latestEffectiveAt:30n},{reported:true,firstEffectiveAt:1n,latestEffectiveAt:5n},
  {reported:true,firstEffectiveAt:1n,latestEffectiveAt:30n},{reported:false,firstEffectiveAt:20n,latestEffectiveAt:30n},
  {reported:false,firstEffectiveAt:1n,latestEffectiveAt:30n},{reported:false,firstEffectiveAt:1n,latestEffectiveAt:5n},
  {reported:true,firstEffectiveAt:undefined,latestEffectiveAt:30n},{reported:false,firstEffectiveAt:undefined,latestEffectiveAt:30n}];
 for(const facts of cases){const view=describeFinality({tokenId:1n,instant:10n,...facts}),before=canonical(view);
  for(const locale of locales.filter(x=>x!=='en'))for(const field of ['label','explanation']){let calls=0;const format=rendererMessages(locale);const localized=renderPresentationField(view,field,(...args)=>{calls++;return format(...args);});assert.ok(calls>0,canonical(facts)+' '+field+' '+locale);if(field==='explanation')assert.notEqual(localized,view[field]);}
  assert.equal(canonical(view),before);assert.equal(view.reported,facts.reported);
 }
});
test('configured freshness explanations and nested posture feed translate without changing classification or raw enum',async()=>{
 const{MemoryWatchtowerContract,MemoryWatchtowerReader}=await import('../src/adapters/memory/watchtower.ts');
 const{REGISTRAR}=await import('../src/adapters/memory/scenarios.ts');const{buildFreshnessView}=await import('../src/wallet/freshness.ts');
 for(const delay of [null,10n,40n,501n]){
  const assetId='0x'+'a5'.repeat(32),contract=new MemoryWatchtowerContract({blockNumber:1000n});contract.registerAsset(assetId,{steward:REGISTRAR,finalityDepth:32n,maxFreshnessThreshold:1000n});
  if(delay!==null){contract.submit(assetId,{signedAtBlock:1000n,sequenceNumber:1n,freshnessThreshold:500n,key:'0x9e900000000000000000000000000000000000aa'});contract.advanceBlocks(delay);}
  const view=await buildFreshnessView({reader:new MemoryWatchtowerReader(contract),assetId,provenance:'configured'}),before=canonical(view);
  for(const locale of locales.filter(x=>x!=='en'))assert.notEqual(renderPresentationField(view,'explanation',rendererMessages(locale)),view.explanation,view.display+' '+locale);
  assert.equal(canonical(view),before);
 }
});

 test('gap-state findings localize complete open and closed sentences in six locales without English negation parameters',async()=>{
 const {reader}=divergentToken();
 for(const closed of [true,false]){
  const gap='0x'+(closed?'00':'ab').repeat(32);
  const fixtureReader=new Proxy(reader,{get(target,key){if(key==='openGapOf')return async()=>gap;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const model=await buildRiskSurfaces(fixtureReader,TOKEN),surface=model.surfaces.find(x=>x.id==='held-open-gap');
  const before=canonical(model),descriptor=surface[RENDER_MESSAGES].finding;
  const key='renderer.model.riskSurfaces.'+(closed?'gapClosed':'gapOpen');
  assert.equal(descriptor.key,key);assert.deepEqual(Object.keys(descriptor.values),['v0']);
  assert.match(descriptor.values.v0,/^[0-9]+$/);
  assert.equal(renderPresentationField(surface,'finding'),surface.finding);
  assert.equal(surface.finding,descriptor.values.v0+' settlement(s) on this token were superseded rather than admitted or cancelled. A gap is '+(closed?'not ':'')+'open now.');
  for(const locale of locales){
   const localized=renderPresentationField(privateReadProjection(surface,undefined),'finding',rendererMessages(locale));
   assert.equal(localized,RENDERER_MODEL[locale][key].replace('{v0}',descriptor.values.v0));
   if(locale!=='en')assert.doesNotMatch(localized,/\bnot\b/);
  }
  assert.equal(canonical(model),before);
 }
});
