/** Public-shell fallback only. No account lookup, auth bypass, or private files. */
const reserved = new Set(['auth','api','web','assets','dist','docs','scripts','server','tests','config','login','logout','register','about','settings','default','__proto__','constructor','prototype']);
function isCanonicalWalletRequest(value) {
  if (typeof value !== 'string' || !/^\/[a-z][a-z0-9-]{0,47}$/.test(value)) return false;
  return !reserved.has(value.slice(1));
}
function canonicalEntryHtml(html, publicEntryPath = '/web/index.html') {
  if (typeof publicEntryPath !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*web\/index\.html$/.test(publicEntryPath)) throw Error('PUBLIC_ENTRY_PATH_REFUSED');
  // The source is the shipped public index, not caller-controlled HTML. Resolve
  // its relative static assets against /web/, without adding a base element or
  // weakening the existing base-uri 'none' CSP. The legacy index is unchanged.
  return html.replace(/\b(src|href)="([^"\r\n]+)"/g, (attribute, name, value) => {
    if (/^(?:[a-z]+:|\/|#)/i.test(value)) return attribute;
    const resolved = new URL(value, `https://static.example.invalid${publicEntryPath}`);
    const prefix = publicEntryPath.slice(0, -'web/index.html'.length);
    if (resolved.search || resolved.hash || !resolved.pathname.startsWith(prefix + 'web/') && !resolved.pathname.startsWith(prefix + 'dist/browser/')) return attribute;
    return `${name}="${resolved.pathname}"`;
  });
}
module.exports = { isCanonicalWalletRequest, canonicalEntryHtml };
