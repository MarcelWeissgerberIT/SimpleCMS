import {useEffect,useState} from 'react'
import type {Editor} from '@tiptap/core'
import {create} from 'zustand'
import {useWorkspace} from '../../../store/store'
import {useUI} from '../../../store/ui'
import {Modal} from '../../../ui/Modal'
import {captureRef} from './refs'
import {addRef,openAgent,REF_MAX,useAgent} from './state'
import type {TermRef} from './types'
import '../../code-evidence/code-evidence.css'
import {codeEvidenceRequest} from '@/shared/ai/codeEvidenceRequest'
const useRequest=create<{ref:TermRef|null;epoch:string|undefined}>(()=>({ref:null,epoch:undefined}))
export function requestCodeEvidence(editor:Editor){
 const ref=captureRef(editor),ws=useWorkspace.getState(),de=ws.settings.language==='de'
 if(!ref||ref.image||ref.file||ref.clipped){useUI.getState().toast({message:de?'Bitte eine Textstelle mit höchstens 8.000 Zeichen markieren.':'Select a text passage of at most 8,000 characters.',kind:'error'});return}
 useRequest.setState({ref,epoch:ws.epoch})
}
export function CodeEvidenceRequestHost(){
 const {ref,epoch}=useRequest(),activeEpoch=useWorkspace(s=>s.epoch),de=useWorkspace(s=>s.settings.language==='de')
 const running=useAgent(s=>s.status==='running'),draft=useAgent(s=>s.draft),[repo,setRepo]=useState(''),[version,setVersion]=useState(''),[error,setError]=useState('')
 const close=()=>useRequest.setState({ref:null})
 useEffect(()=>{setRepo('');setVersion('');setError('')},[ref])
 useEffect(()=>{if(epoch!==activeEpoch)close()},[epoch,activeEpoch])
 const prepare=()=>{
  if(!ref||epoch!==useWorkspace.getState().epoch||useAgent.getState().status==='running'||useAgent.getState().draft.trim())return
  if(!addRef(ref)){setError(de?`Im Terminal sind bereits ${REF_MAX} Referenzen. Entferne zuerst eine.`:`The terminal already has ${REF_MAX} references. Remove one first.`);return}
  useAgent.setState({pageOff:null})
  openAgent({task:codeEvidenceRequest({pageId:ref.pageId,title:ref.title,repo,version,de})})
  close()
 }
 return <Modal open={!!ref&&epoch===activeEpoch} onClose={close} title={de?'Quellcode-Belege nachfordern':'Request source-code evidence'} width={640}>
  <div className="code-evidence__form">
   <p>{de?'Die KI prüft diese Aussage anhand der in Atlas verfügbaren Code-Stände. Du prüfst die Ergebnisse vor dem Speichern in One.':'AI checks this claim against source snapshots available in Atlas. Review the results before saving them in One.'}</p>
   <blockquote style={{maxHeight:180,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{ref?.markdown}</blockquote>
   <label>{de?'Repository (optional)':'Repository (optional)'}<input className="input" value={repo} onChange={e=>setRepo(e.target.value)} maxLength={300} placeholder="icm-felix"/></label>
   <label>{de?'Branch, Commit oder Snapshot (optional)':'Branch, commit or snapshot (optional)'}<input className="input" value={version} onChange={e=>setVersion(e.target.value)} maxLength={300}/></label>
   <p className="faint">{de?'Ohne Angabe nutzt die KI den Seitenkontext und fragt bei Mehrdeutigkeit nach. Der Auftrag startet erst mit „Starten“ im KI-Terminal; dessen Modell und Datenregeln gelten.':'Without a value, AI uses page context and asks when ambiguous. The request starts only when you press Start in the AI terminal, using its model and data rules.'}</p>
   {(running||draft.trim())&&<p role="status">{de?'Im Terminal läuft noch ein Auftrag oder liegt ein Entwurf. Beende ihn oder sichere und leere den Entwurf zuerst; er wird nicht überschrieben.':'The terminal has a running task or an existing draft. Finish it, or save and clear the draft first; it will not be overwritten.'}</p>}
   {error&&<p role="alert">{error}</p>}
   <button type="button" className="btn btn--primary" onClick={prepare} disabled={running||!!draft.trim()}>{de?'Im Terminal vorbereiten':'Prepare in terminal'}</button>
  </div>
 </Modal>
}
