import {sha256Hex} from './sha256.ts'
export const POLARION_PDF_CHUNK_BYTES=96*1024
export const POLARION_PDF_MAX_BYTES=20*1024*1024
export type PolarionPdf={name:string;mime:'application/pdf';bytes:number;sha256:string;sourceUrl:string;exportedAt:string}
export type PolarionPdfReceipt={job:string;pdf:PolarionPdf}
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export function readPolarionPdf(value:unknown):PolarionPdf|undefined {
  if(!value||typeof value!=='object')return
  const p=value as PolarionPdf
  if(typeof p.name!=='string'||p.name.length>200||!p.name.trim()||/[\\/\x00-\x1f\x7f]/.test(p.name)||!p.name.toLowerCase().endsWith('.pdf')||p.mime!=='application/pdf'||!Number.isSafeInteger(p.bytes)||p.bytes<8||p.bytes>POLARION_PDF_MAX_BYTES||typeof p.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.sha256)||typeof p.exportedAt!=='string'||p.exportedAt.length>40||!Number.isFinite(Date.parse(p.exportedAt))||typeof p.sourceUrl!=='string'||p.sourceUrl.length>2000)return
  try{
    const u=new URL(p.sourceUrl)
    if(u.origin!=='https://p2-polarion.pc-c.endress.com'||u.username||u.password||u.search||u.pathname!=='/polarion/')return
    const parts=u.hash.slice(2).split('/').map(decodeURIComponent)
    if(parts.length!==5||parts[0]!=='project'||parts[2]!=='wiki'||parts.some(v=>!v||v==='.'||v==='..'||/[\\/?#\x00-\x1f]/.test(v)))return
  }catch{return}
  return {name:p.name,mime:p.mime,bytes:p.bytes,sha256:p.sha256,sourceUrl:p.sourceUrl,exportedAt:p.exportedAt}
}
export function polarionPdfReceipt(tool:string,data:Record<string,any>|null):PolarionPdfReceipt|undefined {
  if(tool!=='atlas_polarion_status'||data?.status!=='done'||typeof data.job!=='string'||!uuid.test(data.job)||data.result?.status!=='exported'||data.result?.source!=='polarion-native-pdf')return
  const pdf=readPolarionPdf(data.result.pdf)
  return pdf?{job:data.job,pdf}:undefined
}
/** Bounded byte transport. Never hand PDF chunks to inference or interpret them as text. */
export async function collectPolarionPdf(receipt:PolarionPdfReceipt,read:(index:number)=>Promise<unknown>,progress:(bytes:number)=>void=()=>{}):Promise<Uint8Array<ArrayBuffer>> {
  const expected=readPolarionPdf(receipt.pdf)
  if(!expected||!uuid.test(receipt.job))throw Error('Invalid Polarion PDF receipt.')
  const out=new Uint8Array(expected.bytes)
  for(let index=0,offset=0;offset<out.length;index++){
    const raw=await read(index) as Record<string,any>|null,pdf=readPolarionPdf(raw?.pdf)
    if(!raw||raw.job!==receipt.job||raw.index!==index||raw.chunkBytes!==POLARION_PDF_CHUNK_BYTES||!pdf||JSON.stringify(pdf)!==JSON.stringify(expected)||typeof raw.data!=='string'||raw.data.length>131072||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw.data))throw Error('Polarion PDF transfer mismatch or expired export.')
    const binary=atob(raw.data)
    if(btoa(binary)!==raw.data||binary.length!==Math.min(POLARION_PDF_CHUNK_BYTES,out.length-offset))throw Error('Incomplete Polarion PDF chunk.')
    for(let i=0;i<binary.length;i++)out[offset+i]=binary.charCodeAt(i)
    offset+=binary.length;progress(offset)
  }
  if(new TextDecoder().decode(out.subarray(0,5))!=='%PDF-'||!new TextDecoder().decode(out.subarray(Math.max(0,out.length-2048))).includes('%%EOF')||sha256Hex(out)!==expected.sha256)throw Error('Polarion PDF checksum or file validation failed. No file saved.')
  return out
}
