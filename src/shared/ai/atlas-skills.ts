import {stateHash} from '../quandprofile/runtime.ts'
import {parseSkillFile,skillSpec,bindSkill,atlasSkillSource,SkillError,type AtlasSkillSource,type Skill,type SkillSpec} from './skills.ts'

/** A source must explicitly contain a definition. A title/tag alone never becomes instructions. */
export function skillFromAtlasBody(body:string):SkillSpec {
 if(body.length>80000)throw new SkillError('limit')
 const text=body.trim()
 if(text.startsWith('---\n')||text.startsWith('---\r\n'))return parseSkillFile(text+'\n').spec
 if(text.startsWith('{')){try{return skillSpec(JSON.parse(text))}catch{throw new SkillError('invalid')}}
 const blocks=[...text.matchAll(/```(?:markdown|md|skill)\s*\n([\s\S]*?)\n```/gu)]
 if(blocks.length!==1)throw new SkillError('invalid')
 return parseSkillFile(blocks[0]![1]+'\n').spec
}

/** A new local revision is explicit; an existing recipe keeps its previous content AND source. */
export function atlasSkillVersion(rows:Skill[],spec:SkillSpec,raw:AtlasSkillSource):Skill {
 const source=atlasSkillSource(raw),id='atlas-'+stateHash([source.origin,source.tenant,source.project,source.ref]).slice(0,32)
 if(rows.some(s=>s.spec.name===spec.name&&s.id!==id||s.id===id&&s.spec.name!==spec.name))throw new SkillError('changed')
 const versions=rows.filter(s=>s.id===id),same=versions.find(s=>s.hash===bindSkill(id,s.version,spec,source).hash)
 return same??bindSkill(id,Math.max(0,...versions.map(s=>s.version))+1,spec,source)
}

export const ATLAS_ALIGNMENT_SKILL:SkillSpec={
 name:'atlas-abgleich',description:'ONE-Inhalte und Atlas gezielt abgleichen: Ziel klären, Quellen lesen, Änderungen nachvollziehbar vorbereiten und prüfen.',tags:['Atlas','Abgleich'],
 instructions:'Verwende die vom Nutzer ausgewählten ONE-Seiten, Unterseiten oder Textstellen als Ausgangspunkt. Unterscheide diese Quellen von Nutzerentscheidungen und deinen Vorschlägen. Atlas ist ein verfügbares Werkzeug, keine automatische Pflicht. Wenn nur ONE-Seiten gewünscht sind, arbeite in ONE.\n\nBei einer gewünschten Atlas-Übertragung kläre anhand des Auftrags und Kontexts, ob ein Record erstellt, aktualisiert oder ein Kommentar ergänzt werden soll. Ist das Ziel unklar, stelle genau die notwendige Rückfrage mit diesen Möglichkeiten. Verlange keinen bestehenden Record, wenn ein neuer erstellt werden soll. Erfinde weder Ziel-Ref noch Projekt.\n\nNutze ausschließlich die persönliche freigegebene Verbindung und die tatsächlich angebotenen Werkzeuge. Entdecke deren aktuelle Schemas vor Aufrufen. Lies bestehende Zielinhalte und relevante Kommentare vor Änderungen; prüfe bei Neuanlage auf passende vorhandene Records. Fehlgeschlagene Suchen beweisen keine Abwesenheit.\n\nFühre nur die beauftragte Wirkung aus. Ändere keine weiteren Felder, Status oder Beziehungen ohne entsprechenden Auftrag. Ein Skill gewährt keine zusätzlichen Rechte und führt keine Skripte aus. Wiederhole angenommene oder unklare Schreibvorgänge nicht automatisch.\n\nNenne nach der Aktion die tatsächliche Quelle, das Ziel, die konkrete Änderung und den beobachteten Werkzeugstatus. Prüfe das gespeicherte Ergebnis lesend, soweit die Werkzeuge dies erlauben. Trenne vorgeschlagen, vom Server angenommen und durch Rücklesen bestätigt. Fehlende Nachweise bleiben offen.'
}
