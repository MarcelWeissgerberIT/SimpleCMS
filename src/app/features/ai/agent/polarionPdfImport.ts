import {collectPolarionPdf,type PolarionPdfReceipt} from '@/shared/mcp/polarionPdf'
import {atlasData} from '@/shared/mcp/facts'
import {sha256Hex} from '@/shared/mcp/sha256'
import {currentSetup,attachMcp} from '../mcp-servers/config'
import {workerMcpSession} from '../core/workerMcp'
import {loadQuandProfile} from '../core/quandprofile'
import {sourceScope} from '../../io/import/sourceAtlas'
import {fileWorkspace,saveDetachedFile,FILE_PREFIX} from '../../../lib/files'
import {getFileBlob,putFile} from '../../../cloud/api'
import {useCloud} from '../../../cloud'
import {useWorkspace} from '../../../store/store'
import {isEffectivelyTrashed} from '../../../store/selectors'
import type {SavedMedia} from '../media/types'

/** Explicit file import: original bytes, original workspace, private until inserted. */
export async function importPolarionPdf(receipt:PolarionPdfReceipt,serverName:string,pageId:string|null,signal:AbortSignal,progress:(bytes:number)=>void):Promise<SavedMedia> {
  const scope=sourceScope(),ws=fileWorkspace()
  const check=()=>{
    signal.throwIfAborted()
    const pages=useWorkspace.getState().pages
    if(!ws||scope!==sourceScope()||ws!==fileWorkspace()||useCloud.getState().readOnly||!pageId||!pages[pageId]||isEffectivelyTrashed(pages,pageId))throw Error('Open the original editable ONE page and workspace before importing this PDF.')
  }
  check()
  const setup=currentSetup(),server=setup.servers.find(s=>s.name===serverName)
  if(!server)throw Error('Original personal Atlas connection unavailable.')
  const tool='atlas_polarion_pdf_chunk'
  const attached=await attachMcp({...setup,servers:[server]},'fixed',{forced:[server.name],allow:{[server.name]:[tool]}})
  check();if(!attached?.worker?.length)throw Error('Personal Atlas access is not configured.')
  await loadQuandProfile();check()
  const remote=workerMcpSession(attached.worker,signal,()=>{},200000)
  await remote('one_mcp_search',{query:tool},crypto.randomUUID());check()
  if(!remote.schema(server.name,tool))throw Error('Update the Atlas server and Polarion worker to enable native PDF export.')
  const bytes=await collectPolarionPdf(receipt,async index=>{
    check()
    // Stay below ONE's shared 60 calls/minute limit, including for large PDFs.
    if(index)await new Promise<void>((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))}
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},1200)
      signal.addEventListener('abort',abort,{once:true})
    })
    check()
    const raw=remote.materializeResult(await remote('one_mcp_call',{server:server.name,name:tool,arguments:{job:receipt.job,index}},crypto.randomUUID()))
    check();const data=atlasData(raw)
    if(JSON.parse(raw).isError||data?.ok===false||data?.error)throw Error('PDF transfer unavailable or expired. Request a new native Polarion export.')
    return data
  },progress)
  check()
  const blob=new Blob([bytes],{type:'application/pdf'}),src=await saveDetachedFile(blob,receipt.pdf.name,ws!)
  check()
  if(ws!.startsWith('cloud:')){
    const workspace=ws!.slice(6),id=src.slice(FILE_PREFIX.length)
    await putFile(workspace,id,blob,receipt.pdf.name,true);check()
    const stored=await getFileBlob(workspace,id);check()
    if(!stored||sha256Hex(new Uint8Array(await stored.blob.arrayBuffer()))!==receipt.pdf.sha256)throw Error('ONE upload could not be verified. No attachment inserted.')
  }
  check()
  return {src,kind:'file',name:receipt.pdf.name,size:bytes.length,mime:'application/pdf',caption:`Polarion · ${receipt.pdf.sourceUrl} · ${receipt.pdf.exportedAt} · SHA-256 ${receipt.pdf.sha256}`,alt:'',itemId:receipt.job}
}
