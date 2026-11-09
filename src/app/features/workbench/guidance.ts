import type {Page} from '../../store/types'
import type {Card} from './model'

/** Only flag actual heading blocks; short factual statements are still valid sources. */
export function headingOnly(card:Card,page:Page|undefined):boolean{
 if(card.source.kind!=='page'||!page?.content)return false
 const nodes=page.content.content??[]
 const node=nodes.find((n,i)=>(typeof n.attrs?.id==='string'?n.attrs.id:'block:'+i)===card.source.blockId)
 return node?.type==='heading'
}
