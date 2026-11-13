import { fileData, FILE_READ_MAX, isPdfBytes } from '../load'
import { fileKind } from '../kinds'
import { makeSource, type FileSource } from './model'
export async function loadFileSource(src:string,name:string,signal?:AbortSignal,onPage?:(done:number,total:number)=>void):Promise<FileSource>{
 const {bytes}=await fileData(src,FILE_READ_MAX,signal)
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(b=>b.toString(16).padStart(2,'0')).join('')
 if(isPdfBytes(bytes)){
  const {pdfSourcePages}=await import('../../local-coder/pdf')
  const r=await pdfSourcePages(bytes,signal,{maxPages:1000,maxCharacters:2_000_000,onPage})
  return makeSource(name,sha256,r.pages,r.totalPages)
 }
 const kind=fileKind(name);if(!kind)throw Error('Unsupported file type')
 const {fileText}=await import('../convert');const r=await fileText(kind,bytes,name)
 if(r.text.length>2_000_000)throw Error('Source exceeds 2,000,000 characters; no partial import was created.')
 return makeSource(name,sha256,[{number:1,text:r.text}])
}
