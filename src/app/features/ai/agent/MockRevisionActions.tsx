import {compareMockPreviews} from '@/app/editor/lib/mockComparison'
import {MockComparison} from '../../../editor/views/MockComparison'
import {Modal} from '../../../ui/Modal'
import {useMemo,useState} from 'react'
import type {DesignMock} from '@/shared/ai/designMock'
import {mockBlockData,mockBlocksAllowed,mockPreviewFromArtifact} from '@/shared/ai/mockBlock'
import {adoptMockPreview,mockVersionKey,stageMockProposal,mockNoteHash} from '@/shared/ai/mockReview'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud'
import {liveEditorOf,editAs} from '../../../editor'
import {useAgent} from './state'

/** Adoption is a separate, explicit One edit. Generating a proposal never replaces a block. */
export function MockRevisionActions({artifact,workspaceEpoch}:{artifact:DesignMock;workspaceEpoch?:string}){
 const pages=useWorkspace(s=>s.pages),epoch=useWorkspace(s=>s.epoch),de=useWorkspace(s=>s.settings.language==='de'),allowed=useCloud(mockBlocksAllowed)
 const [checking,setChecking]=useState(false),[error,setError]=useState(''),[compare,setCompare]=useState(false),review=artifact.feedbackReview
 const proposal=useMemo(()=>mockPreviewFromArtifact(artifact),[artifact])
 const matches=useMemo(()=>{
  const found:Array<{page:string;data:ReturnType<typeof mockBlockData>}>=[]
  if(!review||workspaceEpoch!==(epoch??'local'))return found
  for(const page of Object.values(pages)){
   if(page.trashed)continue
   const visit=(node:any)=>{if(node?.type==='designMock'){const data=mockBlockData(node.attrs?.spec);if(data.journal?.id===review.journal)found.push({page:page.id,data})}node?.content?.forEach(visit)}
   visit(page.content)
  }
  return found
 },[pages,review,workspaceEpoch,epoch])
 if(!review)return null
 const target=matches.length===1?matches[0]:null
 const adopted=!!target?.data.preview&&mockVersionKey(target.data.preview)===mockVersionKey(proposal)
 const stale=!!target?.data.preview&&mockVersionKey(target.data.preview)!==review.base&&!adopted
 const reason=workspaceEpoch!==(epoch??'local')?(de?'Dieses Ergebnis gehört zu einem anderen Workspace.':'This result belongs to another workspace.'):!target?(de?'Der ursprüngliche Mock-Block ist nicht eindeutig verfügbar.':'The original mock block is not uniquely available.'):!allowed||pages[target.page]?.settings.locked?(de?'Die Zielseite ist schreibgeschützt.':'The target page is read-only.'):!target.data.preview?(de?'Die ursprüngliche Vorschau wurde entfernt.':'The original preview was removed.'):stale?(de?'Der Mock wurde inzwischen geändert. Bitte vom aktuellen Stand erneut überarbeiten.':'The mock has changed. Revise again from the current version.') :''
 const accept=async()=>{setChecking(true);try{
  const state=useWorkspace.getState()
  if(!target||workspaceEpoch!==(state.epoch??'local')||!mockBlocksAllowed(useCloud.getState())||!state.pages[target.page]||state.pages[target.page].trashed||state.pages[target.page].settings.locked)throw Error(de?'Der Zielblock ist nicht mehr bearbeitbar.':'The target block is no longer editable.')
  const editor=liveEditorOf(target.page)
  if(!editor||editor.isDestroyed||!editor.isEditable)throw Error(de?'Öffne die Zielseite und übernimm die Version dort.':'Open the target page and adopt the version there.')
  const positions:number[]=[]
  editor.state.doc.descendants((node,pos)=>{if(node.type.name==='designMock'&&mockBlockData(node.attrs.spec).journal?.id===review.journal)positions.push(pos)})
  if(positions.length!==1)throw Error(de?'Der Zielblock ist nicht eindeutig.':'The target block is ambiguous.')
  const pos=positions[0],node=editor.state.doc.nodeAt(pos)!,data=mockBlockData(node.attrs.spec)
  if(data.preview&&mockVersionKey(data.preview)===mockVersionKey(proposal))return
  if(!data.preview)throw Error(de?'Die ursprüngliche Vorschau wurde entfernt.':'The original preview was removed.')
  const check=await compareMockPreviews(data.preview,proposal)
  if(check.state==='identical')throw Error(de?'Keine Änderung festgestellt. Es wird keine zusätzliche Mock-Version angelegt.':'No change detected. No additional mock version will be created.')
  if(editor.isDestroyed)throw Error('Der Editor ist nicht mehr verfügbar.')
  const fresh=useWorkspace.getState(),current=editor.state.doc.nodeAt(pos)
  if(editor.isDestroyed||!editor.isEditable||!mockBlocksAllowed(useCloud.getState())||workspaceEpoch!==(fresh.epoch??'local')||!fresh.pages[target.page]||fresh.pages[target.page]?.trashed||fresh.pages[target.page]?.settings.locked||!current||current.type.name!=='designMock'||mockBlockData(current.attrs.spec).journal?.id!==review.journal)throw Error('Der Mock ist nicht mehr unverändert bearbeitbar.')
  const next=adoptMockPreview(mockBlockData(current.attrs.spec),proposal,review)
  if(next.journal)next.journal.proposals=next.journal.proposals?.map(p=>p.id===artifact.htmlHash?{...p,status:'adopted'}:p)
  editAs(editor,{kind:'ai',run:artifact.id,action:'accept-mock-version'},()=>editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,spec:next})))
  setError('')
 }catch(e){setError(e instanceof Error?e.message:String(e))}finally{setChecking(false)}}
 return <div className="mock-block__revision" aria-label={de?'Mock-Version übernehmen':'Adopt mock version'}>
  <div className="mock-block__actions"><strong>{artifact.title}</strong><button type="button" className="btn btn--primary btn--sm" disabled={!!reason||adopted||checking} onClick={()=>void accept()}>{checking?(de?'Vergleich wird geprüft …':'Checking comparison …'):adopted?(de?'Version übernommen':'Version adopted'):(de?'Version übernehmen':'Adopt version')}</button>{target?.data.preview&&<button type="button" className="btn btn--sm" onClick={()=>setCompare(true)}>{de?'Vorher / Nachher':'Before / after'}</button>}{target&&<button type="button" className="btn btn--sm" disabled={!allowed||!!pages[target.page]?.settings.locked||workspaceEpoch!==(epoch??'local')||adopted} onClick={()=>{try{persistMockProposal(artifact,'discarded');setError('')}catch(e){setError(String(e))}}}>{de?'Verwerfen':'Discard'}</button>}{target&&<a href={'#/p/'+target.page}>{de?'Zum Mock-Block':'Open mock block'}</a>}</div>
  <p className="faint">{reason||(adopted?(de?'Der Block zeigt diese Version. Frühere Stände findest du unter „Versionen“.':'The block displays this version. Earlier snapshots are under Versions.'):(de?'Ersetzt nach deiner Annahme die Vorschau im One-Block. Die vorige Version und Notizen bleiben erhalten. Atlas wird dabei nicht synchronisiert.':'Replaces the One block preview after acceptance. Previous versions and notes are retained. This does not sync Atlas.'))}</p>
  {error&&<p role="alert">{error}</p>}{compare&&target?.data.preview&&<Modal open title={de?'Mock vergleichen':'Compare mock'} width="calc(100vw - 24px)" onClose={()=>setCompare(false)}><MockComparison before={target.data.preview} after={proposal} de={de} notes={target.data.journal?.notes.filter(n=>review.notes.some(r=>r.id===n.id))} review={review}/></Modal>}
 </div>
}

