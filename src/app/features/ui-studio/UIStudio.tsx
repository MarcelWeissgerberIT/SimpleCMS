import {useEffect,useMemo,useRef,useState} from 'react'
import {readUIProject,editUIComponent,componentPackage,type UIProject} from '@/shared/uiInstructions/project'
import {parseSpecification,isSafeThumbnail,type Instance} from '@/shared/uiInstructions/spec'
import {useWorkspace} from '../../store/store'
import {Modal} from '../../ui/Modal'
import {analyzeHTML} from './analyze'
import {readUIArchive} from './archive'
import {prepareUIAnalysis} from './terminal'
import './ui-studio.css'
function download(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function UIStudio({raw,editable,pageId,onSave,onSource}:{raw:string;editable:boolean;pageId:string;onSave:(raw:string)=>boolean;onSource:(src:string,file:File)=>boolean}){
 const de=useWorkspace(s=>s.settings.language==='de'),epoch=useWorkspace(s=>s.epoch)
 const loaded=useMemo(()=>{try{return {project:readUIProject(raw),error:''}}catch(e){return {project:null,error:raw==='{}'?'':String((e as Error).message)}}},[raw])
 const project=loaded.project,spec=useMemo(()=>project?parseSpecification(project.markdown):null,[project])
 const [tab,setTab]=useState('components'),[selected,setSelected]=useState(''),[treeId,setTreeId]=useState(''),[query,setQuery]=useState(''),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(''),[paste,setPaste]=useState(false),[html,setHTML]=useState('')
 const partBaseline=useRef(raw)
 const [conflict,setConflict]=useState(false),previousDocument=useRef<string|null>(null)
 const [parts,setParts]=useState<{name:string;project:UIProject}[]>([])
 const importInput=useRef<HTMLInputElement>(null),htmlInput=useRef<HTMLInputElement>(null),aiInput=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null),baseline=useRef(raw)
 baseline.current=raw
 const defs=spec?.manifest?.definitions??[],trees=spec?.manifest?.trees??[],tree=trees.find(t=>t.id===treeId)??trees[0],component=defs.find(d=>d.id===selected)??defs[0]
 const document=component?spec?.documents[component.id]??'':''
 const dirty=draft!==document
 const draftRef=useRef(draft);draftRef.current=draft
 useEffect(()=>{const previous=previousDocument.current;if(previous!==null&&draftRef.current!==previous&&draftRef.current!==document)setConflict(true);else setDraft(document);previousDocument.current=document},[document,component?.id])
 useEffect(()=>()=>controller.current?.abort(),[epoch])
 const save=(value:UIProject)=>{if(!onSave(JSON.stringify(readUIProject(JSON.stringify(value))))){throw new Error(de?'Die Seite wurde geändert. Bitte erneut versuchen.':'The page changed. Please retry.')}setError('')}
 const changeComponent=(id:string)=>{if(dirty){setError(de?'Bitte die bearbeiteten Vorgaben zuerst speichern oder verwerfen.':'Save or discard the edited contract first.');return}setSelected(id);setError('')}
 const analyze=async(value:string,title:string)=>{
  controller.current?.abort();const control=new AbortController();controller.current=control;const start=raw,ws=epoch;setBusy(de?'HTML analysieren …':'Analyzing HTML …');setError('')
  try{const result=await analyzeHTML(value,title,control.signal,p=>setBusy((de?'Messe HTML bei ':'Measuring HTML at ')+p));if(!control.signal.aborted&&ws===useWorkspace.getState().epoch&&baseline.current===start){save(result);setPaste(false)}}catch(e){if(!control.signal.aborted)setError((e as Error).message)}finally{if(controller.current===control)setBusy('')}
 }
 const importFile=async(file?:File)=>{if(!file)return;const start=raw,ws=epoch;try{if(file.size>32_000_000)throw new Error('Projekt überschreitet 32 MB.');if(file.name.toLowerCase().endsWith('.zip')){const next=await readUIArchive(file);if(ws===useWorkspace.getState().epoch&&baseline.current===start){partBaseline.current=start;setParts(next)};return}const value=readUIProject(await file.text());if(ws===useWorkspace.getState().epoch&&baseline.current===start)save(value)}catch(e){setError((e as Error).message)}}
 const flatten=(nodes:Instance[])=>{const byParent=new Map<string|null,Instance[]>();for(const n of nodes){const list=byParent.get(n.parentId)??[];list.push(n);byParent.set(n.parentId,list)}const result:{node:Instance;depth:number}[]=[];const visit=(parent:string|null,depth:number)=>{for(const node of byParent.get(parent)??[]){result.push({node,depth});visit(node.id,depth+1)}};visit(null,0);return result}
 const treeRows=useMemo(()=>flatten(tree?.nodes??[]),[tree])
 const label=(en:string,deutsch:string)=>de?deutsch:en
 const actionsDisabled=!editable||!!busy||dirty
 return <section className="ui-studio" aria-label="UI Studio">
  <header className="ui-studio__head"><strong>{project?.settings.project||'UI Studio'}</strong><span className="label">UI INSTRUCTIONS · ONE</span></header>
  <div className="ui-studio__actions">
   <button className="btn btn--sm" disabled={actionsDisabled} onClick={()=>importInput.current?.click()}>{label('Import project / MD','Projekt / MD importieren')}</button>
   <button className="btn btn--sm" disabled={actionsDisabled} onClick={()=>htmlInput.current?.click()}>{label('Analyze HTML file','HTML-Datei analysieren')}</button>
   <button className="btn btn--sm" disabled={actionsDisabled} onClick={()=>setPaste(true)}>{label('Paste HTML','HTML einfügen')}</button>
   <button className="btn btn--sm" disabled={actionsDisabled} onClick={()=>aiInput.current?.click()}>{label('Analyze image / document with AI','Bild / Dokument mit KI analysieren')}</button>
   {project&&<button className="btn btn--sm" onClick={()=>download('one-ui.ui-project.json',JSON.stringify(project,null,2))}>{label('Export project','Projekt exportieren')}</button>}
   {busy&&<button className="btn btn--sm" onClick={()=>{controller.current?.abort();setBusy('')}}>{label('Cancel','Abbrechen')}</button>}
  </div>
  <input ref={importInput} type="file" hidden accept=".md,.json,.zip" aria-label="Import UI project" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value=''}}/>
  <input ref={htmlInput} type="file" hidden accept=".html,.htm" aria-label="Analyze HTML file" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>2_000_000){setError('HTML überschreitet 2 MB.');return}await analyze(await file.text(),file.name)}}/>
  <input ref={aiInput} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md" aria-label="Analyze UI reference with AI" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setError('');try{await prepareUIAnalysis(file,pageId,onSource)}catch(e){setError((e as Error).message)}}}/>
  <p className="faint">{label('HTML is measured locally at 1440, 768 and 390 px without scripts or external assets. AI analysis saves the reference on this page and prepares a task in the terminal; Start uses its model and data rules.','HTML wird lokal bei 1440, 768 und 390 px ohne Skripte oder externe Assets gemessen. Die KI-Analyse speichert die Referenz auf dieser Seite und bereitet einen Terminal-Auftrag vor; „Starten“ nutzt dessen Modell und Datenregeln.')}</p>
  {(error||loaded.error)&&<p role="alert">{error||loaded.error}</p>}{busy&&<p role="status">{busy}</p>}
  {project&&spec?.valid&&<>
   <div className="ui-studio__tabs" role="tablist" aria-label="UI Studio">{[['components',label('Components','Komponenten')],['gallery',label('Gallery','Galerie')],['markdown','Markdown']].map(([id,name])=><button key={id} role="tab" aria-selected={tab===id} className="btn btn--sm" onClick={()=>setTab(id)}>{name}</button>)}</div>
   <p className="faint">{defs.length} {label('components','Komponenten')} · {trees.length} {label('views','Ansichten')}{dirty?' · '+label('Unsaved contract','Ungespeicherte Vorgaben'):''}</p>
   {tab==='markdown'?<><button className="btn btn--sm" onClick={()=>download('UI-INSTRUCTIONS.md',project.markdown)}>{label('Download Markdown','Markdown herunterladen')}</button><pre className="ui-studio__markdown">{project.markdown.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g,'[embedded reference image]')}</pre></>:
   <div className="ui-studio__workspace">
    <aside><label>{label('View','Ansicht')}<select className="input" value={tree?.id??''} onChange={e=>setTreeId(e.target.value)}>{trees.map(t=><option key={t.id} value={t.id}>{t.name} · {t.width}px</option>)}</select></label><input className="input" aria-label={label('Find component','Komponente suchen')} placeholder={label('Find component','Komponente suchen')} value={query} onChange={e=>setQuery(e.target.value)}/><div className="ui-studio__tree">{treeRows.filter(({node})=>`${defs.find(d=>d.id===node.componentId)?.name} ${node.label??''}`.toLowerCase().includes(query.toLowerCase())).map(({node,depth})=><button key={node.id} className="ui-studio__node" aria-pressed={component?.id===node.componentId} style={{paddingInlineStart:Math.min(depth,8)*12+8}} onClick={()=>changeComponent(node.componentId)}>{defs.find(d=>d.id===node.componentId)?.name}<small>{node.label}</small></button>)}</div></aside>
    <div className="ui-studio__detail">
     {tab==='gallery'&&<div className="ui-studio__gallery">{defs.filter(d=>d.name.toLowerCase().includes(query.toLowerCase())).map(d=><button className="btn" key={d.id} onClick={()=>changeComponent(d.id)}>{isSafeThumbnail(d.thumbnail?.dataUrl)&&<img src={d.thumbnail!.dataUrl} alt="" loading="lazy"/>}<strong>{d.name}</strong><small>{d.kind}</small></button>)}</div>}
     {component&&<><h3>{component.name}</h3><p className="faint">{component.kind} · {component.evidence==='image'?label('Inferred from image','Aus Bild abgeleitet'):label('Imported or measured reference','Importierte oder gemessene Referenz')}</p>{isSafeThumbnail(component.thumbnail?.dataUrl)&&<img className="ui-studio__preview" src={component.thumbnail!.dataUrl} alt={component.name}/>}
      {conflict&&<p role="alert">{label('This contract changed elsewhere. Copy your draft if needed, then discard it to load the current version.','Diese Vorgaben wurden anderswo geändert. Bei Bedarf deinen Entwurf kopieren und anschließend verwerfen, um den aktuellen Stand zu laden.')}</p>}
      <label>{label('Component contract','Komponenten-Vorgaben')}<textarea className="input ui-studio__contract" value={draft} onChange={e=>setDraft(e.target.value)} readOnly={!editable} spellCheck={false}/></label>
      <div className="ui-studio__actions"><button className="btn btn--primary" disabled={!editable||!dirty||conflict} onClick={()=>{try{save(editUIComponent(project,component.id,draft))}catch(e){setError((e as Error).message)}}}>{label('Save contract','Vorgaben speichern')}</button><button className="btn btn--sm" disabled={!dirty} onClick={()=>{setDraft(document);setConflict(false)}}>{label('Discard edits','Änderungen verwerfen')}</button><button className="btn btn--sm" disabled={dirty} onClick={()=>download(component.id+'.md',document)}>{label('Component MD','Komponenten-MD')}</button><button className="btn btn--sm" disabled={dirty} onClick={()=>download('BUILD-TASK-'+component.id+'.md',componentPackage(project,component.id))}>{label('Task with dependencies','Auftrag mit Unterkomponenten')}</button></div>
     </>}
    </div>
   </div>}
  </>}
  <Modal open={!!parts.length} onClose={()=>setParts([])} title={label('Choose project part','Projektteil auswählen')} width={680}><p>{label('Import one part into this block. Use another UI Studio block for additional parts. Embedded thumbnails are included; original HTML assets remain in the archive.','Einen Teil in diesen Block übernehmen. Weitere Teile in zusätzliche UI-Studio-Blöcke importieren. Eingebettete Vorschaubilder werden übernommen; originale HTML-Assets bleiben im Archiv.')}</p><div role="status">{error}</div><div className="ui-studio__tree">{parts.map((part,i)=><button key={i} className="ui-studio__node" disabled={!editable} onClick={()=>{try{if(partBaseline.current!==baseline.current)throw new Error('Der Block wurde inzwischen geändert. Bitte das Archiv erneut öffnen.');save(part.project);setParts([])}catch(e){setError((e as Error).message)}}}>{part.name}</button>)}</div></Modal>
  <Modal open={paste} onClose={()=>{controller.current?.abort();setBusy('');setPaste(false)}} title={label('Analyze HTML','HTML analysieren')} width={760}><div className="ui-studio__form"><textarea className="input ui-studio__contract" aria-label="HTML" value={html} onChange={e=>setHTML(e.target.value)} maxLength={2_000_000}/><p>{label('The existing project in this block is replaced after a successful analysis. Export it first if needed.','Das vorhandene Projekt in diesem Block wird nach erfolgreicher Analyse ersetzt. Bei Bedarf vorher exportieren.')}</p>{error&&<p role="alert">{error}</p>}<button className="btn btn--primary" disabled={!html.trim()||!!busy||!editable} onClick={()=>void analyze(html,'HTML-Referenz')}>{busy||label('Analyze locally','Lokal analysieren')}</button></div></Modal>
 </section>
}
