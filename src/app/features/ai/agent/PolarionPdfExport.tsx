import {useEffect,useRef,useState} from 'react'
import {useLang} from '../../../i18n'
import {sourceScope} from '../../io/import/sourceAtlas'
import {importPolarionPdf} from './polarionPdfImport'
import {useAgent} from './state'
import {stageMedia} from './session'
import type {AgentStep} from './types'
import type {PolarionPdfReceipt} from '@/shared/mcp/polarionPdf'
function PdfCard({receipt,server,pageId,stepId,imported}:{receipt:PolarionPdfReceipt;server:string;pageId:string|null;stepId:string;imported:boolean}){
  const de=useLang()==='de',scope=sourceScope(),controller=useRef<AbortController|null>(null)
  const insertion=useAgent(s=>{const src=s.steps.find(step=>step.id===stepId)?.mcp?.pdfImported?.src;return src?s.changes.find(c=>c.kind==='media'&&c.media?.some(m=>m.src===src))?.status:undefined})
  const [state,setState]=useState<'ready'|'loading'|'saved'|'error'>(imported?'saved':'ready'),[loaded,setLoaded]=useState(0),[error,setError]=useState('')
  useEffect(()=>()=>controller.current?.abort(),[scope,receipt.job])
  const save=async()=>{
    if(controller.current)return
    const abort=new AbortController();controller.current=abort;setState('loading');setError('')
    try{
      const saved=await importPolarionPdf(receipt,server,pageId,abort.signal,setLoaded)
      abort.signal.throwIfAborted();stageMedia([saved],pageId);
      useAgent.setState(s=>({steps:s.steps.map(step=>step.id===stepId&&step.mcp?{...step,mcp:{...step.mcp,pdfImported:{src:saved.src,pageId:pageId!}}}:step)}));setState('saved')
    }catch(e){if(!abort.signal.aborted){setError(e instanceof Error?e.message:String(e));setState('error')}}
    finally{controller.current=null}
  }
  return <aside className="term-sign-in term-pdf-export" aria-label={de?'Polarion-PDF':'Polarion PDF'}>
    <strong>{de?'Original-PDF aus Polarion bereit':'Original Polarion PDF ready'}</strong>
    <p>{receipt.pdf.name} · {Math.ceil(receipt.pdf.bytes/1024)} KB · {new Date(receipt.pdf.exportedAt).toLocaleString(de?'de-DE':'en-GB')}</p>
    <a href={receipt.pdf.sourceUrl} target="_blank" rel="noopener noreferrer">{de?'Polarion-Quelle öffnen':'Open Polarion source'} ↗</a>
    <button className="btn btn--primary" disabled={state==='loading'||state==='saved'||!pageId} onClick={()=>void save()}>{state==='loading'?(loaded===receipt.pdf.bytes?(de?'PDF wird in ONE geprüft und gespeichert':'Verifying and saving PDF in ONE'):`${de?'PDF wird übertragen':'Transferring PDF'} · ${Math.round(loaded/receipt.pdf.bytes*100)} %`):state==='saved'?(insertion==='applied'?(de?'In ONE abgelegt':'Saved and inserted in ONE'):insertion==='discarded'?(de?'Datei gespeichert · Einfügung verworfen':'File saved · Insertion discarded'):(de?'In ONE gespeichert · Einfügen prüfen':'Saved in ONE · Review insertion')):(de?'PDF in ONE ablegen':'Save PDF in ONE')}</button>
    {error&&<div role="alert"><p>{de?'Die PDF konnte nicht übernommen werden. Es wurde kein Anhang eingefügt.':'The PDF could not be imported. No attachment was inserted.'}</p><details><summary>{de?'Fehlerdetails':'Error details'}</summary><p>{error}</p></details></div>}
    <small>{!pageId?(de?'Starte den Export von einer ONE-Seite aus, um die PDF dort abzulegen.':'Start the export from a ONE page to save the PDF there.'):(de?'Die Originaldatei wird geprüft und als Anhang zum Einfügen vorbereitet. Der Download steht 30 Minuten ab Auftragserstellung bereit. Nach Atlas wird nur auf Wunsch übertragen.':'The original file is verified and prepared for insertion as an attachment. Download is available for 30 minutes from job creation. Transfer to Atlas is a separate action.')}</small>
  </aside>
}
export function PolarionPdfExport({steps,pageId}:{steps:AgentStep[];pageId:string|null}){
  const seen=new Set<string>()
  return <>{steps.flatMap(step=>{
    const r=step.mcp?.receipt?.polarionPdf,server=step.mcp?.receipt?.server
    if(step.state!=='ok'||!r||!server||seen.has(server+':'+r.job))return []
    seen.add(server+':'+r.job)
    return [<PdfCard key={server+':'+r.job} receipt={r} server={server} pageId={pageId} stepId={step.id} imported={!!step.mcp?.pdfImported}/>]
  })}</>
}