/** Persist a proposal in the original block; no Atlas operation and no replacement of its preview. */
export function persistMockProposal(artifact:DesignMock,status:'pending'|'discarded'='pending'){
 const review=artifact.feedbackReview,state=useWorkspace.getState()
 if(!review||!mockBlocksAllowed(useCloud.getState()))throw Error('Mock-Speicherung ist noch nicht verfügbar. Bitte One neu laden.')
 const found:Array<{page:string}>=[]
 for(const page of Object.values(state.pages)){if(page.trashed)continue;const visit=(n:any)=>{if(n?.type==='designMock'&&mockBlockData(n.attrs?.spec).journal?.id===review.journal)found.push({page:page.id});n?.content?.forEach(visit)};visit(page.content)}
 if(found.length!==1||state.pages[found[0].page]?.settings.locked)throw Error('Der ursprüngliche Block ist nicht eindeutig bearbeitbar.')
 const page=found[0].page,editor=liveEditorOf(page)
 const update=(raw:unknown)=>{const data=mockBlockData(raw),existing=data.journal?.proposals?.find(p=>p.id===artifact.htmlHash)
  if(existing){if(status==='pending')return data;return {...data,journal:{...data.journal!,proposals:data.journal!.proposals!.map(p=>p.id===existing.id?{...p,status}:p)}}}
  return stageMockProposal(data,{id:artifact.htmlHash,preview:mockPreviewFromArtifact(artifact),review,status})
 }
 if(editor&&!editor.isDestroyed){if(!editor.isEditable)throw Error('Die Seite ist schreibgeschützt.');const positions:number[]=[];editor.state.doc.descendants((n,pos)=>{if(n.type.name==='designMock'&&mockBlockData(n.attrs.spec).journal?.id===review.journal)positions.push(pos)});if(positions.length!==1)throw Error('Mock-Block nicht eindeutig.');const pos=positions[0],n=editor.state.doc.nodeAt(pos)!;editAs(editor,{kind:'ai',run:artifact.id,action:'stage-mock-version'},()=>editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...n.attrs,spec:update(n.attrs.spec)})))}
 else {const map=(n:any):any=>({...n,...(n.type==='designMock'&&mockBlockData(n.attrs?.spec).journal?.id===review.journal?{attrs:{...n.attrs,spec:update(n.attrs.spec)}}:{}),...(n.content?{content:n.content.map(map)}:{})});state.setContent(page,map(state.pages[page].content),'ai')}
}
export function PendingMockRevisions({journal}:{journal?:string}){
 const turns=useAgent(s=>s.turns),epoch=useWorkspace(s=>s.epoch),pages=useWorkspace(s=>s.pages)
 if(!journal)return null
 const stored:import('@/shared/ai/mockReview').MockProposal[]=[]
 for(const page of Object.values(pages)){if(page.trashed)continue;const visit=(n:any)=>{if(n?.type==='designMock'){const data=mockBlockData(n.attrs?.spec);if(data.journal?.id===journal)stored.push(...(data.journal.proposals??[]))}n?.content?.forEach(visit)};visit(page.content)}
 const candidates=turns.filter(t=>t.mockWorkspaceEpoch===(epoch??'local')).flatMap(t=>(t.mocks??[]).filter(a=>a.feedbackReview?.journal===journal&&!stored.some(p=>p.id===a.htmlHash)).map(artifact=>({artifact,workspaceEpoch:t.mockWorkspaceEpoch})))
 for(const p of stored.filter(p=>p.status==='pending')){const v=p.preview,r=v.provenance;if(r)candidates.push({artifact:{...r,title:v.title,width:v.width,height:v.height,document:v.document,htmlHash:v.htmlHash,createdAt:v.createdAt,colorAdjustments:v.colors,review:'open',feedbackReview:p.review},workspaceEpoch:epoch??'local'})}
 return <>{candidates.reverse().map(p=><MockRevisionActions key={p.artifact.htmlHash} {...p}/>)}</>
}

