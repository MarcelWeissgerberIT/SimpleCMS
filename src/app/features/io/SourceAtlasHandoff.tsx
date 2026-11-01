import {SOURCE_ATLAS_TEXT_MAX,clearSourceHandoff} from './import/sourceHandoffs'
import {WorkerConnectionHelp} from '../ai/mcp-servers/WorkerConnectionHelp'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { useLang } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { currentSetup } from '../ai/mcp-servers/config'
import { sourceAtlas, sourceScope } from './import/sourceAtlas'
import type { McpCall } from '../ai/mcp-servers/activity'
import './source.css'

const sourceErrorDe=(message:string):string=>{
  const messages:Record<string,string>={
    'Source unavailable or read-only.':'Die Quelle ist nicht verfügbar oder du hast nur Leserechte.',
    'Account, workspace, policy or source changed. Prepare the handoff again.':'Zugang, Workspace, Datenregeln oder Quelle haben sich geändert. Prüfe die Übergabe erneut.',
    'Select your configured personal Atlas connection.':'Wähle deine eingerichtete persönliche Atlas-Verbindung.',
    'Personal Atlas access is not configured. Open Settings → AI → MCP.':'Dein Atlas-Zugang fehlt. Richte ihn unter Einstellungen → KI → MCP ein.',
    'Atlas did not return a project selection.':'Atlas hat keine Projektauswahl geliefert. Prüfe deinen persönlichen Zugang und die Projektmitgliedschaft.',
    'Select a project from the actual Atlas result.':'Wähle ein eindeutiges Projekt aus der Atlas-Auswahl.',
    'Supply a title and a source excerpt up to 18,000 characters.':'Gib einen Titel und einen Quellenauszug bis 18.000 Zeichen ein.',
    'The exact Atlas payload exceeds 20,000 characters including metadata and escaping. Select a smaller excerpt; the full source remains in ONE.':'Der genaue Atlas-Aufruf überschreitet 20.000 Zeichen einschließlich Metadaten und Maskierung. Kürze den Auszug; die vollständige Quelle bleibt in ONE.',
    'The personal handoff receipt cannot be saved on this device. Allow local browser storage and prepare again; nothing was written to Atlas.':'Der persönliche Übergabenachweis kann auf diesem Gerät nicht gespeichert werden. Erlaube lokale Browser-Speicherung und bereite erneut vor; in Atlas wurde nichts geschrieben.',
    'This exact handoff was already attempted. Inspect its saved receipt and Atlas before another write.':'Diese Übergabe wurde bereits versucht. Prüfe den gespeicherten Nachweis und Atlas vor einem weiteren Schreibzugriff.',
    'Atlas tool schema changed. Prepare again.':'Die Atlas-Werkzeugvorgaben haben sich geändert. Prüfe die Übergabe erneut.',
    'Atlas constraints changed. Prepare and review again.':'Die Atlas-Constraints haben sich geändert. Wähle erneut „Vorgaben und Übergabe prüfen“. Es wurde nichts geschrieben.',
    'Atlas did not return an unambiguous saved record. Inspect Atlas; do not repeat the write blindly.':'Atlas hat keinen eindeutig gespeicherten Datensatz zurückgemeldet. Prüfe Atlas vor einem erneuten Versuch.',
  }
  return messages[message]??(message.startsWith('Atlas tool is not available: ')?'Dieses Atlas-Werkzeug ist nicht freigegeben: '+message.slice(29):message.startsWith('Atlas refused the operation: ')?'Atlas hat den Vorgang abgelehnt: '+message.slice(28):message)
}

type Session = Awaited<ReturnType<typeof sourceAtlas>>
type Preview = Awaited<ReturnType<Session['prepare']>>
type Receipt = Awaited<ReturnType<Session['commit']>>

