import {useEffect,useRef,useState,useSyncExternalStore} from 'react'
import {codeReference,type CodeReference} from '@/shared/mcp/codeReference'
import {useWorkspace} from '../../store/store'
import {useCloud} from '../../cloud'
import {Modal} from '../../ui/Modal'
import {CodeView,lowlightTokenizer} from '../../ui/code'
import {createLowlight,common} from 'lowlight'
import {codeAccessScope,codeConnections,loadCodeEvidence} from './load'
import './code-evidence.css'
const lowlight=createLowlight(common)
const language=(path:string)=>({cs:'csharp',ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',py:'python',rs:'rust',h:'cpp',hpp:'cpp',cpp:'cpp',csproj:'xml',html:'xml',yml:'yaml',md:'markdown'}[path.split('.').at(-1)!]??path.split('.').at(-1)!)
const subscribe=(fn:()=>void)=>{const a=useWorkspace.subscribe(fn),b=useCloud.subscribe(fn);return()=>{a();b()}}
export function CodeEvidence({raw,editable,canRead,onSave}:{raw:string;editable:boolean;canRead:boolean;onSave:(raw:string)=>boolean|void}){
 const de=useWorkspace(s=>s.settings.language==='de'),scope=useSyncExternalStore(subscribe,codeAccessScope)
 const ref=codeReference(raw),[editing,setEditing]=useState(false),[open,setOpen]=useState(false)
 const [draft,setDraft]=useState(''),[finding,setFinding]=useState(''),[repoName,setRepoName]=useState(''),[error,setError]=useState('')
 const [server,setServer]=useState(''),[busy,setBusy]=useState(''),[result,setResult]=useState<Awaited<ReturnType<typeof loadCodeEvidence>>|null>(null)
 const abort=useRef<AbortController|null>(null),box=useRef<HTMLDivElement>(null),connections=codeConnections()
 const live=result?.scope===scope?result:null
 useEffect(()=>{abort.current?.abort();setResult(null);setBusy('');setOpen(false);setEditing(false)},[raw,scope,canRead])
 useEffect(()=>()=>abort.current?.abort(),[])
 const jump=()=>box.current?.querySelector('[data-cur]')?.scrollIntoView({block:'center',inline:'nearest'})
 useEffect(()=>{if(live)jump()},[live])
 const edit=()=>{setDraft(ref?JSON.stringify(ref,null,2):raw==='{}'?'':raw);setFinding(ref?.finding??'');setRepoName(ref?.repoName??'');setEditing(true);setError('')}
 const save=()=>{const next=codeReference(draft);if(!next){setError(de?'Bitte den vollständigen Atlas-Beleg mit repo, snapshot, commit, path, lines und digest einfügen.':'Paste the full Atlas citation: repo, snapshot, commit, path, lines and digest.');return}if(onSave(JSON.stringify({...next,repoName,finding},null,2))===false){setError(de?'Die Seite oder dein Zugriff wurden geändert. Deine Eingabe wurde nicht gespeichert.':'The page or your access changed. Your input was not saved.');return}setEditing(false);setError('')}
 const errorText=(e:unknown)=>{
  const key=e instanceof Error?e.message:''
  if(key==='sourceMismatch')return de?'Der geladene Code passt nicht vollständig zum gespeicherten Beleg. Die Fundstelle wird nicht als geprüft angezeigt.':'The loaded code does not fully match the saved citation. The finding cannot be shown as verified.'
  if(key==='verification')return de?'Atlas konnte diesen Beleg nicht bestätigen. Zugriff, Snapshot oder Prüfwert prüfen.':'Atlas could not verify this citation. Check access, snapshot and digest.'
  if(key==='accessChanged')return de?'Workspace oder Verbindung geändert. Bitte erneut öffnen.':'Workspace or connection changed. Please reopen.'
  return de?'Code konnte nicht geladen werden. Persönliche Atlas-Verbindung, Zugriffsrechte und Code-Freigabe prüfen.':'Could not load code. Check your personal Atlas connection, access and code permission.'
 }
 const load=async(r:CodeReference,selected:string,context=false)=>{
  if(!canRead||!selected)return
  abort.current?.abort();const controller=new AbortController();abort.current=controller;setError('');setResult(null)
  try{const loaded=await loadCodeEvidence(r,selected,context,controller.signal,step=>setBusy(step==='read'?(de?'Lese Datei …':'Reading file …'):(de?'Prüfe Quellbeleg …':'Verifying citation …')));if(!controller.signal.aborted)setResult(loaded)}catch(e){if(!controller.signal.aborted)setError(errorText(e))}finally{if(abort.current===controller)setBusy('')}
 }
 const show=()=>{if(!ref||!canRead)return;const chosen=connections.some(s=>s.name===ref.server)?ref.server!:!ref.server&&connections.length===1?connections[0].name:'';setServer(chosen);setOpen(true);setError('');setResult(null);if(chosen)void load(ref,chosen)}
 const close=()=>{abort.current?.abort();setOpen(false);setResult(null);setBusy('');setError('')}
 const title=ref?.citation.path.split('/').at(-1)??(de?'Quellcode-Beleg':'Source code reference')
 const highlight=ref?.highlight??ref?.citation.lines
 return <section className="code-evidence" aria-label={de?'Quellcode-Beleg':'Source code reference'}>
  <div className="code-evidence__head"><strong>{title}</strong><span className="label">ATLAS · {de?'NUR LESEN':'READ ONLY'}</span></div>
  {ref?<><div className="code-evidence__path">{ref.repoName&&<b>{ref.repoName} · </b>}{ref.citation.path}</div><div className="faint">{de?'Fundstelle':'Finding'}: {de?'Zeilen':'Lines'} {highlight![0]}–{highlight![1]} · Commit {ref.citation.commit.slice(0,12)}</div>{ref.finding&&<p>{ref.finding}</p>}
   <div className="code-evidence__actions"><button type="button" className="btn btn--sm" onClick={show} disabled={!canRead}>{de?'Code öffnen':'Open code'}</button>{editable&&<button type="button" className="btn btn--sm" onClick={edit}>{de?'Referenz bearbeiten':'Edit reference'}</button>}{ref.atlasUrl&&<a href={ref.atlasUrl} target="_blank" rel="noopener noreferrer">{de?'Quelle in Atlas':'Source in Atlas'}</a>}</div>
   <details><summary>{de?'Versionsnachweis':'Version evidence'}</summary><dl><dt>Snapshot</dt><dd>{ref.citation.snapshot}</dd><dt>Commit</dt><dd>{ref.citation.commit}</dd><dt>Digest</dt><dd>{ref.citation.digest}</dd></dl></details>
   <small className="faint">{de?'Code wird erst beim Öffnen über deine persönliche Verbindung geladen. Gespeichert ist nur die Referenz.':'Code loads through your personal connection when opened. Only the reference is saved.'}</small>
  </>:<><p>{de?'Eine Datei und ihre belegte Fundstelle aus Atlas verknüpfen.':'Link an Atlas source file and its cited finding.'}</p>{editable&&<button type="button" className="btn btn--sm" onClick={edit}>{de?'Atlas-Beleg hinzufügen':'Add Atlas citation'}</button>}</>}
  {!ref&&raw!=='{}'&&<p role="alert">{de?'Ungültige Quellenreferenz. Originaldaten bleiben erhalten.':'Invalid source reference. Original data is preserved.'}</p>}
  <Modal open={editing} onClose={()=>setEditing(false)} title={de?'Quellcode-Beleg hinterlegen':'Save source code reference'} width={680}>
   <div className="code-evidence__form"><label>{de?'Repository-Name':'Repository name'}<input className="input" value={repoName} onChange={e=>setRepoName(e.target.value)}/></label><label>{de?'Finding / Notiz':'Finding / note'}<textarea className="input" value={finding} onChange={e=>setFinding(e.target.value)} maxLength={4000}/></label><label>{de?'Atlas-Beleg (citation JSON)':'Atlas citation (JSON)'}<textarea className="input code-evidence__json" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={16000} spellCheck={false}/></label><p className="faint">{de?'Den citation-Beleg aus atlas_code_read einfügen. Die Code-Analyse kann diesen Block auch direkt für dich erstellen.':'Paste the citation returned by atlas_code_read. Code analysis can also create this block for you.'}</p>{error&&<p role="alert">{error}</p>}<button type="button" className="btn btn--primary" disabled={!editable} onClick={save}>{de?'Referenz speichern':'Save reference'}</button></div>
  </Modal>
  <Modal open={open&&canRead} onClose={close} title={title} label={de?'QUELLCODE · NUR LESEN':'SOURCE CODE · READ ONLY'} width="min(1200px, 96vw)">
   {ref&&<div className="code-evidence__viewer"><p className="code-evidence__path">{ref.repoName&&ref.repoName+' · '}{ref.citation.path} · {ref.citation.commit.slice(0,12)}</p>{ref.finding&&<p>{ref.finding}</p>}
    <div className="code-evidence__actions"><label>{de?'Atlas-Verbindung':'Atlas connection'} <select className="input" value={server} disabled={!!busy} onChange={e=>{setServer(e.target.value);setResult(null);setError('')}}><option value="">{de?'Verbindung auswählen':'Select connection'}</option>{connections.map(s=><option key={s.name} value={s.name}>{s.label}</option>)}</select></label><button type="button" className="btn btn--sm" disabled={!server||!!busy} onClick={()=>void load(ref,server)}>{de?'Fundstelle laden':'Load finding'}</button><button type="button" className="btn btn--sm" disabled={!server||!!busy} onClick={()=>void load(ref,server,true)}>{de?'Mit Kontext laden':'Load with context'}</button>{live&&<button type="button" className="btn btn--sm" onClick={jump}>{de?'Zur Fundstelle':'Jump to finding'}</button>}{busy&&<button type="button" className="btn btn--sm" onClick={()=>{abort.current?.abort();setBusy('')}}>{de?'Abbrechen':'Cancel'}</button>}</div>
    <p role="status">{busy|| (live?(de?'Quellbeleg geprüft':'Source citation verified')+' · '+new Date(live.checkedAt).toLocaleString():'')}{live&&' · '+(de?'Markiert':'Highlighted')+': '+highlight![0]+'–'+highlight![1]}</p>{error&&<p role="alert">{error}</p>}
    {live&&<div ref={box} className="code-evidence__code" tabIndex={0} aria-label={de?'Quellcode mit markierter Fundstelle':'Source code with highlighted finding'}><CodeView code={live.lines.join('\n')} tokenize={lowlight.registered(language(ref.citation.path))?lowlightTokenizer(lowlight,language(ref.citation.path)):undefined} firstLine={live.citation.lines[0]} highlightLines={highlight} lineNumbers/></div>}
   </div>}
  </Modal>
 </section>
}
