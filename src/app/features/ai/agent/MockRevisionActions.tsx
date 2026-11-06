import {useMemo,useState} from 'react'
import type {DesignMock} from '@/shared/ai/designMock'
import {mockBlockData,mockBlocksAllowed,mockPreviewFromArtifact} from '@/shared/ai/mockBlock'
import {adoptMockPreview,mockVersionKey} from '@/shared/ai/mockReview'
import {useWorkspace} from '../../../store/store'
import {useCloud} from '../../../cloud'
import {liveEditorOf,editAs} from '../../../editor'
import {useAgent} from './state'

/** Adoption is a separate, explicit One edit. Generating a proposal never replaces a block. */
export function MockRevisionActions({artifact,workspaceEpoch}:{artifact:DesignMock;workspaceEpoch?:string}){
 const pages=useWorkspace(s=>s.pages),epoch=useWorkspace(s=>s.epoch),de=useWorkspace(s=>s.settings.language==='de'),allowed=useCloud(mockBlocksAllowed)
 const [error,setError]=useState(''),review=artifact.feedbackReview
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
 const adopted=!!target?.data.preview&&mockVersionKey(target.data.preview)===mockVersionKey(mockPreviewFromArtifact(artifact))
 const stale=!!target?.data.preview&&mockVersionKey(target.data.preview)!==review.base&&!adopted
 const reason=workspaceEpoch!==(epoch??'local')?(de?'Dieses Ergebnis gehört zu einem anderen Workspace.':'This result belongs to another workspace.'):!target?(de?'Der ursprüngliche Mock-Block ist nicht eindeutig verfügbar.':'The original mock block is not uniquely available.'):!allowed||pages[target.page]?.settings.locked?(de?'Die Zielseite ist schreibgeschützt.':'The target page is read-only.'):!target.data.preview?(de?'Die ursprüngliche Vorschau wurde entfernt.':'The original preview was removed.'):stale?(de?'Der Mock wurde inzwischen geändert. Bitte vom aktuellen Stand erneut überarbeiten.':'The mock has changed. Revise again from the current version.') :''
 const accept=()=>{try{
  const state=useWorkspace.getState()
  if(!target||workspaceEpoch!==(state.epoch??'local')||!mockBlocksAllowed(useCloud.getState())||!state.pages[target.page]||state.pages[target.page].trashed||state.pages[target.page].settings.locked)throw Error(de?'Der Zielblock ist nicht mehr bearbeitbar.':'The target block is no longer editable.')
  const editor=liveEditorOf(target.page)
  if(!editor||editor.isDestroyed||!editor.isEditable)throw Error(de?'Öffne die Zielseite und übernimm die Version dort.':'Open the target page and adopt the version there.')
  const positions:number[]=[]
  editor.state.doc.descendants((node,pos)=>{if(node.type.name==='designMock'&&mockBlockData(node.attrs.spec).journal?.id===review.journal)positions.push(pos)})
  if(positions.length!==1)throw Error(de?'Der Zielblock ist nicht eindeutig.':'The target block is ambiguous.')
  const pos=positions[0],node=editor.state.doc.nodeAt(pos)!,data=mockBlockData(node.attrs.spec)
  if(data.preview&&mockVersionKey(data.preview)===mockVersionKey(mockPreviewFromArtifact(artifact)))return
  if(!data.preview)throw Error(de?'Die ursprüngliche Vorschau wurde entfernt.':'The original preview was removed.')
  const next=adoptMockPreview(data,mockPreviewFromArtifact(artifact),review)
  editAs(editor,{kind:'ai',run:artifact.id,action:'accept-mock-version'},()=>editor.view.dispatch(editor.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,spec:next})))
  setError('')
 }catch(e){setError(e instanceof Error?e.message:String(e))}}
 return <div className="mock-block__revision" aria-label={de?'Mock-Version übernehmen':'Adopt mock version'}>
  <div className="mock-block__actions"><strong>{artifact.title}</strong><button type="button" className="btn btn--primary btn--sm" disabled={!!reason||adopted} onClick={accept}>{adopted?(de?'Version übernommen':'Version adopted'):(de?'Version übernehmen':'Adopt version')}</button>{target&&<a href={'#/p/'+target.page}>{de?'Zum Mock-Block':'Open mock block'}</a>}</div>
  <p className="faint">{reason||(adopted?(de?'Der Block zeigt diese Version. Frühere Stände findest du unter „Versionen“.':'The block displays this version. Earlier snapshots are under Versions.'):(de?'Ersetzt nach deiner Annahme die Vorschau im One-Block. Die vorige Version und Notizen bleiben erhalten. Atlas wird dabei nicht synchronisiert.':'Replaces the One block preview after acceptance. Previous versions and notes are retained. This does not sync Atlas.'))}</p>
  {error&&<p role="alert">{error}</p>}
 </div>
}

export function PendingMockRevisions({journal}:{journal?:string}){
 const turns=useAgent(s=>s.turns),epoch=useWorkspace(s=>s.epoch)
 if(!journal)return null
 const candidates=turns.filter(t=>t.mockWorkspaceEpoch===(epoch??'local')).flatMap(t=>(t.mocks??[]).filter(a=>a.feedbackReview?.journal===journal).map(artifact=>({artifact,workspaceEpoch:t.mockWorkspaceEpoch}))).reverse()
 return <>{candidates.slice(0,1).map(p=><MockRevisionActions key={p.artifact.id} {...p}/>)}</>
}
