import {useMemo,useState} from 'react'
import type {SavedProgram} from '@/shared/quandprofile/program'
import {draftWorkflow} from '@/shared/quandprofile/program'
import type {JSONContent} from '@tiptap/core'
import {useRoute} from '../../../lib/router'
import {useWorkspace} from '../../../store/store'
import {useT} from '../../../i18n'
import {SuggestedInput} from '../../../ui/ValueSuggestions'
import {sourcePageAvailable} from './inputModel'
import {saveProgram,programScope} from './storage'
import {activeReviewProfile} from '../profiles/storage'
function headings(node:JSONContent|null|undefined):string[]{
 if(!node)return[]
 const text=(n:JSONContent):string=>(n.text??'')+(n.content??[]).map(text).join('')
 const visit=(n:JSONContent,depth:number):string[]=>depth>10?[]:[...(n.type==='heading'?[text(n).trim()]:[]),...(n.content??[]).flatMap(c=>visit(c,depth+1))]
 return [...new Set(visit(node,0).filter(Boolean))].slice(0,100)
}
/** Creates a private recipe only. No analysis, model prompt, Atlas write or approval happens here. */
export function NewAnalysisRecipe({onSaved,onCancel}:{onSaved:(saved:SavedProgram)=>void;onCancel:()=>void}){
 const t=useT(),route=useRoute(),pages=useWorkspace(s=>s.pages),[pinned]=useState(programScope)
 const [role,setRole]=useState<'ba'|'po'>('ba'),[source,setSource]=useState(route.name==='page'&&sourcePageAvailable(pages,route.id)?route.id:''),[focus,setFocus]=useState(''),[name,setName]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const options=useMemo(()=>headings(pages[source]?.content).map(value=>({value})),[pages,source])
 const proposed=t('features.ai.program.recipe.'+role)+' · '+(pages[source]?.title??'')
 const save=async()=>{setBusy(true);setError('');try{
  if(programScope().key!==pinned.key)throw Error(t('features.ai.task.stale'))
  if(!sourcePageAvailable(useWorkspace.getState().pages,source))throw Error(t('features.ai.program.sourceMissing'))
  const profile=await activeReviewProfile()
  if(programScope().key!==pinned.key)throw Error(t('features.ai.task.stale'))
  const goal='/'+role+(focus.trim()?' '+focus.trim():'')
  const saved=await saveProgram((name.trim()||proposed).slice(0,120),{...draftWorkflow(goal,role,source,[]),...(profile?{profile}:{})},undefined,pinned)
  onSaved(saved)
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <section className="program-recipe" aria-label={t('features.ai.program.recipe.title')}>
  <h3 tabIndex={-1}>{t('features.ai.program.recipe.title')}</h3><p>{t('features.ai.program.recipe.intro')}</p>
  <div className="program-recipe__roles" role="group" aria-label={t('features.ai.program.recipe.role')}>{(['ba','po'] as const).map(r=><button className="btn" type="button" key={r} aria-pressed={role===r} onClick={()=>setRole(r)}>{t('features.ai.program.recipe.'+r)}</button>)}</div>
  <label className="programs__field">{t('features.ai.program.sourcePage')}<select aria-label={t('features.ai.program.sourcePage')} value={source} onChange={e=>{setSource(e.target.value);setFocus('')}}><option value="">{t('features.ai.program.input.choose')}</option>{Object.values(pages).filter(p=>sourcePageAvailable(pages,p.id)&&p.kind!=='database').map(p=><option key={p.id} value={p.id}>{p.title||t('common.untitled')}</option>)}</select></label>
  <label className="programs__field">{t('features.ai.program.recipe.focus')}<SuggestedInput value={focus} onValueChange={setFocus} options={options} maxLength={300} aria-label={t('features.ai.program.recipe.focus')} hint={t('features.ai.program.recipe.focusHelp')}/></label>
  <p className="program-recipe__hint">{t('features.ai.program.recipe.focusHelp')}</p>
  <label className="programs__field">{t('features.ai.program.name')}<input value={name} onChange={e=>setName(e.target.value)} placeholder={proposed} maxLength={120}/></label>
  <p>{t('features.ai.program.recipe.boundaries')}</p>
  {error&&<p role="alert" className="programs__error">{error}</p>}
  <div className="programs__actions"><button type="button" className="btn btn--primary" disabled={busy||!source} onClick={()=>void save()}>{t('features.ai.program.recipe.save')}</button><button type="button" className="btn" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button></div>
 </section>
}