export function SourceAtlasHandoff({pageId,onClose}:{pageId:string;onClose:()=>void}) {
  const de=useLang()==='de',page=useWorkspace(s=>s.pages[pageId]),readOnly=useCloud(s=>s.readOnly)
  const readbackText=(verification?:string)=>verification==='read_back_matches'
    ?(de?'Titel und Inhalt zurückgelesen und passend verifiziert.':'Title and content read back and verified.')
    :verification==='read_back_differs'
      ?(de?'Atlas hat gespeichert, aber Titel oder Inhalt weichen beim Rücklesen ab. Auch eine serverseitige Übersetzung oder Normalisierung kann das verursachen. Vergleiche die Atlas-Fassung mit der Originalquelle in ONE; lege sie nicht erneut an.':'Atlas saved the record, but its title or content differs on read-back. Server-side translation or normalization can also cause this. Compare Atlas with the original source in ONE; do not create it again.')
      :(de?'Atlas hat gespeichert; die unabhängige Rückleseprüfung ist noch nicht verfügbar. Prüfe den Datensatz über seinen Link, bevor du einen weiteren Schreibversuch erwägst.':'Atlas saved the record; independent read-back is not yet available. Inspect the linked record before considering another write attempt.')
  const servers=currentSetup().servers
  const [server,setServer]=useState(''),[session,setSession]=useState<Session>(),[project,setProject]=useState('')
  const [title,setTitle]=useState(page?.title??''),[excerpt,setExcerpt]=useState(page?.plain??'')
  const [preview,setPreview]=useState<Preview>(),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[receipt,setReceipt]=useState<Receipt>(),[uncertain,setUncertain]=useState(false),[events,setEvents]=useState<McpCall[]>([])
  const controller=useRef<AbortController|null>(null),scope=useRef(sourceScope())
  useEffect(()=>()=>controller.current?.abort(),[])
  const valid=()=>{if(scope.current!==sourceScope())throw Error(de?'Zugang oder Workspace geändert. Öffne die Übergabe neu.':'Account or workspace changed. Reopen the handoff.')}
  const resetReview=()=>{setPreview(undefined);setReviewed(false);setError('')}
  const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{valid();await fn()}catch(e){const message=(e as Error).message;setError(de?sourceErrorDe(message):message)}finally{setBusy(false)}}
  const connect=()=>void run(async()=>{
    controller.current?.abort();controller.current=new AbortController();setSession(undefined);setProject('');resetReview()
    const loaded=await sourceAtlas(server,pageId,controller.current.signal,e=>setEvents(rows=>[...rows.filter(r=>r.id!==e.id),e].slice(-30)))
    valid();setSession(loaded)
  })
  const prepare=()=>void run(async()=>{if(!session)return;resetReview();const result=await session.prepare(project,title,excerpt);valid();setPreview(result)})
  const commit=()=>void run(async()=>{
    if(!session||!preview||preview.previous||!reviewed||readOnly||uncertain||receipt)return
    valid()
    try {const result=await session.commit(preview.hash);setReceipt(result);setReviewed(false)}
    catch(e){setUncertain(session.attempted());throw e}
  })
  const download=()=>{
    if(!receipt)return
    const blob=new Blob([JSON.stringify({protocol:'one.source-handoff.v1',at:new Date().toISOString(),onePage:pageId,server,project:receipt.project,payloadHash:receipt.hash,receipt:receipt.receipt},null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='atlas-source-handoff.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <Modal open onClose={onClose} label="§ QUELLE → ATLAS" title={de?'Quelle nach Atlas übergeben':'Hand a source to Atlas'} width={800}>
    <div className="io-source" data-testid="source-atlas-handoff">
      <div className="io-source__head"><h2>{de?'Eine externe Referenz, nachvollziehbar übergeben':'Hand over a traceable external reference'}</h2><p>{de?'Du legst ein neues Dossier (doc) an. Es entstehen keine bestätigten Requirements oder Entscheidungen, vorhandene Datensätze bleiben erhalten. Der genaue Text wird vor dem Schreiben angezeigt. Keine KI-Anfrage.':'Create a new dossier (doc). No confirmed requirements or decisions are created and existing records are preserved. Review the exact text before writing. No AI request.'}</p></div>
      {!receipt&&<>
        <label className="io-source__field"><span className="label">{de?'Deine persönliche Atlas-Verbindung':'Your personal Atlas connection'}</span><select className="input" value={server} disabled={busy||uncertain} onChange={e=>{controller.current?.abort();setServer(e.target.value);setSession(undefined);setProject('');resetReview();setEvents([])}}><option value="">{de?'Verbindung auswählen':'Choose connection'}</option>{servers.map(s=><option key={s.id} value={s.name}>{s.name} · {new URL(s.url).host}</option>)}</select></label>
        {!servers.length&&<p role="note">{de?'Richte zuerst deinen persönlichen Atlas-Zugang unter Einstellungen → KI → MCP ein. Hier wird kein fremder Zugang übernommen.':'Configure your personal Atlas access under Settings → AI → MCP first. Another person’s access is never used here.'}</p>}
        <button className="btn" type="button" disabled={!server||busy||readOnly||uncertain} onClick={connect}>{busy?(de?'Wird geprüft…':'Checking…'):(de?'Zugang und Projekte prüfen':'Check access and projects')}</button>
        {session&&<>
          <p role="status">{de?'Atlas-Zugang geprüft':'Atlas access checked'} · {typeof session.identity.person==='string'?session.identity.person:session.identity.person?.name??session.identity.name??server}</p>
          {!session.projects.length&&<p role="note">{de?'Atlas hat keine erreichbaren Projekte geliefert. Prüfe deine Projektmitgliedschaft und Token-Rechte in Atlas.':'Atlas returned no accessible projects. Check your project membership and token permissions in Atlas.'}</p>}
          <label className="io-source__field"><span className="label">{de?'Zielprojekt (aus Atlas gelesen)':'Target project (read from Atlas)'}</span><select className="input" value={project} disabled={busy||uncertain} onChange={e=>{setProject(e.target.value);resetReview()}}><option value="">{de?'Projekt bewusst auswählen':'Choose project explicitly'}</option>{session.projects.map(p=><option key={p.tenant+'/'+p.slug} value={p.slug}>{p.tenant} / {p.title} ({p.slug})</option>)}</select></label>
          <label className="io-source__field"><span className="label">{de?'Dossier-Titel':'Dossier title'}</span><input className="input" value={title} maxLength={200} disabled={busy||uncertain} onChange={e=>{setTitle(e.target.value);resetReview()}} /></label>
          <label className="io-source__field"><span className="label">{de?'Quellenauszug für Atlas':'Source excerpt for Atlas'} · {excerpt.length.toLocaleString()} / 18.000</span><textarea className="input io-source__text" value={excerpt} disabled={busy||uncertain} maxLength={SOURCE_ATLAS_TEXT_MAX} onChange={e=>{setExcerpt(e.target.value);resetReview()}} /></label>
          <button type="button" className="btn" disabled={!project||!title.trim()||!excerpt.trim()||excerpt.length>SOURCE_ATLAS_TEXT_MAX||busy||uncertain} onClick={prepare}>{de?'Vorgaben und Übergabe prüfen':'Check constraints and handoff'}</button>
        </>}
        {preview&&<div className="io-source__preview">
          <p><strong>{preview.project.tenant} / {preview.project.title}</strong> · doc · {preview.hash.slice(0,12)}</p>
          <details><summary>{de?'Aktuelle Atlas-Vorgaben':'Current Atlas constraints'}</summary><pre className="io-source__json">{JSON.stringify(preview.constraints,null,2)}</pre></details>
          <details open><summary>{de?'Genau diese Daten werden geschrieben':'Exact outgoing data'}</summary><pre className="io-source__json">{JSON.stringify(preview.args,null,2)}</pre></details>
          {preview.previous&&<div role="status" className="io-source__head" data-testid="source-handoff-previous"><strong>{preview.previous.state==='accepted'?(de?'Diese Quelle wurde bereits übergeben':'This source was already handed over'):(de?'Ein früherer Schreibversuch ist noch ungeklärt':'An earlier write attempt is unresolved')}</strong><p>{new Date(preview.previous.startedAt).toLocaleString()} · {preview.previous.ref?<a href={session!.origin+'/r/'+preview.previous.ref} target="_blank" rel="noreferrer">Ref {preview.previous.ref}</a>:(de?'Zuerst Atlas prüfen. Es wird nichts automatisch wiederholt.':'Inspect Atlas first. Nothing is retried automatically.')}</p>{preview.previous.state==='accepted'&&<p data-testid="source-handoff-verification">{readbackText(preview.previous.verification)}</p>}{preview.previous.state!=='accepted'&&<button type="button" className="btn" disabled={busy} onClick={()=>void run(async()=>{if(!preview.previous)return;await clearSourceHandoff(preview.key,preview.previous.id);resetReview()})}>{de?'In Atlas geprüft: kein Datensatz vorhanden. Neu vorbereiten.':'Checked Atlas: no record exists. Prepare again.'}</button>}</div>}
          <label className="io-source__review"><input type="checkbox" checked={reviewed} disabled={busy||uncertain||!!preview.previous} onChange={e=>setReviewed(e.target.checked)} />{de?'Zielprojekt, Vorgaben und Quellenauszug geprüft. Als externe Referenz anlegen.':'Target, constraints and source excerpt reviewed. Create an external reference.'}</label>
          <button type="button" className="btn btn--ink" disabled={!reviewed||busy||readOnly||uncertain||!!preview.previous} onClick={commit}>{de?'Jetzt in Atlas anlegen':'Create in Atlas now'}</button>
        </div>}
      </>}
      {error&&<><p role="alert" className="io-source__error">{error}</p><WorkerConnectionHelp error={error} server={server}/></>}
      {uncertain&&error&&<p role="alert">{de?'Der Schreibversuch wird nicht automatisch wiederholt. Prüfe zuerst in Atlas, ob das Dossier bereits angelegt wurde; bei einer verlorenen Antwort könnte es trotzdem gespeichert sein.':'The write attempt will not be retried automatically. Inspect Atlas first: a lost response may still mean the dossier was saved.'}</p>}
      {receipt&&<div role="status">{!receipt.receiptSaved&&<p role="alert">{de?'Der Nachweis konnte auf diesem Gerät nicht gesichert werden. Lade ihn jetzt herunter und prüfe Atlas vor einem erneuten Versuch.':'The receipt could not be saved on this device. Download it now and inspect Atlas before retrying.'}</p>}<h3>{de?'Atlas hat die Referenz angenommen':'Atlas accepted the reference'}</h3><p><a href={session!.origin+'/r/'+receipt.receipt.refs[0]} target="_blank" rel="noreferrer">Ref {receipt.receipt.refs[0]}</a> · {receipt.project.tenant} / {receipt.project.slug}</p><p>{readbackText(receipt.receipt.verification)}</p><button type="button" className="btn" onClick={download}>{de?'Übergabenachweis herunterladen':'Download handoff receipt'}</button></div>}
      {!!events.length&&<details><summary>{de?'Tatsächliche Werkzeugaufrufe':'Actual tool calls'}</summary><ol>{events.map(e=><li key={e.id}>{e.server} · {e.tool} · {e.state}{e.error?' · '+e.error:''}</li>)}</ol></details>}
      <div className="io-actions"><button type="button" className="btn" onClick={onClose}>{de?'Schließen':'Close'}</button></div>
    </div>
  </Modal>
}
