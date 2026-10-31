/** Explicit source-key localization, never a parser of rendered or external text. */
import {t} from './i18n.mjs';
import {RENDERER_MODEL} from './locales/renderer-model.mjs';
import {RENDERER_EXTRA} from './locales/renderer-extra.mjs';
export function rendererMessages(locale) {
 return (key, template, values) => {
  const prefix=template.match(/^\s*/)[0],suffix=template.match(/\s*$/)[0];
  const extra=key==='renderer.join'?template.trim():RENDERER_EXTRA[locale]?.[key]??RENDERER_MODEL[locale]?.[key];
  return prefix+(extra===undefined?t(key,values,locale):extra.replace(/\{(v[0-9]+)\}/g,(token,name)=>Object.hasOwn(values,name)?values[name]:token))+suffix;
 };
}
