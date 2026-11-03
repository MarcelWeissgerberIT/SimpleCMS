import {TypedSelection} from './TypedSelection'
import {useEffect,useRef,useState} from 'react'
import {typedAI,typedTemplate,parseTagChain,tagKey,resolveTypedAI,shadowFromBody,typedSource,type TypedAI} from '@/shared/quandprofile/typed-ai'
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {readTypedAtlasSource,findTypedAtlasSources} from '../core/typedSource'
import {SuggestedInput} from '../../../ui/ValueSuggestions'
const operations=['ba','po','pm','research','test','mock','coding'] as const
export function TypedAIEditor({value,onChange,onValid}:{value:TypedAI|undefined;onChange:(value:TypedAI|undefined)=>void;onValid:(valid:boolean)=>void}){
 const t=useT(),[chain,setChain]=useState(''),[definitions,setDefinitions]=useState('[]'),[sources,setSources]=useState('[]'),[error,setError]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false)
 const [server,setServer]=useState('aj-atlas'),[tenant,setTenant]=useState(useWorkspace.getState().ai?.onboarding?.tenant??''),[ref,setRef]=useState(''),[binding,setBinding]=useState(''),[quote,setQuote]=useState(''),[loaded,setLoaded]=useState<Awaited<ReturnType<typeof readTypedAtlasSource>>|null>(null)
 const [query,setQuery]=useState('one.typed-shadow.v1'),[hits,setHits]=useState<Array<{ref:number;title:string}>|null>(null)
 const connections=useWorkspace(s=>s.settings.mcpServers)??[]
 const tagValue=(kind:string)=>chain.split('\n').find(line=>line.startsWith(kind+':'))?.slice(kind.length+1)??''
 const editTag=(kind:string,next:string)=>{setChain(old=>[...old.split('\n').filter(line=>!line.startsWith(kind+':')),...(next?[kind+':'+next]:[])].join('\n'));dirty()}
 const knownTags=(kind:string)=>[...new Set([...(value?.tags.filter(tag=>tag.kind===kind).map(tag=>tag.value)??[]),...(value?.shadows.flatMap(shadow=>kind==='input'?[shadow.input]:kind==='output'?[shadow.output]:shadow.match.filter(tag=>tag.kind===kind).map(tag=>tag.value))??[])])].map(value=>({value}))
 const tenantOptions=[...new Set([useWorkspace.getState().ai?.onboarding?.tenant??'',...(value?.sources.filter(source=>source.server===server).map(source=>source.tenant)??[])])].filter(Boolean).map(value=>({value}))
 const preserveChecked=useRef(false)
 const controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>controller.current?.abort(),[])
 useEffect(()=>{setChain(value?.tags.map(tagKey).join('\n')??'');setDefinitions(JSON.stringify(value?.shadows??[],null,2));setSources(JSON.stringify(value?.sources??[],null,2));if(!preserveChecked.current)setChecked(false);preserveChecked.current=false;setError('');onValid(true)},[value,onValid])
 const dirty=()=>{setChecked(false);setError('');onValid(false)}
 const inspect=()=>{try{const next=typedAI({protocol:'one.typed-ai.v1',tags:parseTagChain(chain),shadows:JSON.parse(definitions),sources:JSON.parse(sources)}),plan=resolveTypedAI(next);if(plan.issues.length)throw Error(t('features.ai.typed.unresolved',{detail:plan.issues.map(i=>i.code+': '+i.detail).join('; ')}));preserveChecked.current=true;onChange(next);setChecked(true);onValid(true);setError('')}catch(e){onValid(false);setError(String(e))}}
 const load=async()=>{setBusy(true);setError('');setLoaded(null);controller.current?.abort();const ctrl=new AbortController();controller.current=ctrl
  try{const source=await readTypedAtlasSource(server.trim(),tenant.trim(),Number(ref),ctrl.signal);if(ctrl.signal.aborted)return;setLoaded(source);setQuote(source.body.slice(0,120));try{const shadow=shadowFromBody(source.body);setBinding(shadow.id+'@'+shadow.version)}catch{setBinding(value?.tags.filter(t=>t.kind==='rule').map(tagKey)[0]??'')}}catch(e){if(!ctrl.signal.aborted)setError(String(e))}finally{if(controller.current===ctrl)setBusy(false)}
 }
 const search=async()=>{setBusy(true);setError('');setHits(null);controller.current?.abort();const ctrl=new AbortController();controller.current=ctrl
  try{const found=await findTypedAtlasSources(server.trim(),tenant.trim(),query.trim(),ctrl.signal);if(!ctrl.signal.aborted)setHits(found)}catch(e){if(!ctrl.signal.aborted)setError(String(e))}finally{if(controller.current===ctrl)setBusy(false)}
 }
 const bind=()=>{try{
  if(!loaded||!value||!loaded.body.includes(quote)||quote.length<12)throw Error(t('features.ai.typed.quoteHelp'))
  let shadow;try{shadow=shadowFromBody(loaded.body)}catch{/* regular versioned rule source */}
  const kind=shadow?'shadow':'rule'
  const source=typedSource({kind,server:loaded.server,origin:loaded.origin,tenant:loaded.tenant,project:loaded.project,ref:loaded.ref,hash:loaded.hash,stateHash:loaded.stateHash,quote,binding:binding.trim()})
  const previous=typedAI({protocol:'one.typed-ai.v1',tags:parseTagChain(chain),shadows:JSON.parse(definitions),sources:JSON.parse(sources)})
  let tags=previous.tags,shadows=previous.shadows
  if(shadow){if(source.binding!==shadow.id+'@'+shadow.version)throw Error('Typed AI: shadow version differs');shadows=[shadow];tags=[...tags.filter(t=>!['input','output',...shadow!.match.map(m=>m.kind)].includes(t.kind)),...shadow.match.filter(t=>!['input','output'].includes(t.kind)),{kind:'input',value:shadow.input},{kind:'output',value:shadow.output}]}else{const tag=parseTagChain(source.binding);if(tag.length!==1||tag[0]!.kind!=='rule')throw Error('Typed AI: use rule:catalogue@version');tags=[...tags.filter(t=>tagKey(t)!==tagKey(tag[0]!)),tag[0]!]}
  const next=typedAI({...previous,tags,shadows,sources:[...previous.sources.filter(s=>s.binding!==source.binding),source]});onChange(next);setLoaded(null);setError('')
 }catch(e){setError(String(e))}}
 return <section className="typed-ai" aria-label={t('features.ai.typed.title')}>
  <header><span className="label">§ TYPED AI</span><h3>{t('features.ai.typed.title')}</h3><p>{t('features.ai.typed.intro')}</p></header>
  <div className="programs__actions">{operations.map(op=><button type="button" className="btn btn--sm" key={op} disabled={busy} onClick={()=>onChange(typedTemplate(op))}>{t('features.ai.typed.template.'+op)}</button>)}{value&&<button type="button" className="btn btn--sm" disabled={busy} onClick={()=>onChange(undefined)}>{t('features.ai.typed.disable')}</button>}</div>
  {value&&<>
   <div className="typed-ai__fields typed-ai__fields--tags">{['domain','operation','input','output'].map(kind=><label key={kind}>{t('features.ai.typed.kind.'+kind)}<SuggestedInput className="input" aria-label={t('features.ai.typed.kind.'+kind)} value={tagValue(kind)} maxLength={160} disabled={busy} options={knownTags(kind)} onValueChange={next=>editTag(kind,next)}/></label>)}</div>
   <details><summary>{t('features.ai.typed.editTags')}</summary><label className="programs__field">{t('features.ai.typed.chain')}<textarea aria-label={t('features.ai.typed.chain')} rows={6} value={chain} onChange={e=>{setChain(e.target.value);dirty()}}/><small>{t('features.ai.typed.chainHelp')}</small></label></details>
   <TypedSelection value={value}/>
   <button type="button" className="btn" onClick={inspect}>{t('features.ai.typed.check')}</button>{checked&&<p role="status">{t('features.ai.typed.checked')}</p>}
   <details><summary>{t('features.ai.typed.import')}</summary><p>{t('features.ai.typed.importHelp')}</p>
    <div className="typed-ai__fields"><label>{t('features.ai.typed.server')}<SuggestedInput className="input" aria-label={t('features.ai.typed.server')} disabled={busy} value={server} options={connections.filter(c=>c.enabled).map(c=>({value:c.name}))} onValueChange={next=>{setServer(next);setLoaded(null);setHits(null)}}/></label><label>Tenant<SuggestedInput className="input" aria-label="Tenant" disabled={busy} value={tenant} options={tenantOptions} onValueChange={next=>{setTenant(next);setLoaded(null);setHits(null)}}/></label><label>Atlas Ref<SuggestedInput className="input" aria-label="Atlas Ref" disabled={busy} inputMode="numeric" value={ref} options={(hits??[]).map(hit=>({value:String(hit.ref),label:hit.title,detail:'Ref '+hit.ref}))} onValueChange={next=>{setRef(next);setLoaded(null)}}/></label></div>
    <label className="programs__field">{t('features.ai.typed.searchQuery')}<SuggestedInput className="input" aria-label={t('features.ai.typed.searchQuery')} value={query} onValueChange={next=>{setQuery(next);setHits(null)}} options={[{value:'one.typed-shadow.v1'},...(value.shadows.map(shadow=>({value:shadow.id})))]} maxLength={200}/></label><button type="button" className="btn" disabled={busy||!server.trim()||!tenant.trim()||!query.trim()} onClick={()=>void search()}>{t('features.ai.typed.search')}</button>
    {hits&&<div className="typed-ai__hits"><p>{t(hits.length?'features.ai.typed.candidates':'features.ai.typed.noCandidates')}</p>{hits.map(hit=><button type="button" className="btn" key={hit.ref} onClick={()=>{setRef(String(hit.ref));setLoaded(null)}}>{hit.title} · Ref {hit.ref}</button>)}</div>}
    <button type="button" className="btn" disabled={busy||!server.trim()||!tenant.trim()||!ref} onClick={()=>void load()}>{t('features.ai.typed.read')}</button>
    {loaded&&<div className="typed-ai__source"><strong>{loaded.title} · {loaded.project} · Ref {loaded.ref}</strong><code>{loaded.hash}</code><label>{t('features.ai.typed.binding')}<input value={binding} onChange={e=>setBinding(e.target.value)} placeholder="rule:flux-design@5"/></label><label>{t('features.ai.typed.quote')}<textarea rows={3} value={quote} onChange={e=>setQuote(e.target.value)}/></label><details><summary>{t('features.ai.typed.body')}</summary><pre>{loaded.body}</pre></details><button type="button" className="btn" onClick={bind}>{t('features.ai.typed.bind')}</button></div>}
   </details>
   <details><summary>{t('features.ai.typed.definitions')}</summary><p>{t('features.ai.typed.definitionsHelp')}</p><label className="programs__field">{t('features.ai.typed.shadows')}<textarea aria-label={t('features.ai.typed.shadows')} rows={12} value={definitions} onChange={e=>{setDefinitions(e.target.value);dirty()}}/></label><label className="programs__field">{t('features.ai.typed.sources')}<textarea aria-label={t('features.ai.typed.sources')} rows={8} value={sources} onChange={e=>{setSources(e.target.value);dirty()}}/></label></details>

   <p className="typed-ai__limit">{t('features.ai.typed.limit')}</p>
  </>}
  {error&&<p role="alert" className="programs__error">{error}</p>}
 </section>
}
