import type {Page} from '../../store/types'
export interface FirstStart {v:1;project:string;record:number;readinessPage:string}
/** A guide config contains no identity, credential or model-host id. */
export function firstStart(page:Page):FirstStart|null {
 const c=page.settings.firstStart
 return c?.v===1&&/^[a-z0-9_-]{1,100}$/.test(c.project)&&Number.isSafeInteger(c.record)&&c.record>0&&/^[\w-]{1,64}$/.test(c.readinessPage)?c:null
}
export function atlasStartPrompt(c:FirstStart,lang:'de'|'en') {
 return lang==='de'?`Prüfe meinen persönlichen Atlas-Zugang ausschließlich lesend. Nutze Atlas MCP: zuerst atlas_whoami, danach atlas_get für Record ${c.record} im Projekt ${c.project}. Verwende nur die echten Werkzeugergebnisse. Antworte kurz mit meinem Atlas-Namen, dem Projekt, der Record-Nummer, dem Titel und zwei Stichpunkten aus diesem Record. Nenne anschließend einen sinnvollen nächsten Arbeitsschritt in ONE. Ändere nichts, wechsle keinen Tenant und nutze weder Internet noch fremde Quellen. Falls ein Zugriff fehlt, nenne genau den fehlenden Schritt; erfinde keinen erfolgreichen Zugriff.`:`Check my personal Atlas access, read-only. Use Atlas MCP: first atlas_whoami, then atlas_get for record ${c.record} in project ${c.project}. Use real tool results only. Briefly report my Atlas name, project, record number, title and two points from that record. Suggest one useful next work step in ONE. Change nothing, do not switch tenant, and use no Internet or outside sources. If access is missing, name the exact missing step; never invent a successful connection.`
}
