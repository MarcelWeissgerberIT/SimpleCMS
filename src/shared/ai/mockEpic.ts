/** A package index is navigation, never evidence for an unread component. */
export interface MockEpicMember {ref:number;name:string;category:string}
export interface MockEpic {ref:number;url:string;title:string;project:string;tag:string;members:MockEpicMember[]}
export function mockEpic(record:Record<string,any>,url:string):MockEpic|null {
 if(record.kind!=='epic'||typeof record.project!=='string'||typeof record.body!=='string')return null
 const tag=(Array.isArray(record.tags)?record.tags:[]).find((t:unknown)=>typeof t==='string'&&/^ui-package:[a-z0-9][a-z0-9-]{0,49}$/.test(t))
 const marker=/<!-- ui-collection-members: ([\s\S]*?) -->/.exec(record.body)
 if(!tag||!marker)return null
 let rows:unknown;try{rows=JSON.parse(marker[1]!)}catch{return null}
 if(!Array.isArray(rows)||rows.length>10000)return null
 const members:MockEpicMember[]=[],seen=new Set<number>()
 for(const r of rows){if(!r||!Number.isSafeInteger(r.ref)||r.ref<=0||r.ref===record.ref||typeof r.name!=='string'||r.name.length>200||typeof r.category!=='string'||/Nicht mehr im aktuellen Import/i.test(r.status??'')||seen.has(r.ref))continue
  seen.add(r.ref);members.push({ref:r.ref,name:r.name,category:r.category.slice(0,80)})
 }
 return members.length?{ref:record.ref,url,title:record.title,project:record.project,tag,members}:null
}
export const epicFoundation=(m:MockEpicMember)=>/foundation|designgrundlagen|grundlage/i.test(m.category)
export function epicSelection(epic:MockEpic,refs:number[]):MockEpicMember[]{
 if(refs.length>8||refs.some(ref=>!epic.members.some(m=>m.ref===ref)))throw Error('Die Komponentenauswahl enthält unbekannte Epic-Teile.')
 const selected=[...epic.members.filter(epicFoundation),...refs.map(ref=>epic.members.find(m=>m.ref===ref)!)]
 const unique=[...new Map(selected.map(m=>[m.ref,m])).values()]
 if(unique.length>20)throw Error('Bitte den Mock auf einen Anwendungsfall eingrenzen: zu viele gemeinsame Designgrundlagen.')
 return unique
}
export function isEpicMember(epic:MockEpic,record:Record<string,any>):boolean {
 return epic.members.some(m=>m.ref===record.ref)&&record.project===epic.project&&record.parent?.ref===epic.ref&&Array.isArray(record.tags)&&record.tags.includes(epic.tag)&&record.archived!==true
}
