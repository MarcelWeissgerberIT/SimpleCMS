import type {DesignMock} from '@/shared/ai/designMock'
import {attachMockToAtlas} from './mockAtlas'
/** Only called by the trusted task's explicit Epic delivery option, never by mounting a card. */
export async function publishEpicMock(a:DesignMock,signal:AbortSignal,note:(text:string)=>void){
 const frame=document.createElement('iframe')
 frame.setAttribute('sandbox','allow-same-origin');frame.width=String(a.width);frame.height=String(a.height)
 frame.style.cssText='position:fixed;left:-20000px;top:0;border:0;pointer-events:none'
 try{
  note('Mock wird gerendert und als eigener Record im Design-Epic abgelegt.')
  await new Promise<void>((resolve,reject)=>{
   signal.throwIfAborted()
   const finish=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);frame.onload=null;error?reject(error):resolve()}
   const abort=()=>finish(signal.reason??new Error('Stopped'))
   const timer=setTimeout(()=>finish(Error('Mock-Vorschau konnte nicht rechtzeitig gerendert werden.')),10000)
   frame.onload=()=>{if(frame.contentDocument?.body?.childElementCount)finish()}
   signal.addEventListener('abort',abort,{once:true});frame.srcdoc=a.document;document.body.append(frame)
  })
  const {default:html2canvas}=await import('html2canvas-pro');signal.throwIfAborted()
  const canvas=await html2canvas(frame.contentDocument!.body,{width:a.width,height:a.height,windowWidth:a.width,windowHeight:a.height,scale:1,backgroundColor:null,logging:false,imageTimeout:2000})
  const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('PNG encoding failed.')),'image/png'))
  signal.throwIfAborted()
  const name='mock-'+a.id,encode=(text:string)=>new TextEncoder().encode(text)
  const files=[{filename:name+'.html',mime:'text/html' as const,bytes:encode(a.document)},{filename:name+'.png',mime:'image/png' as const,bytes:new Uint8Array(await png.arrayBuffer())},{filename:name+'-sources.json',mime:'application/json' as const,bytes:encode(JSON.stringify({...a,document:undefined},null,2))}]
  await attachMockToAtlas({...a,target:null},files,signal,uploaded=>note('Atlas-Mock · '+uploaded.length+' / 3 Anhänge gespeichert'),undefined,undefined,target=>{a.atlasDestination=target},note)
  if(a.atlasDestination)a.atlasSaved=a.atlasDestination
 }finally{frame.remove()}
}
