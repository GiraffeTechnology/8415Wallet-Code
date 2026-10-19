/** Independently authored fixed About text. No translation engine or service.
 * Draft copies do not declare which languages the current site actually serves.
 */
const copies = {
  "en": {
    "title": "About 8415wallet",
    "body": "8415wallet is the first native wallet built on ERC-8415, designed as AI + crypto infrastructure. It combines compatibility with the existing wallet ecosystem and established asset standards with native asynchronous registration and composable transaction chains.",
    "profiles": "V2 is a standalone wallet. V3 adds transaction-chain composition, asynchronous registration and bounded rollback. Humans control authorization; agents execute through APIs."
  },
  "zh-Hans": {
    "title": "关于 8415wallet",
    "body": "8415wallet 是首款基于 ERC-8415 的原生钱包，定位于 AI + 加密基础设施。它兼容现有钱包生态及通用资产标准，原生支持异步登记和可组合交易链。",
    "profiles": "V2 为独立钱包；V3 增加组链、异步登记及有界回滚能力。人类掌握授权，Agent 通过 API 执行。"
  },
  "zh-Hant": {
    "title": "關於 8415wallet",
    "body": "8415wallet 是首款基於 ERC-8415 的原生錢包，定位於 AI + 加密基礎設施。它兼容現有錢包生態及通用資產標準，原生支援非同步登記和可組合交易鏈。",
    "profiles": "V2 為獨立錢包；V3 增加組鏈、非同步登記及有界回滾能力。人類掌握授權，Agent 透過 API 執行。"
  },
  "fr": {
    "title": "À propos de 8415wallet",
    "body": "8415wallet est le premier portefeuille natif fondé sur ERC-8415, conçu comme une infrastructure associant IA et crypto. Il allie la compatibilité avec l’écosystème des portefeuilles existants et les standards d’actifs établis à la prise en charge native de l’enregistrement asynchrone et des chaînes de transactions composables.",
    "profiles": "V2 est un portefeuille autonome. V3 ajoute la composition de chaînes de transactions, l’enregistrement asynchrone et le retour arrière borné. Les humains contrôlent les autorisations ; les agents exécutent les opérations via des API."
  },
  "es": {
    "title": "Acerca de 8415wallet",
    "body": "8415wallet es la primera billetera nativa basada en ERC-8415, concebida como infraestructura de IA y cripto. Combina la compatibilidad con el ecosistema de billeteras existente y los estándares de activos establecidos con soporte nativo para el registro asíncrono y las cadenas de transacciones componibles.",
    "profiles": "V2 es una billetera independiente. V3 añade la composición de cadenas de transacciones, el registro asíncrono y la reversión acotada. Las personas controlan las autorizaciones; los agentes ejecutan las operaciones mediante API."
  },
  "ja": {
    "title": "8415wallet について",
    "body": "8415wallet は、ERC-8415 を基盤とする初のネイティブウォレットであり、AI と暗号資産のインフラとして設計されています。既存のウォレットエコシステムおよび一般的な資産標準との互換性に加え、非同期登録と組み合わせ可能な取引チェーンをネイティブにサポートします。",
    "profiles": "V2 は独立型ウォレットです。V3 は取引チェーンの構成、非同期登録、および境界を限定したロールバックに対応します。人間が権限を管理し、エージェントは API を通じて操作を実行します。"
  }
};
for (const text of Object.values(copies)) Object.freeze(text);
Object.freeze(copies);
export function aboutContent(locale, servedLocales) {
  if (!Array.isArray(servedLocales) || !servedLocales.includes(locale) ||
      !Object.hasOwn(copies, locale)) throw Error('ABOUT_LOCALE_NOT_CONFIGURED');
  return copies[locale];
}
export function renderAbout(root, locale, servedLocales) {
  const content = aboutContent(locale, servedLocales), document = root.ownerDocument;
  const heading = document.createElement('h2'), body = document.createElement('p'), profiles = document.createElement('p');
  heading.textContent = content.title; body.textContent = content.body; profiles.textContent = content.profiles;
  root.replaceChildren(heading, body, profiles); root.setAttribute('lang', locale);
  return content;
}
/** Reuse the existing menu as-is: no locale insertion, deletion or reordering.
 * The deployment owner must verify that menu against the actual served site.
 */
export function bindAbout(root, selector, label = null) {
  if (!root || !selector || !selector.options) throw Error('ABOUT_LANGUAGE_ENTRY_REQUIRED');
  const render = () => {
    const content = renderAbout(root, selector.value, [...selector.options].map(option => option.value));
    if (label) label.textContent = content.title;
  };
  selector.addEventListener('change', render);
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(render) : null;
  observer?.observe(root.ownerDocument.documentElement, { attributes: true, attributeFilter: ['lang'] });
  try { render(); } catch (error) { selector.removeEventListener('change', render); observer?.disconnect(); throw error; }
  return () => { selector.removeEventListener('change', render); observer?.disconnect(); };
}
