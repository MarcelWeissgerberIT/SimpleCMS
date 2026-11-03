import type {Page,PropertyDef} from '../../store/types'
import type {ValueSuggestion} from '../../ui/ValueSuggestions'
/** Values belong to this database column, never a global text/history index. No extra data is persisted. */
export function textValueSuggestions(pages:Record<string,Page>,databaseId:string,prop:PropertyDef,rowId?:string):ValueSuggestion[]{
 if(prop.type!=='text'||prop.key||prop.custom)return []
 const scope=(id:string)=>{
  const seen=new Set<string>();let page:Page|undefined=pages[id],privatePage=false
  if(!page)return null
  while(page){if(seen.has(page.id)||page.trashed||page.hidden||page.template||page.parentId&&!pages[page.parentId])return null;seen.add(page.id);privatePage ||=!!page.private;page=page.parentId?pages[page.parentId]:undefined}
  return {privatePage}
 }
 const target=scope(rowId??databaseId);if(!target)return []
 const counts=new Map<string,{count:number;at:number}>()
 for(const row of Object.values(pages)){
  if(row.databaseId!==databaseId)continue
  const own=scope(row.id);if(!own||own.privatePage&&!target.privatePage)continue
  const value=row.properties[prop.id]
  if(typeof value!=='string'||!value.trim()||value.length>160||/[\r\n]/u.test(value)||/^(?:vault:|sk-ant-|onew_)/u.test(value))continue
  const before=counts.get(value);counts.set(value,{count:(before?.count??0)+1,at:Math.max(before?.at??0,row.updatedAt??row.createdAt)})
 }
 return [...counts].sort((a,b)=>b[1].count-a[1].count||b[1].at-a[1].at||a[0].localeCompare(b[0])).map(([value])=>({value}))
}
