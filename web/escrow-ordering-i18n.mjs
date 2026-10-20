/** First-party presentation only. Machine classifications and evidence stay literal. */
import { presentation } from './i18n.mjs';

const notes = [
  'No independently bound transaction-position evidence; current or block-end observations do not establish release ordering.',
  'No corroborated successor in the release block. This is not proof that no later admission exists.',
  'Conflicting or incomplete source/entry/position evidence; no before/after conclusion.',
  'Same-transaction ordering is not established by this product path; log order alone is insufficient.',
  'The old prepared basis was superseded before the reverted release attempt. No successful release or execution-time entry read is inferred.',
  'The receipt-pinned release basis was superseded by a later transaction in the same block. The release anchor is retained; block-end state is a separate fact.',
  'Receipt outcome and ordering do not establish a supported before/after release classification.',
];
const labels = { 'superseded-after-release': 0, 'superseded-before-release-attempt': 1, unknown: 2 };
const catalog = {
  en: { labels: ['Superseded after release', 'Superseded before release attempt', 'Ordering unknown'], notes },
  'zh-Hans': {
    labels: ['放款后被替代', '放款尝试前已被替代', '先后关系未知'],
    notes: [
      '没有独立绑定的交易位置证据；当前或区块结束时的观察不能证明放款先后关系。',
      '放款所在区块内没有经佐证的后继登记。这不证明之后不存在其他登记。',
      '来源、登记或位置证据矛盾或不完整；不能作出先后结论。',
      '此产品路径尚未证明同一交易内部的顺序；仅凭日志顺序不足以判断。',
      '旧的准备时依据在已回滚的放款尝试之前被替代。这不推断放款成功，也不推断执行时读取了哪份登记。',
      '回执固定的放款依据被同一区块内较晚的交易替代。原放款锚保持不变；区块结束状态是另一项事实。',
      '回执结果和顺序不足以形成受支持的放款前后分类。',
    ],
  },
  'zh-Hant': {
    labels: ['放款後被取代', '放款嘗試前已被取代', '先後關係未知'],
    notes: [
      '沒有獨立綁定的交易位置證據；目前或區塊結束時的觀察不能證明放款先後關係。',
      '放款所在區塊內沒有經佐證的後繼登記。這不證明之後不存在其他登記。',
      '來源、登記或位置證據矛盾或不完整；不能作出先後結論。',
      '此產品路徑尚未證明同一交易內部的順序；僅憑日誌順序不足以判斷。',
      '舊的準備時依據在已回滾的放款嘗試之前被取代。這不推斷放款成功，也不推斷執行時讀取了哪份登記。',
      '回執固定的放款依據被同一區塊內較晚的交易取代。原放款錨保持不變；區塊結束狀態是另一項事實。',
      '回執結果和順序不足以形成受支援的放款前後分類。',
    ],
  },
  fr: {
    labels: ['Remplacé après la libération', 'Remplacé avant la tentative de libération', 'Ordre inconnu'],
    notes: [
      'Aucune preuve indépendante ne lie les positions des transactions ; les observations actuelles ou de fin de bloc ne prouvent pas l’ordre de libération.',
      'Aucune entrée suivante corroborée dans le bloc de libération. Cela ne prouve pas l’absence d’une admission ultérieure.',
      'Preuves de source, d’entrée ou de position contradictoires ou incomplètes ; aucune conclusion avant/après.',
      'Ce chemin produit n’établit pas l’ordre au sein d’une même transaction ; l’ordre des journaux seul ne suffit pas.',
      'L’ancienne base préparée a été remplacée avant la tentative de libération annulée. Cela ne prouve ni une libération réussie ni l’entrée lue pendant l’exécution.',
      'La base de libération fixée par le reçu a été remplacée par une transaction ultérieure du même bloc. L’ancrage de libération est conservé ; l’état de fin de bloc est un fait distinct.',
      'Le résultat du reçu et l’ordre ne permettent pas une classification avant/après de libération étayée.',
    ],
  },
  es: {
    labels: ['Sustituida después de la liberación', 'Sustituida antes del intento de liberación', 'Orden desconocido'],
    notes: [
      'No hay pruebas independientes que vinculen las posiciones de las transacciones; las observaciones actuales o al cierre del bloque no prueban el orden de liberación.',
      'No hay una entrada sucesora corroborada en el bloque de liberación. Esto no demuestra que no exista una admisión posterior.',
      'Pruebas de origen, entrada o posición contradictorias o incompletas; no se concluye un antes o después.',
      'Esta ruta del producto no establece el orden dentro de una misma transacción; el orden de los registros por sí solo no basta.',
      'La antigua base preparada fue sustituida antes del intento de liberación revertido. No se infiere una liberación exitosa ni qué entrada se leyó durante la ejecución.',
      'La base de liberación fijada por el recibo fue sustituida por una transacción posterior del mismo bloque. Se conserva el anclaje de liberación; el estado al cierre del bloque es un hecho separado.',
      'El resultado del recibo y el orden no permiten una clasificación fundamentada de antes o después de la liberación.',
    ],
  },
  ja: {
    labels: ['リリース後に置き換え', 'リリース試行前に置き換え済み', '順序不明'],
    notes: [
      '取引位置を独立に結び付ける証拠がありません。現在またはブロック終了時の観測からリリースの前後関係は判断できません。',
      'リリースと同じブロック内に裏付けられた後続登録がありません。その後の登録が存在しないことを意味しません。',
      'ソース、登録、位置の証拠が矛盾しているか不完全なため、前後関係を判断できません。',
      'この製品経路では同一取引内の順序は確認されていません。ログの順序だけでは不十分です。',
      '準備時の古い根拠は、リバートしたリリース試行より前に置き換えられました。リリースの成功や実行時に読まれた登録は推測しません。',
      'レシートに固定されたリリース根拠は、同じブロック内の後続取引で置き換えられました。元のリリースの基準は保持され、ブロック終了時の状態とは区別されます。',
      'レシートの結果と順序だけでは、根拠のあるリリース前後の分類はできません。',
    ],
  },
};

/** Do not mutate the reviewed read model or translate arbitrary provider text. */
export function escrowOrderingDisplay(ordering) {
  if (!ordering || typeof ordering !== 'object') return ordering;
  const label = Object.hasOwn(labels, ordering.classification) ? labels[ordering.classification] : undefined;
  const note = notes.indexOf(ordering.note);
  return { ...ordering,
    ...(label === undefined ? {} : { classificationLabel: presentation(language => (catalog[language] ?? catalog.en).labels[label]) }),
    ...(note < 0 ? {} : { note: presentation(language => (catalog[language] ?? catalog.en).notes[note]) }),
  };
}
