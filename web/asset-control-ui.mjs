/** Human settings view. Only a source-bound client can read/save a single field.
 * UI drafts never write, sign transactions, grant Agent authority or reset state.
 */
import { paint, presentation } from './i18n.mjs';
import { policyText } from './locales/task-verification-policy.mjs';
const words = {
  en: { title: 'Agent and asset authorization', read: 'Read saved settings', allow: 'Allow Agent', all: 'ALL assets', fungible: 'Fungible assets', nonfungible: 'NFTs', incomplete: 'Asset inventory is incomplete. Only returned asset identities are listed; no balance or ownership is inferred.', note: 'Every save requires two established human factors. Asset ON includes descendants; asset OFF expands child choices. Operation overrides remain separate. Draft changes do not take effect.', operations: 'Operation permission', inherited: 'Inherited / default', saved: 'Owner-saved', field: 'Field revision' },
  'zh-Hans': { title: 'Agent 与资产授权', read: '读取已保存设置', allow: '允许 Agent', all: '全部资产', fungible: '同质化资产', nonfungible: 'NFT', incomplete: '资产清单不完整。仅列出已返回的资产标识，不推断余额或所有权。', note: '每次保存均需两个已建立的人工验证因素。资产 ON 覆盖下级；资产 OFF 展开下级选择。操作权限的覆盖设置另行保留。草稿不会生效。', operations: '操作权限', inherited: '继承／默认', saved: '所有者已保存', field: '字段版本' },
  'zh-Hant': { title: 'Agent 與資產授權', read: '讀取已儲存設定', allow: '允許 Agent', all: '全部資產', fungible: '同質化資產', nonfungible: 'NFT', incomplete: '資產清單不完整。僅列出已返回的資產識別，不推斷餘額或所有權。', note: '每次儲存均須兩個已建立的人工驗證因素。資產 ON 涵蓋下級；資產 OFF 展開下級選擇。操作權限覆寫另行保留。草稿不會生效。', operations: '操作權限', inherited: '繼承／預設', saved: '所有者已儲存', field: '欄位版本' },
  fr: { title: 'Autorisation des agents et actifs', read: 'Lire les paramètres enregistrés', allow: 'Autoriser l’agent', all: 'TOUS les actifs', fungible: 'Actifs fongibles', nonfungible: 'NFT', incomplete: 'Inventaire incomplet. Seuls les identifiants reçus sont affichés ; aucun solde ni titre de propriété n’est déduit.', note: 'Chaque enregistrement exige deux facteurs humains établis. ON couvre les descendants ; OFF développe leurs choix. Les dérogations par opération restent distinctes. Un brouillon ne prend pas effet.', operations: 'Permission d’opération', inherited: 'Hérité / défaut', saved: 'Enregistré par le propriétaire', field: 'Révision du champ' },
  es: { title: 'Autorización de agentes y activos', read: 'Leer ajustes guardados', allow: 'Permitir agente', all: 'TODOS los activos', fungible: 'Activos fungibles', nonfungible: 'NFT', incomplete: 'Inventario incompleto. Solo se muestran identidades recibidas; no se infieren saldos ni propiedad.', note: 'Cada guardado exige dos factores humanos establecidos. ON incluye descendientes; OFF despliega sus opciones. Las excepciones de operación son independientes. Los borradores no surten efecto.', operations: 'Permiso de operación', inherited: 'Heredado / predeterminado', saved: 'Guardado por el propietario', field: 'Revisión del campo' },
  ja: { title: 'Agent と資産の権限', read: '保存済み設定を読む', allow: 'Agent を許可', all: '全資産', fungible: '代替可能な資産', nonfungible: 'NFT', incomplete: '資産一覧は未完です。取得した資産識別子のみ表示し、残高や所有権を推定しません。', note: '保存ごとに既存の本人確認要素が2つ必要です。資産 ON は下位を含み、OFF は下位の選択を展開します。操作別の上書きは別です。下書きは反映されません。', operations: '操作権限', inherited: '継承／初期値', saved: '所有者が保存済み', field: '項目の版' },
};
let nextFieldLabel = 0;
const text = (node, key) => paint(node, presentation(locale => words[locale]?.[key] ?? words.en[key]));
const policy = (node, key) => paint(node, presentation(locale => policyText(key, {}, locale)));
const operations = ['wallet:native-transfer', 'wallet:erc20-transfer', 'wallet:erc721-transfer', 'wallet:erc1155-transfer', 'wallet:receive',
  'erc8183:createJob', 'erc8183:setProvider', 'erc8183:setBudget', 'erc8183:fund', 'erc8183:submit', 'erc8183:complete', 'erc8183:reject', 'erc8183:claimRefund'];