export function persistMockMarkdown(journal:string,noteId:string,markdown:import('@/shared/ai/mockReview').MockMarkdownChange){
 const state=useWorkspace.getState();if(!mockBlocksAllowed(useCloud.getState()))throw Error('Mock-Speicherung nicht verfügbar.')
 const matches=Object.values(state.pages).filter(p=>!p.trashed&&JSON.stringify(p.content).includes(journal))
 const found=matches.filter(p=>{let count=0;const visit=(n:any)=>{if(n?.type==='designMock'&&mockBlockData(n.attrs?.spec).journal?.id===journal)count++;n?.content?.forEach(visit)};visit(p.content);return count===1})
 if(found.length!==1||found[0].settings.locked)throw Error('Mock-Ziel nicht eindeutig bearbeitbar.')
 const page=found[0],editor=liveEditorOf(page.id)
 const patch=(raw:unknown)=>{const d=mockBlockData(raw);if(!d.journal?.notes.some(n=>n.id===noteId&&(!markdown.noteHash||mockNoteHash(n)===markdown.noteHash)))throw Error('Notiz nicht mehr vorhanden.');return {...d,journal:{...d.journal,notes:d.journal.notes.map(n=>n.id===noteId?{...n,markdown,md:markdown.state==='verified'?'done' as const:'pending' as const}:n)}}}
 if(editor&&!editor.isDestroyed){if(!editor.isEditable)throw Error('Seite schreibgeschützt.');const positions:number[]=[];editor.state.doc.descendants((n,pos)=>{if(n.type.name==='designMock'&&mockBlockData(n.attrs.spec).journal?.id===journal)positions.push(pos)});if(positions.length!==1)throw Error('Mock-Ziel nicht eindeutig.');const pos=positions[0],n=editor.state.doc.nodeAt(pos)!;editAs(editor,{kind:'ai',run:journal,action:'mock-markdown-checkpoint'},()=>editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...n.attrs,spec:patch(n.attrs.spec)})))}
 else{const map=(n:any):any=>({...n,...(n.type==='designMock'&&mockBlockData(n.attrs?.spec).journal?.id===journal?{attrs:{...n.attrs,spec:patch(n.attrs.spec)}}:{}),...(n.content?{content:n.content.map(map)}:{})});state.setContent(page.id,map(page.content),'ai')}
}
