/** Authored first-party read-status labels only. External strings remain exact. */
const keys = ['ready','partial','unavailable','complete','unknown','PENDING','DONE','UNAVAILABLE'];
export const READ_STATE_TEXT = Object.freeze(Object.fromEntries(Object.entries({
 en:['Ready','Partial','Unavailable','Complete','Unknown','Pending','Done','Unavailable'],
 'zh-Hans':['就绪','部分可用','不可用','完整','未知','处理中','已完成','不可用'],
 'zh-Hant':['就緒','部分可用','無法使用','完整','未知','處理中','已完成','無法使用'],
 fr:['Prêt','Partiel','Indisponible','Complet','Inconnu','En cours','Terminé','Indisponible'],
 es:['Listo','Parcial','No disponible','Completo','Desconocido','Pendiente','Completado','No disponible'],
 ja:['準備完了','一部利用可能','利用不可','完全','不明','処理中','完了','利用不可']
}).map(([locale,values])=>[locale,Object.freeze(Object.fromEntries(keys.map((key,i)=>[key,values[i]])))])));
export const readStateText=(state,locale='en')=>Object.hasOwn(READ_STATE_TEXT.en,state)?(READ_STATE_TEXT[locale]??READ_STATE_TEXT.en)[state]:String(state??'—');