export function mountAssetControls({ document, walletLogin, host, getClient }) {
  let visible = false, epoch = 0, abort = null, state = null, busy = false, destroyed = false;
  const node = (tag, parent, key) => { const e = document.createElement(tag); if (key) text(e, key); parent?.append(e); return e; };
  const title = node('h3', host, 'title'); title.id = 'asset-controls-title'; host.setAttribute('aria-labelledby', title.id);
  node('p', host, 'note');
  const refresh = node('button', host, 'read'); refresh.type = 'button';
  const status = node('p', host); status.setAttribute('role', 'status');
  const inventory = node('p', host, 'incomplete'); inventory.hidden = true;
  const rows = node('div', host);
  const controls = () => { refresh.disabled = busy; for (const e of rows.querySelectorAll('button,select')) e.disabled = busy || !state?.canChange; };
  const clear = () => { epoch++; abort?.abort(); abort = new AbortController(); state = null; rows.replaceChildren(); inventory.hidden = true; };
  const valid = (ticket, binding, client) => {
    if (destroyed || !visible || host.hidden || ticket !== epoch || abort.signal.aborted || getClient() !== client) throw Error('ASSET_CONTROL_VIEW_CHANGED');
    return walletLogin.assert(binding);
  };
  function field(target) {
    const own = state.view.entries.find(entry => JSON.stringify(entry.target) === JSON.stringify(target));
    if (own) return own;
    let value = true;
    if (target.kind === 'operation') {
      // Operation permissions use nearest explicit ancestor inheritance, unlike
      // the asset tree's blanket-ON rule. Keep own field revision at zero.
      for (let length = 1; length < target.path.length; length++) {
        const parent = { kind: 'operation', path: target.path.slice(0, length), operation: target.operation };
        const entry = state.view.entries.find(item => JSON.stringify(item.target) === JSON.stringify(parent));
        if (entry) value = entry.value;
      }
    }
    return { value, revision: '0', target };
  }
  function fieldRow(parent, target, label, key = null) {
    const row = node('div', parent); row.className = 'foundation-policy-row';
    const name = node('span', row, key); if (!key) name.textContent = label;
    const prior = field(target), saved = node('span', row); saved.textContent = prior.value ? 'ON' : 'OFF';
    saved.className = 'asset-control-state'; saved.setAttribute('data-state', saved.textContent);
    const source = node('small', row, prior.revision === '0' ? 'inherited' : 'saved');
    const version = node('small', row, 'field'); version.append(document.createTextNode(': ' + prior.revision));
    name.id = 'asset-control-label-' + (++nextFieldLabel);
    const draft = node('select', row); draft.className = 'asset-control-choice'; draft.setAttribute('aria-labelledby', name.id);
    for (const mode of ['ON', 'OFF']) { const option = node('option', draft); option.value = mode; option.textContent = mode; }
    draft.value = prior.value ? 'ON' : 'OFF';
    draft.setAttribute('data-state', draft.value);
    draft.addEventListener('change', () => draft.setAttribute('data-state', draft.value));
    const save = node('button', row); save.type = 'button'; policy(save, 'save');
    save.addEventListener('click', () => {
      // An inherited value may intentionally become an explicit child override.
      if (prior.revision === '0' || draft.value !== (prior.value ? 'ON' : 'OFF')) void saveField(target, draft.value === 'ON', label);
    });
    return prior;
  }
  function render() {
    rows.replaceChildren(); inventory.hidden = state.catalog.inventoryComplete;
    fieldRow(rows, { kind: 'allow-agent' }, 'Allow Agent', 'allow');
    const tree = { path: ['all'], label: 'ALL', key: 'all', children: new Map() };
    // Fixed policy categories exist without claiming any individual holding.
    // Only catalog entries below may add asset leaves.
    for (const item of state.catalog.branches) {
      let branch = tree;
      for (let level = 1; level < item.path.length; level++) {
        const id = item.path[level];
        if (!branch.children.has(id)) branch.children.set(id, { path: item.path.slice(0, level + 1),
          key: level === 1 ? id === 'category:fungible' ? 'fungible' : 'nonfungible' : null,
          label: level === 1 ? id : `${item.standard} · ${state.view.scope.chainId}`, children: new Map() });
        branch = branch.children.get(id);
      }
    }
    for (const entry of state.catalog.entries) {
      let branch = tree;
      for (let level = 1; level < 4; level++) {
        const id = entry.path[level];
        if (!branch.children.has(id)) branch.children.set(id, { path: entry.path.slice(0, level + 1),
          key: level === 1 ? id === 'category:fungible' ? 'fungible' : 'nonfungible' : null,
          label: level === 1 ? id : level === 2 ? `${entry.subject.standard} · ${entry.subject.chainId}` :
            entry.subject.standard === 'native' ? `native · ${entry.subject.chainId}` : `${entry.subject.contract}${entry.subject.tokenId === null ? '' : ' · ' + entry.subject.tokenId}`,
          children: new Map() });
        branch = branch.children.get(id);
      }
    }
    // Previously saved scopes remain visible even when the current inventory
    // reader cannot return their asset. Opaque policy IDs are not holdings.
    for (const entry of state.view.entries.filter(item => item.target.kind !== 'allow-agent')) {
      let branch = tree;
      for (let level = 1; level < entry.target.path.length; level++) {
        const id = entry.target.path[level];
        if (!branch.children.has(id)) branch.children.set(id, { path: entry.target.path.slice(0, level + 1),
          key: null, label: id, children: new Map() });
        branch = branch.children.get(id);
      }
    }
    function branch(nodeData, parent) {
      const section = node('details', parent); section.open = !field({ kind: 'asset', path: nodeData.path }).value || nodeData.path.length === 1;
      const heading = node('summary', section, nodeData.key); if (!nodeData.key) heading.textContent = nodeData.label;
      fieldRow(section, { kind: 'asset', path: nodeData.path }, nodeData.label, nodeData.key);
      const opDetails = node('details', section); node('summary', opDetails, 'operations');
      for (const operation of operations) fieldRow(opDetails, { kind: 'operation', path: nodeData.path, operation }, operation);
      for (const child of nodeData.children.values()) branch(child, section);
    }
    branch(tree, rows); controls();
  }
  async function read() {
    if (!visible || busy || destroyed) return;
    clear(); const ticket = epoch, signal = abort.signal; busy = true; controls(); policy(status, 'state.loading');
    try {
      const binding = walletLogin.capture(), client = getClient(); valid(ticket, binding, client);
      if (!client) throw Error('ASSET_CONTROL_UNAVAILABLE');
      const next = await client.read({ binding, signal }); valid(ticket, binding, client);
      state = next; render(); policy(status, next.changeState === 'unknown' ? 'state.unknown' : next.canChange ? 'state.ready' : 'state.readOnly');
    } catch { if (ticket === epoch && visible) { state = null; rows.replaceChildren(); policy(status, 'state.unavailable'); } }
    finally { busy = false; controls(); if (ticket !== epoch && visible && !destroyed) void read(); }
  }
  async function saveField(target, value, label) {
    if (busy || !visible || !state?.canChange) return;
    const reviewed = state.view, existing = field(target), ticket = epoch, signal = abort.signal;
    const binding = walletLogin.capture(), client = getClient();
    busy = true; controls(); policy(status, 'state.verifying');
    try {
      valid(ticket, binding, client);
      await client.change({ binding, signal, reviewed, scopeLabel: label,
        patch: { target, value, expectedFieldRevision: existing.revision } });
      valid(ticket, binding, client);
    } catch { if (ticket === epoch && visible) policy(status, 'notice.notSaved'); }
    finally { busy = false; controls(); if (visible && !destroyed) void read(); }
  }
  refresh.addEventListener('click', () => void read());
  const unsubscribe = walletLogin.subscribe(() => { clear(); if (visible && !busy) void read(); });
  return Object.freeze({
    show() { if (destroyed || visible) return; visible = true; host.hidden = false; void read(); },
    hide() { visible = false; host.hidden = true; clear(); },
    destroy() { destroyed = true; visible = false; clear(); unsubscribe?.(); host.replaceChildren(); },
  });
}
