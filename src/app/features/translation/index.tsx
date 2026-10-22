import { lazy, Suspense, useState } from 'react'
import { Languages } from 'lucide-react'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useContentLanguage, setContentLanguage, type ContentLanguageChoice } from '../../lib/contentLanguage'
import { translationState } from '../../store/localization'
import './translation.css'
const Panel=lazy(()=>import('./TranslationPanel'))
export function TranslationControls({pageId}:{pageId?:string}){
 const t=useT(),{choice,lang}=useContentLanguage(),page=useWorkspace(s=>pageId?s.pages[pageId]:undefined)
 const db=useWorkspace(s=>page?s.databases[page.kind==='database'?page.id:page.databaseId??'']:undefined),readOnly=useCloud(s=>s.readOnly)
 const [open,setOpen]=useState(false),status=page?translationState(page,lang,db):'original'
 return <div className="translation-controls" data-testid="translation-controls">
  <div className="translation-actions"><Languages size={15}/><label>{t('features.translation.language')}<select data-testid="content-language" aria-label={t('features.translation.language')} value={choice} onChange={e=>setContentLanguage(e.target.value as ContentLanguageChoice)}>{(['auto','original','en','de'] as const).map(l=><option key={l} value={l}>{t('features.translation.'+l)}</option>)}</select></label>
   {!readOnly&&!page?.settings.locked&&<button className="btn btn--sm" data-testid="translation-manage" onClick={()=>setOpen(true)}>{t('features.translation.manage')}</button>}
   {page?.localization&&lang&&lang!==page.localization.source&&<button className="btn btn--sm" onClick={()=>setContentLanguage('original')}>{t('features.translation.editOriginal')}</button>}
  </div>
  {status!=='original'&&<p role="status" data-translation-status={status}>{page?.kind!=='database'&&!page?.content?t('common.loading'):t('features.translation.'+status)}</p>}
  {open&&<Suspense fallback={<p>{t('common.loading')}</p>}><Panel pageId={pageId} onClose={()=>setOpen(false)}/></Suspense>}
 </div>
}
export function WorkspaceTranslations(){const t=useT();return <section><h3>{t('features.translation.title')}</h3><p>{t('features.translation.lead')}</p><TranslationControls/></section>}
