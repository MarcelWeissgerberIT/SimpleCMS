import type {JSONContent} from '@tiptap/core'
import type {Finding} from '@/shared/codeAnalysis/model'
import {useState} from 'react'
import {useT} from '../../i18n'
import {useWorkspace} from '../../store/store'
import {withWriter} from '../../store/writer'
import {useCloud,createPrivatePage,isPrivatePage} from '../../cloud'
import {isEffectivelyTrashed,inTemplate} from '../../store/selectors'
import {newItemId} from '../../lib/itemIds'
import {openPage} from '../../lib/router'
import {blockLocationHref} from '../../lib/blockLocation'
import {canCreateItems} from '../workitems'
const indexCache=new WeakMap<object,Map<string,string[]>>()
function reviewTasks(pages:ReturnType<typeof useWorkspace.getState>['pages']){
 const cached=indexCache.get(pages);if(cached)return cached
 const index=new Map<string,string[]>();let visited=0
 for(const p of Object.values(pages)){
  if(isEffectivelyTrashed(pages,p.id)||inTemplate(pages,p.id)||!p.content?.content?.some(n=>n.type==='workItem'))continue
  const stack=[p.content]
  while(stack.length&&visited++<50000){const n=stack.pop()!;for(const mark of n.marks??[]){const href=mark.attrs?.href;if(mark.type==='link'&&typeof href==='string'&&href.startsWith('#/p/')&&href.includes('work-view=findings')){const ids=index.get(href)??[];if(!ids.includes(p.id))ids.push(p.id);index.set(href,ids)}}for(const c of n.content??[])stack.push(c)}
  if(visited>=50000)break
 }
 indexCache.set(pages,index);return index
}
/** Native review task: normal people, due dates, comments and editing; exact revision backlink. */
export function FindingTask({pageId,blockId,revision,finding,disabled}:{pageId:string;blockId?:string;revision:string;finding:Finding;disabled:boolean}){
 const t=useT(),pages=useWorkspace(s=>s.pages),readOnly=useCloud(s=>s.readOnly),[error,setError]=useState('')
 const href=blockLocationHref(pageId,blockId,{view:'findings',revision,item:finding.id})
 const existing=(reviewTasks(pages).get(href)??[]).map(id=>pages[id]).find(p=>!!p.private===!!pages[pageId]?.private)
 const create=()=>{try{
  const s=useWorkspace.getState(),p=s.pages[pageId]
  if(disabled||useCloud.getState().readOnly||!blockId||!p||p.settings.locked||isEffectivelyTrashed(s.pages,pageId)||!canCreateItems())return
  const found=(reviewTasks(s.pages).get(href)??[]).map(id=>s.pages[id]).find(p=>!!p.private===!!s.pages[pageId]?.private);if(found){openPage(found.id);return}
  const para=(text:string):JSONContent=>({type:'paragraph',attrs:{id:crypto.randomUUID()},content:text?[{type:'text',text}]:[]})
  const heading=(text:string):JSONContent=>({type:'heading',attrs:{id:crypto.randomUUID(),level:2},content:[{type:'text',text}]})
  const content:JSONContent={type:'doc',content:[{type:'workItem',attrs:{id:crypto.randomUUID(),itemId:newItemId(),status:'todo',people:[]},content:[para(finding.title)]},para(t('workflow.reviewInstructions')),{...para(t('workflow.reviewSource')),content:[{type:'text',text:t('workflow.reviewSource'),marks:[{type:'link',attrs:{href}}]}]},heading(t('workflow.reviewClaim')),para(finding.claim),heading(t('workflow.reviewQuestions')),para(finding.countercheck),heading(t('workflow.reviewDecision')),para('')]}
  const id=withWriter({kind:'you',via:'button'},()=>isPrivatePage(pageId)?createPrivatePage({parentId:pageId,title:t('workflow.reviewTitle')+': '+finding.title,content}):s.createPage({parentId:pageId,title:t('workflow.reviewTitle')+': '+finding.title,content}))
  openPage(id)
 }catch{setError(t('workflow.reviewFailed'))}}
 return <section><button className="btn btn--sm" disabled={existing?false:disabled||readOnly||!blockId} onClick={()=>existing?openPage(existing.id):create()}>{t(existing?'workflow.openReviewTask':'workflow.createReviewTask')}</button><p className="faint">{t('workflow.reviewTaskHint')}</p>{error&&<p role="alert">{error}</p>}</section>
}
