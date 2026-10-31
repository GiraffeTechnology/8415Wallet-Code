/** Only source-authored keys/templates cross this boundary. Inserted values are
 * opaque and substituted once; neither metadata nor RPC text is a lookup key. */
export type RendererMessageFormatter = (key: string, template: string, values: Readonly<Record<string, string>>) => string;
export function interpolateRendererMessage(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(v[0-9]+)\}/g, (token, name: string) => Object.hasOwn(values, name) ? values[name]! : token);
}
export function createRendererMessages(legacy: (text: string) => string, format?: RendererMessageFormatter): RendererMessageFormatter {
  return (key, template, values) => format ? format(key, template, values) : interpolateRendererMessage(legacy(template), values);
}

export type PresentationMessage = Readonly<{schema:'8415-render-message/1';key:string;template:string;values:Readonly<Record<string,string|PresentationMessage>>}>;
export const RENDER_MESSAGES = Symbol.for('8415wallet.render-messages/1');
export function presentationMessage(key:string, template:string, values:Readonly<Record<string,string|PresentationMessage>> = {}):PresentationMessage {
 return Object.freeze({schema:'8415-render-message/1',key,template,values:Object.freeze({...values})});
}
function validPresentation(value:unknown,depth=0):value is PresentationMessage {
 if(depth>12||!value||typeof value!=='object'||Array.isArray(value))return false;
 const record=value as Record<string,unknown>,keys=['schema','key','template','values'];
 if(Reflect.ownKeys(record).length!==keys.length||keys.some(key=>!Object.hasOwn(record,key)||!('value' in Object.getOwnPropertyDescriptor(record,key)!)))return false;
 if(record.schema!=='8415-render-message/1'||typeof record.key!=='string'||typeof record.template!=='string'||record.template.length>16384)return false;
 const values=record.values;if(!values||typeof values!=='object'||Array.isArray(values)||Reflect.ownKeys(values).length>32)return false;
 const expected=new Set([...record.template.matchAll(/\{(v[0-9]+)\}/g)].map(match=>match[1]));
 for(const key of Reflect.ownKeys(values)){
  if(typeof key!=='string'||!expected.has(key)||!('value' in Object.getOwnPropertyDescriptor(values,key)!))return false;
  const item=(values as Record<string,unknown>)[key];if(typeof item==='string'?item.length>65536:!validPresentation(item,depth+1))return false;
 }
 return expected.size===Reflect.ownKeys(values).length;
}
export function presentationText(value:PresentationMessage, format?:RendererMessageFormatter):string {
 if(!validPresentation(value))throw Error('RENDER_MESSAGE_DESCRIPTOR_REFUSED');
 const values=Object.fromEntries(Object.entries(value.values).map(([key,item])=>[key,typeof item==='string'?item:presentationText(item,format)]));
 return format?format(value.key,value.template,values):interpolateRendererMessage(value.template,values);
}
export function withPresentation<T extends object>(value:T, fields:Readonly<Record<string,PresentationMessage|undefined>>):T {
 const accepted=Object.fromEntries(Object.entries(fields).filter(([key,item])=>item!==undefined && (value as Record<string,unknown>)[key]===presentationText(item)));
 Object.defineProperty(value,RENDER_MESSAGES,{value:Object.freeze(accepted),enumerable:false,writable:false,configurable:false});
 return value;
}
export function presentationValue(value:unknown,key:string):string|PresentationMessage {
 if(value&&typeof value==='object'){
  const fields=Object.getOwnPropertyDescriptor(value,RENDER_MESSAGES)?.value;
  const item=fields&&typeof fields==='object'?Object.getOwnPropertyDescriptor(fields,key)?.value:undefined;
  if(validPresentation(item)&&presentationText(item)===(value as Record<string,unknown>)[key])return item;
  return String((value as Record<string,unknown>)[key]);
 }
 return String(value);
}
export function renderPresentationField(value:unknown,key:string,format:RendererMessageFormatter):string {
 const item=presentationValue(value,key);return typeof item==='string'?item:presentationText(item,format);
}
export function pushPresentation(values:string[], message:PresentationMessage):number {
 const index=String(values.length);values.push(presentationText(message));
 const prior=(values as unknown as Record<symbol,Readonly<Record<string,PresentationMessage>>>)[RENDER_MESSAGES]??{};
 // Arrays are assembled locally; metadata is finalized on every append and is not serialized.
 Object.defineProperty(values,RENDER_MESSAGES,{value:Object.freeze({...prior,[index]:message}),enumerable:false,writable:false,configurable:true});
 return values.length;
}
