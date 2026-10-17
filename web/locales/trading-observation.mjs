// Explicit first-party fixed messages only; no imported terms or runtime values.
export default Object.freeze({
  "en": Object.freeze({
    "trade.projection-final-feed-fresh": "Projection final at the query instant; configured feed currently fresh. This does not establish commercial settlement.",
    "trade.projection-provisional-feed-fresh": "Projection provisional; configured feed currently fresh. A later admission may change the answer; no arrival time is promised.",
    "trade.feed-not-current": "Configured feed not current: distinct from ordinary registration pending, whatever the projection reports.",
    "trade.insufficient-observation": "Insufficient combined observation. Unknown feed, unavailable or uncovered projection is not ordinary pending.",
    "trade.caveat": "Sequential live reads, not an atomic snapshot. Freshness is current, not at the historical query instant. Feed pairing remains unverified configuration; contest remains separate. No release, refund, entitlement, legal identity, completed sale or safe-trade verdict follows."
  }),
  "zh-Hans": Object.freeze({
    "trade.projection-final-feed-fresh": "投影在查询时点为 final；配置的 feed 当前为 fresh。这不证明商业结算完成。",
    "trade.projection-provisional-feed-fresh": "投影为 provisional；配置的 feed 当前为 fresh。后续登记可能改变答案，不承诺登记到达时间。",
    "trade.feed-not-current": "配置的 feed 已非当前有效状态；无论投影如何报告，都须与普通登记等待区分。",
    "trade.insufficient-observation": "联合观察不足。feed 未知，或投影不可用／不覆盖该时点，不等于普通等待。",
    "trade.caveat": "这是顺序实时读取，不是原子快照。freshness 是当前状态，不是历史查询时点的状态。feed 关联仍为未验证配置；争议状态单独呈现。不能据此推导释放、退款、权益、法律身份、成交完成或交易安全。"
  }),
  "zh-Hant": Object.freeze({
    "trade.projection-final-feed-fresh": "投影在查詢時點為 final；設定的 feed 目前為 fresh。這不證明商業結算完成。",
    "trade.projection-provisional-feed-fresh": "投影為 provisional；設定的 feed 目前為 fresh。後續登記可能改變答案，不承諾登記到達時間。",
    "trade.feed-not-current": "設定的 feed 已非目前有效狀態；無論投影如何回報，都須與一般登記等待區分。",
    "trade.insufficient-observation": "聯合觀察不足。feed 未知，或投影無法使用／不涵蓋該時點，不等於一般等待。",
    "trade.caveat": "這是循序即時讀取，不是原子快照。freshness 是目前狀態，不是歷史查詢時點的狀態。feed 關聯仍為未驗證設定；爭議狀態獨立呈現。不能據此推導釋放、退款、權益、法律身分、成交完成或交易安全。"
  }),
  "fr": Object.freeze({
    "trade.projection-final-feed-fresh": "Projection finale à l’instant demandé ; flux configuré actuellement frais. Cela ne prouve pas un règlement commercial.",
    "trade.projection-provisional-feed-fresh": "Projection provisoire ; flux configuré actuellement frais. Une admission ultérieure peut modifier la réponse ; aucun délai n’est promis.",
    "trade.feed-not-current": "Le flux configuré n’est plus à jour : ce n’est pas une simple attente d’enregistrement, quelle que soit la projection.",
    "trade.insufficient-observation": "Observation combinée insuffisante. Un flux inconnu ou une projection indisponible ou hors couverture n’est pas une simple attente.",
    "trade.caveat": "Lectures courantes séquentielles, pas un instantané atomique. La fraîcheur est actuelle, pas celle de l’instant historique demandé. L’association du flux reste une configuration non vérifiée ; la contestation reste distincte. Aucune libération, aucun remboursement, droit, identité juridique, vente conclue ou verdict de sûreté n’en découle."
  }),
  "es": Object.freeze({
    "trade.projection-final-feed-fresh": "Proyección final en el instante consultado; feed configurado actualmente fresco. No demuestra una liquidación comercial.",
    "trade.projection-provisional-feed-fresh": "Proyección provisional; feed configurado actualmente fresco. Una admisión posterior puede cambiar la respuesta; no se promete un plazo.",
    "trade.feed-not-current": "El feed configurado no está actualizado: no es una espera ordinaria de registro, independientemente de la proyección.",
    "trade.insufficient-observation": "Observación conjunta insuficiente. Un feed desconocido o una proyección no disponible o sin cobertura no equivale a una espera ordinaria.",
    "trade.caveat": "Lecturas actuales secuenciales, no una instantánea atómica. La frescura es actual, no la del instante histórico consultado. La asociación del feed sigue siendo configuración no verificada; la disputa se muestra por separado. No implica liberación, reembolso, derechos, identidad jurídica, venta completada ni seguridad de una operación."
  }),
  "ja": Object.freeze({
    "trade.projection-final-feed-fresh": "照会時点の投影は final、設定された feed は現在 fresh です。商業上の決済完了を証明するものではありません。",
    "trade.projection-provisional-feed-fresh": "投影は provisional、設定された feed は現在 fresh です。後続の登録受理で回答が変わる可能性があり、到着時刻は保証しません。",
    "trade.feed-not-current": "設定された feed は現在有効な状態ではありません。投影の回答にかかわらず、通常の登録待ちとは区別します。",
    "trade.insufficient-observation": "組み合わせた観測が不足しています。feed が不明、投影が利用不能または対象時点をカバーしないことは、通常の待機とは異なります。",
    "trade.caveat": "順次行う現在の読み取りであり、原子的なスナップショットではありません。freshness は現在の状態で、過去の照会時点の状態ではありません。feed の対応付けは未検証の設定で、争議状態は別表示です。解放、返金、権利、法的同一性、売買完了、取引安全性を導くものではありません。"
  }),
});
