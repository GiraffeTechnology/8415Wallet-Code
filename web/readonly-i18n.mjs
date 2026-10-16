/** Fixed first-party labels only. Never translate observations, metadata or terms. */
import { paint, presentation } from './i18n.mjs';
import catalog from './locales/readonly-panels.mjs';
export function readOnlyText(key, language = 'en') {
  const values = catalog[language] ?? catalog.en;
  if (!Object.hasOwn(catalog.en, key)) throw new Error('READONLY_MESSAGE_UNKNOWN');
  return values[key] ?? catalog.en[key];
}
export const readOnlyMessage = key => {
  readOnlyText(key);
  return presentation(language => readOnlyText(key, language));
};
export const readOnlyPaint = (element, key) => paint(element, readOnlyMessage(key));
/** Bind a separate span: repainting a label must never remove its input child. */
export function readOnlyLabel(label, key, document = globalThis.document) {
  const text = document.createElement('span'); readOnlyPaint(text, key); label.append(text); return text;
}
