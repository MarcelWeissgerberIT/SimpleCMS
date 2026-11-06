/** Display projection only: query/filter/order and every formula still use canonical data. */
import type { Lang } from '@/shared/i18n'
import type { DbModel } from './hooks'
import type { Database, Page, PropertyDef } from '../store/types'
import { localizeDatabase, localizePage, localizedTitle } from '../store/localization'
import { searchRows } from './model/query'
import { Resolver, type Resolved } from './model/resolve'
class DisplayResolver extends Resolver {
 constructor(base: Resolver, private language: Lang) { super(base.ctx) }
 override value(db: Database, prop: PropertyDef, row: Page, depth=0): Resolved {
  const originalDb=this.ctx.databases[db.id]??db, originalProp=originalDb.properties.find(p=>p.id===prop.id)??prop, originalRow=this.ctx.pages[row.id]??row
  const value=super.value(originalDb,originalProp,originalRow,depth)
  // Nested evaluation is authoritative: translated labels/text must never affect formula results.
  if(depth===0&&prop.type==='title')return localizedTitle(originalRow,this.language)
  if(depth===0&&prop.type==='text')return localizePage(originalRow,this.language,originalDb).properties[prop.id]??null
  return value
 }
}
export function displayDbModel(m: DbModel, lang: Lang|null): DbModel {
 if(!lang)return m
 const db=localizeDatabase(m.db,m.dbPage,lang), page=(p:Page)=>({...p,title:localizedTitle(p,lang)})
 const props=new Map(m.propMap);for(const p of db.properties)props.set(p.id,p)
 const translated=!!m.dbPage.localization&&m.dbPage.localization.source!==lang||m.allRows.some(p=>p.localization&&p.localization.source!==lang)
 return {...m,db,dbPage:page(m.dbPage),view:db.views.find(v=>v.id===m.view.id)??m.view,resolver:new DisplayResolver(m.resolver,lang),propMap:props,allProps:m.allProps.map(p=>props.get(p.id)??p),visibleProps:m.visibleProps.map(p=>props.get(p.id)??p),titleProp:props.get(m.titleProp.id)??m.titleProp,rows:m.rows.map(page),allRows:m.allRows.map(page),groupProp:m.groupProp?props.get(m.groupProp.id)??m.groupProp:null,groups:m.groups?.map(g=>{const opt=m.groupProp?props.get(m.groupProp.id)?.options?.find(o=>o.id===g.option?.id):undefined;return {...g,label:opt?.name??g.label,...(opt?{option:opt}:{}),rows:g.rows.map(page)}})??null,readOnly:m.readOnly||translated,fixed:m.fixed||translated}
}

export function translatedSearch(base: Resolver, db: Database, dbPage: Page, rows: Page[], query: string, lang: Lang | null): Page[] {
 if(!lang)return searchRows(base,db,rows,query)
 const seen=new Set(searchRows(base,db,rows,query).map(p=>p.id))
 for(const row of searchRows(new DisplayResolver(base,lang),localizeDatabase(db,dbPage,lang),rows,query))seen.add(row.id)
 return rows.filter(p=>seen.has(p.id))
}
