import {useEffect,useRef,useState} from 'react'
import {useWorkspace} from '../../../store/store'
import {isEffectivelyTrashed} from '../../../store/selectors'
import {useCloud} from '../../../cloud'
import {useFileUrl} from '../../../lib/files'
import {hasPdfAttachment,pdfExportSteps} from './polarionPdfState'
import {useLang} from '../../../i18n'
import {sourceScope} from '../../io/import/sourceAtlas'
import {importPolarionPdf} from './polarionPdfImport'
import {useAgent} from './state'
import {stageMedia} from './session'
import type {AgentStep} from './types'
import type {PolarionPdfReceipt} from '@/shared/mcp/polarionPdf'
function PdfCard({receipt,server,pageId,stepId}:{receipt:PolarionPdfReceipt;server:string;pageId:string|null;stepId:string}){
  const de=useLang()==='de',scope=sourceScope(),controller=useRef<AbortController|null>(null)
  const imported=useAgent(s=>s.steps.find(step=>step.id===stepId)?.mcp?.pdfImported)
  const attached=useWorkspace(s=>!!imported&&!!s.pages[imported.pageId]&&!isEffectivelyTrashed(s.pages,imported.pageId)&&hasPdfAttachment(s.pages[imported.pageId].content,imported.src))
  const fileUrl=useFileUrl(imported?.src)
  const readOnly=useCloud(s=>s.readOnly)
  const targetAvailable=useWorkspace(s=>!!imported&&!!s.pages[imported.pageId]&&!isEffectivelyTrashed(s.pages,imported.pageId))
  const insertion=useAgent(s=>{const src=s.steps.find(step=>step.id===stepId)?.mcp?.pdfImported?.src;return src?s.changes.findLast(c=>c.kind==='media'&&c.media?.some(m=>m.src===src))?.status:undefined})
  const [state,setState]=useState<'ready'|'loading'|'saved'|'error'>(imported?'saved':'ready'),[loaded,setLoaded]=useState(0),[error,setError]=useState('')
  useEffect(()=>{setState(s=>s==='loading'?'ready':s);setLoaded(0);return()=>controller.current?.abort()},[scope,receipt.job])
  const save=async()=>{
    if(controller.current)return
    const abort=new AbortController();controller.current=abort;setState('loading');setLoaded(0);setError('')
    try{
      const saved=await importPolarionPdf(receipt,server,pageId,abort.signal,setLoaded)
      abort.signal.throwIfAborted();stageMedia([saved],pageId);
      useAgent.setState(s=>({steps:s.steps.map(step=>step.id===stepId&&step.mcp?{...step,mcp:{...step.mcp,pdfImported:{src:saved.src,pageId:pageId!}}}:step)}));setState('saved')
    }catch(e){if(!abort.signal.aborted){setError(e instanceof Error?e.message:String(e));setState('error')}}
    finally{if(controller.current===abort)controller.current=null}
  }
  return <aside className="term-sign-in term-pdf-export" aria-label={de?'Polarion-PDF':'Polarion PDF'}>
    <strong>{attached?(de?'PDF an der ONE-Seite angehängt':'PDF attached to the ONE page'):(de?'Original-PDF aus Polarion bereit':'Original Polarion PDF ready')}</strong>
    <p>{receipt.pdf.name} · {Math.ceil(receipt.pdf.bytes/1024)} KB · {new Date(receipt.pdf.exportedAt).toLocaleString(de?'de-DE':'en-GB')}</p>
    <a href={receipt.pdf.sourceUrl} target="_blank" rel="noopener noreferrer">{de?'Polarion-Quelle öffnen':'Open Polarion source'} ↗</a>
    <button className="btn btn--primary" disabled={state==='loading'||state==='saved'||!pageId} onClick={()=>void save()}>{state==='loading'?(loaded===receipt.pdf.bytes?(de?'PDF wird in ONE geprüft und gespeichert':'Verifying and saving PDF in ONE'):`${de?'PDF wird übertragen':'Transferring PDF'} · ${Math.round(loaded/receipt.pdf.bytes*100)} %`):state==='saved'?(attached?(de?'In ONE abgelegt':'Saved and inserted in ONE'):insertion==='discarded'?(de?'Datei gespeichert · Einfügung verworfen':'File saved · Insertion discarded'):(de?'In ONE gespeichert · Einfügen prüfen':'Saved in ONE · Review insertion')):(de?'PDF in ONE ablegen':'Save PDF in ONE')}</button>
    {imported&&!attached&&fileUrl&&targetAvailable&&!readOnly&&insertion!=='pending'&&insertion!=='applying'&&<button className="btn" onClick={()=>stageMedia([{src:imported.src,kind:'file',name:receipt.pdf.name,size:receipt.pdf.bytes,mime:'application/pdf',caption:`Polarion · ${receipt.pdf.sourceUrl} · ${receipt.pdf.exportedAt} · SHA-256 ${receipt.pdf.sha256}`,alt:'',itemId:receipt.job}],imported.pageId)}>{de?'Anhang erneut zum Einfügen vorbereiten':'Prepare attachment for insertion again'}</button>}
    {fileUrl&&<a href={fileUrl} download={receipt.pdf.name}>{de?'Gespeicherte PDF herunterladen':'Download saved PDF'} ↓</a>}
    {error&&<div role="alert"><p>{de?'Die PDF konnte nicht übernommen werden. Es wurde kein Anhang eingefügt.':'The PDF could not be imported. No attachment was inserted.'}</p><details><summary>{de?'Fehlerdetails':'Error details'}</summary><p>{error}</p></details></div>}
    <small>{attached?(de?'Der Anhang ist auf der Zielseite vorhanden. Die gespeicherte Datei bleibt nach Ablauf des Export-Downloads verfügbar.':'The attachment is present on the target page. The saved file remains available after the export download expires.'):imported?(de?'Die Datei ist in ONE gespeichert, aber auf der Zielseite noch nicht angehängt. Prüfe die vorgeschlagene Einfügung.':'The file is saved in ONE but is not attached to the target page. Review the proposed insertion.'):!pageId?(de?'Starte den Export von einer ONE-Seite aus, um die PDF dort abzulegen.':'Start the export from a ONE page to save the PDF there.'):(de?'Die Originaldatei wird geprüft und als Anhang zum Einfügen vorbereitet. Der Download steht 30 Minuten ab Auftragserstellung bereit. Nach Atlas wird nur auf Wunsch übertragen.':'The original file is verified and prepared for insertion as an attachment. Download is available for 30 minutes from job creation. Transfer to Atlas is a separate action.')}</small>
  </aside>
}
export function PolarionPdfExport({steps,pageId}:{steps:AgentStep[];pageId:string|null}){
  const de=useLang()==='de',exports=pdfExportSteps(steps)
  const pages=useWorkspace(s=>s.pages)
  const attached=exports.filter(step=>{const file=step.mcp?.pdfImported;return file&&pages[file.pageId]&&!isEffectivelyTrashed(pages,file.pageId)&&hasPdfAttachment(pages[file.pageId].content,file.src)}).length
  if(!exports.length)return null
  return <>
    <p className="term-note" role="status">{deText(exports.length,attached,de)}</p>
    {exports.map(step=><PdfCard key={step.mcp!.receipt!.server+':'+step.mcp!.receipt!.polarionPdf!.job} receipt={step.mcp!.receipt!.polarionPdf!} server={step.mcp!.receipt!.server!} pageId={pageId} stepId={step.id}/>)}
  </>
}
function deText(exported:number,attached:number,de:boolean){
  return de?`PDF-Teilstand: ${exported} bestätigte Exporte · ${attached} an der Zielseite angehängt · ${exported-attached} noch nicht angehängt. Diese Zahlen umfassen nur bestätigte Exporte dieses Auftrags, nicht alle angefragten Dokumente.`:`PDF progress: ${exported} confirmed exports · ${attached} attached to the target page · ${exported-attached} not attached. These counts cover only confirmed exports in this task, not all requested documents.`
}
