import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lang } from '@/shared/i18n'
import type { Route } from '@/shared/ai/types'
import { Modal } from '../../ui/Modal'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { pageTexts } from '../../store/localization'
import { useCloud } from '../../cloud'
import { toast } from '../../store/ui'
import { setContentLanguage } from '../../lib/contentLanguage'
import { RouteChip } from '../ai/routing/RouteChip'
import { HelpLink } from '../../help'
import { generateTranslations, savedDrafts, saveTranslations, translationPages, type TranslationDraft, type TranslationScope } from './run'
import './translation.css'
export default function TranslationPanel({ pageId, onClose }: { pageId?: string; onClose: () => void }) {
 const t=useT(), state=useWorkspace(), cloudReadOnly=useCloud(s=>s.readOnly)
 const root=pageId?state.pages[pageId]:undefined
 const initial=root?.localization?.source??(/\b(und|die|der|das|für|ist)\b|[äöüß]/i.test((root?.title??'')+' '+(root?.plain??'').slice(0,500))?'de':state.settings.language)
 const [source,setSource]=useState<Lang>(initial),[target,setTarget]=useState<Lang>(initial==='de'?'en':'de'),[scope,setScope]=useState<TranslationScope>(pageId?'page':'workspace')
 const [route,setRoute]=useState<Route|null>(null),[drafts,setDrafts]=useState<TranslationDraft[]>([]),[selected,setSelected]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(0)
 const controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>controller.current?.abort(),[])
 const pages=useMemo(()=>translationPages(pageId,scope),[pageId,scope,state.pages]),ids=pages.map(p=>p.id)
 const chars=pages.reduce((n,p)=>n+pageTexts(p,state.databases[p.kind==='database'?p.id:p.databaseId??'']).join('').length,0)
 const clear=()=>{setDrafts([]);setError('');setSelected(0)}
 const run=async(existing:boolean)=>{
  if(busy||cloudReadOnly)return
  const ac=new AbortController();controller.current=ac;setBusy(true);setError('');setDone(0);setDrafts([])
  try{const result=existing?await savedDrafts(ids,source,target,ac.signal):await generateTranslations(ids,source,target,route,ac.signal,(d)=>setDone(d));if(ac.signal.aborted)throw new DOMException('Aborted','AbortError');setDrafts(result);setSelected(0);if(!result.length)setError(t('features.translation.noSaved'))}
  catch(e){setError(ac.signal.aborted?t('features.translation.cancelled'):e instanceof Error?e.message:t('features.translation.failed'))}
  finally{setBusy(false);controller.current=null}
 }
 const save=async()=>{const ac=new AbortController();controller.current=ac;try{setBusy(true);await saveTranslations(drafts,ac.signal);setContentLanguage(target);toast(t('features.translation.saved',{n:drafts.length}));onClose()}catch(e){setError(e instanceof Error?e.message:t('features.translation.failed'))}finally{setBusy(false);controller.current=null}}
 const draft=drafts[selected]
 return <Modal open onClose={()=>{controller.current?.abort();onClose()}} title={t('features.translation.title')} width={940} className="translation-panel" footer={<>{busy?<button className="btn" onClick={()=>controller.current?.abort()}>{t('features.translation.stop')}</button>:<button className="btn" onClick={onClose}>{t('common.cancel')}</button>}<button className="btn btn--primary" data-testid="translation-save" disabled={busy||!drafts.length||cloudReadOnly} onClick={()=>void save()}>{t('features.translation.save')}</button></>}>
  <div data-testid="translation-panel">
   <p>{t('features.translation.lead')}</p><p className="muted">{t('features.translation.art')}</p>
   <div className="translation-fields">
    <label>{t('features.translation.source')}<select aria-label={t('features.translation.source')} disabled={busy} value={source} onChange={e=>{setSource(e.target.value as Lang);clear()}}>{(['de','en'] as const).map(l=><option key={l} value={l}>{t('features.translation.'+l)}</option>)}</select></label>
    <label>{t('features.translation.target')}<select aria-label={t('features.translation.target')} disabled={busy} value={target} onChange={e=>{setTarget(e.target.value as Lang);clear()}}>{(['en','de'] as const).map(l=><option key={l} value={l}>{t('features.translation.'+l)}</option>)}</select></label>
    <label>{t('features.translation.scope')}<select aria-label={t('features.translation.scope')} disabled={busy} value={scope} onChange={e=>{setScope(e.target.value as TranslationScope);clear()}}>{(pageId?['page','subtree','workspace']:['workspace']).map(s=><option key={s} value={s}>{t('features.translation.'+s)}</option>)}</select></label>
   </div>
   <p className="label">{t('features.translation.count',{n:pages.length,chars})}</p><p className="muted">{t('features.translation.locked')}</p>
   <div className="translation-actions"><RouteChip purpose="workspace.translate" sources={ids.map(page=>({page}))} chip={route} onChip={setRoute} reads={t('features.translation.scope')} disabled={busy}/><button className="btn" data-testid="translation-generate" disabled={busy||!ids.length||source===target||cloudReadOnly} onClick={()=>void run(false)}>{t('features.translation.generate')}</button><button className="btn" data-testid="translation-load" disabled={busy||cloudReadOnly} onClick={()=>void run(true)}>{t('features.translation.load')}</button></div>
   {busy&&<p role="status">{t('features.translation.progress',{done,total:ids.length})}</p>}
   {error&&<p role="alert" className="translation-error">{error}</p>}
   {!drafts.length&&!busy&&<p>{t('features.translation.noPreview')}</p>}
   {!!drafts.length&&<><p>{t('features.translation.review')}</p><label>{t('features.translation.page')}<select aria-label={t('features.translation.page')} value={selected} onChange={e=>setSelected(Number(e.target.value))}>{drafts.map((d,i)=><option key={d.id} value={i}>{state.pages[d.id]?.title}</option>)}</select></label>
    <div className="translation-review">{draft?.variant.texts.map(([original,text],i)=><label key={i} className="translation-pair"><span lang={source}>{original}</span><textarea lang={target} rows={Math.min(6,Math.max(2,Math.ceil(text.length/90)))} aria-label={`${t('features.translation.translated')} ${i+1}`} value={text} onChange={e=>setDrafts(ds=>ds.map((d,index)=>index!==selected?d:{...d,variant:{...d.variant,texts:d.variant.texts.map((p,j)=>j===i?[p[0],e.target.value]:p)}}))}/></label>)}</div></>}
   <HelpLink id="workspace-translations" topic={t('features.translation.help')}/>
  </div>
 </Modal>
}
