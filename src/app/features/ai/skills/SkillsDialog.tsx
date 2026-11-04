import {AtlasSkills} from './AtlasSkills'
import {ATLAS_ALIGNMENT_SKILL} from '@/shared/ai/atlas-skills'
import {useEffect,useRef,useState} from 'react'
import {blankSkill,bindSkill,parseSkillFile,skillMarkdown,SkillError,type Skill,type SkillSpec} from '@/shared/ai/skills'
import {Modal} from '../../../ui/Modal'
import {useT} from '../../../i18n'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud/state'
import {listSkills,saveSkill,importSkillVersion,skillScope} from './storage'
import {closeSkills} from './dialog'
import '../programs/programs.css'
import './skills.css'

export default function SkillsDialog({onUse,initialQuery=''}:{onUse:(skill:Skill)=>void;initialQuery?:string}){
 const t=useT(),epoch=useWorkspace(s=>s.epoch),actor=useCloud(s=>s.user?.id),workspace=useCloud(s=>s.active.kind==='cloud'?s.active.id:'local')
 const [scope]=useState(skillScope),[rows,setRows]=useState<Skill[]>([]),[selected,setSelected]=useState<Skill|null>(null),[imported,setImported]=useState<Skill|null>(null),[spec,setSpec]=useState<SkillSpec>(blankSkill),[query,setQuery]=useState(initialQuery),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[view,setView]=useState<'local'|'atlas'>('local')
 const file=useRef<HTMLInputElement>(null)
 const fail=(e:unknown)=>setError(t('features.ai.skills.error.'+(e instanceof SkillError?e.code:'storage')))
 useEffect(()=>{if(skillScope()!==scope)closeSkills()},[epoch,actor,workspace,scope])
 useEffect(()=>{try{const saved=listSkills(scope);setRows(saved);const first=saved.find(s=>(s.spec.name+' '+s.spec.description+' '+s.spec.tags.join(' ')).toLowerCase().includes(initialQuery.toLowerCase()));if(first){setSelected(first);setSpec(first.spec)}}catch(e){fail(e)}},[scope]) // eslint-disable-line react-hooks/exhaustive-deps
 const pick=(skill:Skill|null)=>{setImported(null);setSelected(skill);setSpec(skill?.spec??blankSkill());setError('');setNotice('')}
 const latest=rows.filter((s,i)=>rows.findIndex(p=>p.id===s.id)===i).filter(s=>(s.spec.name+' '+s.spec.description+' '+s.spec.tags.join(' ')).toLowerCase().includes(query.toLowerCase()))
 const save=async()=>{setBusy(true);setError('');try{const clean={...spec,tags:spec.tags.filter(t=>t.trim())};const next=imported&&bindSkill(imported.id,imported.version,clean,imported.source).hash===imported.hash?await importSkillVersion(imported,scope):await saveSkill(clean,selected,scope);setRows(listSkills(scope));pick(next);setNotice(t('features.ai.skills.saved'))}catch(e){fail(e)}finally{setBusy(false)}}
 const importFile=async(input:HTMLInputElement)=>{const f=input.files?.[0];if(!f)return;try{if(f.size>20000)throw new SkillError('limit');const parsed=parseSkillFile(await f.text()),next=parsed.spec;setImported(parsed.snapshot??null);if(skillScope()!==scope)throw new SkillError('scope');setSelected(rows.find(s=>s.spec.name===next.name)??null);setSpec(next);setError('');setNotice(t('features.ai.skills.imported'))}catch(e){fail(e)}finally{input.value=''}}
 const exportFile=()=>{if(!selected)return;const url=URL.createObjectURL(new Blob([skillMarkdown(selected.spec,selected)],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=selected.spec.name+'-v'+selected.version+'-SKILL.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const dirty=!selected||JSON.stringify(spec)!==JSON.stringify(selected.spec)
 const actions=<div className="programs__actions"><button className="btn btn--primary" disabled={busy||!dirty||!spec.name.trim()||!spec.description.trim()||!spec.instructions.trim()} onClick={()=>void save()}>{t('features.ai.skills.save')}</button><button className="btn" disabled={!selected||dirty} onClick={()=>{if(selected&&skillScope()===scope){onUse(selected);closeSkills()}}}>{t('features.ai.skills.use')}</button><button className="btn" disabled={!selected||dirty} onClick={exportFile}>{t('features.ai.skills.export')}</button></div>
 return <Modal open onClose={closeSkills} title={t('features.ai.skills.title')} label="§ AI · SKILLS" width={980} className="skills-modal" footer={view==='local'?actions:<button className="btn" onClick={()=>setView('local')}>{t('features.ai.skills.atlas.back')}</button>}><div className="programs skills" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();closeSkills()}}}>
  <div className="programs__actions"><button className="btn" aria-pressed={view==='local'} onClick={()=>setView('local')}>{t('features.ai.skills.atlas.local')}</button><button className="btn" aria-pressed={view==='atlas'} onClick={()=>setView('atlas')}>{t('features.ai.skills.atlas.title')}</button></div>
  {view==='atlas'?<AtlasSkills scope={scope} seed={selected?.source} onImported={skill=>{if(scope===skillScope()){setRows(listSkills(scope));pick(skill);setView('local');setNotice(t('features.ai.skills.saved'))}}}/>:<>
  <p className="programs__intro">{t('features.ai.skills.intro')}</p><p>{t('features.ai.skills.scope')}</p><p><a href="https://aj-atlas.com/sdd-skills.html" target="_blank" rel="noreferrer">{t('features.ai.skills.atlas.sdd')}</a> · {t('features.ai.skills.atlas.sddHelp')}</p>
  {error&&<p role="alert" className="programs__error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="programs__layout"><aside>
   <div className="programs__actions"><button className="btn" onClick={()=>pick(null)}>{t('features.ai.skills.new')}</button><button className="btn" onClick={()=>{pick(null);setSpec(ATLAS_ALIGNMENT_SKILL)}}>{t('features.ai.skills.atlas.template')}</button><button className="btn" onClick={()=>file.current?.click()}>{t('features.ai.skills.import')}</button></div>
   <input hidden ref={file} type="file" accept=".md,text/markdown,text/plain" aria-label={t('features.ai.skills.import')} onChange={e=>void importFile(e.currentTarget)}/>
   <input type="search" className="skills__search" aria-label={t('features.ai.skills.search')} placeholder={t('features.ai.skills.search')} value={query} onChange={e=>setQuery(e.target.value)}/>
   {!rows.length&&<p>{t('features.ai.skills.empty')}</p>}{!!rows.length&&!latest.length&&<p role="status">{t('features.ai.skills.noMatch')}</p>}
   {latest.map(s=><button className="skills__row" key={s.id} aria-pressed={selected?.id===s.id} onClick={()=>pick(s)}><strong>{s.spec.name}</strong><span>{s.spec.description}</span><small>V{s.version} · {s.spec.tags.join(' · ')}</small></button>)}
  </aside><main>
   {selected?.source&&<p className="skills__source">{t('features.ai.skills.atlas.source')} · {selected.source.origin} · {selected.source.tenant}/{selected.source.project} · Ref {selected.source.ref}<br/>{dirty?t('features.ai.skills.atlas.edited'):selected.source.hash}<br/><button className="btn btn--sm" disabled={dirty} onClick={()=>setView('atlas')}>{t('features.ai.skills.atlas.check')}</button></p>}
   {selected&&<label className="programs__field">{t('features.ai.skills.version')}<select aria-label={t('features.ai.skills.version')} value={selected.version} onChange={e=>pick(rows.find(s=>s.id===selected.id&&s.version===Number(e.target.value))??null)}>{rows.filter(s=>s.id===selected.id).map(s=><option key={s.version} value={s.version}>V{s.version} · {s.hash.slice(0,12)}</option>)}</select></label>}
   <label className="programs__field">{t('features.ai.skills.name')}<input aria-label={t('features.ai.skills.name')} value={spec.name} maxLength={64} disabled={busy||!!selected} onChange={e=>setSpec({...spec,name:e.target.value})}/><small>{t('features.ai.skills.nameHelp')}</small></label>
   <label className="programs__field">{t('features.ai.skills.description')}<textarea disabled={busy} rows={2} maxLength={2000} value={spec.description} onChange={e=>setSpec({...spec,description:e.target.value})}/></label>
   <label className="programs__field">{t('features.ai.skills.tags')}<input disabled={busy} value={spec.tags.join(', ')} onChange={e=>setSpec({...spec,tags:e.target.value.split(',').map(s=>s.trim())})}/></label>
   <label className="programs__field">{t('features.ai.skills.instructions')}<textarea disabled={busy} aria-label={t('features.ai.skills.instructions')} className="skills__instructions" rows={6} maxLength={12000} value={spec.instructions} onChange={e=>setSpec({...spec,instructions:e.target.value})}/><small>{spec.instructions.length.toLocaleString()} / 12.000</small></label>
  </main></div><p>{t('features.ai.skills.boundaries')}</p>
 </>}</div></Modal>
}
