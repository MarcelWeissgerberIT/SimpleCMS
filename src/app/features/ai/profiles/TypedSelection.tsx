import {resolveTypedAI,tagKey,type TypedAI} from '@/shared/quandprofile/typed-ai'
import {useT} from '../../../i18n'
/** Read-only binding summary; it never issues evidence or changes a selected profile. */
export function TypedSelection({value}:{value:TypedAI}){
 const t=useT(),plan=resolveTypedAI(value)
 return <div className="typed-ai__selection">
  <div className="typed-ai__chain" aria-label={t('features.ai.typed.preview')}>{value.tags.map(tag=><span key={tagKey(tag)}><small>{t('features.ai.typed.kind.'+tag.kind)}</small><strong>{tag.value}{tag.version?' · V'+tag.version:''}</strong></span>)}</div>
  {plan.shadow&&<p className="label">{t('features.ai.typed.selected')} · {plan.shadow.id} · V{plan.shadow.version} · {plan.hash.slice(0,12)}</p>}
  {value.sources.length>0&&<details><summary>{t('features.ai.typed.sources')}</summary><ul>{value.sources.map(source=><li key={source.binding+source.ref}><a href={source.origin+'/r/'+source.ref} target="_blank" rel="noopener noreferrer">{source.binding} · Ref {source.ref}</a><span> · {source.tenant} / {source.project}</span><br/><code title={'body: '+source.hash+' / state: '+source.stateHash}>SHA-256 {source.hash.slice(0,12)} · {source.stateHash.slice(0,12)}</code></li>)}</ul></details>}
 </div>
}
