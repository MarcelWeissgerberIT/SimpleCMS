import {readMockJournal,type MockJournal} from './mockReview.ts'
import {mockProvenance,mockColors,type MockProvenance} from './mockBlockProvenance.ts'
import {sha256Hex} from '../mcp/sha256.ts'
import type {DesignMock} from './designMock.ts'
/** Persistent request + explicitly chosen static preview; never a credential or a live AI run. */
export interface MockBlockPreview { title: string; document: string; width: number; height: number; createdAt: string; htmlHash: string; targetUrl: string; provenance?:MockProvenance; colors?:Record<string,string>; savedHtmlHash?:string }
export interface MockBlockData { source: string; requirement: string; request: string; preview: MockBlockPreview | null; saveToEpic?: boolean; journal?:MockJournal }
const text = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : ''
/** Atlas links are stored without sign-in tokens, credentials or query strings. */
export function mockSourceUrl(value: unknown): string {
 if(typeof value !== 'string' || value.length > 2000)return ''
 try { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) return ''; u.search = ''; u.hash = ''; return u.href } catch { return '' }
}
export function mockBlockData(raw: unknown, readHistory=true): MockBlockData {
 let v = raw
 if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
 const a = v && typeof v === 'object' ? v as Record<string, unknown> : {}
 const p = a.preview && typeof a.preview === 'object' ? a.preview as Record<string, unknown> : null
 const preview = p && typeof p.document === 'string' && p.document.length <= 160_000 && typeof p.title === 'string' && Number.isInteger(p.width) && Number(p.width) >= 320 && Number(p.width) <= 1600 && Number.isInteger(p.height) && Number(p.height) >= 320 && Number(p.height) <= 1400
  ? {title: text(p.title,160), document: p.document, width: Number(p.width), height: Number(p.height), createdAt: text(p.createdAt,80), htmlHash: text(p.htmlHash,64), targetUrl: mockSourceUrl(p.targetUrl)} : null
 if(preview&&p){
  const receipt=preview.htmlHash===sha256Hex(preview.document)?mockProvenance(p.provenance):undefined
  Object.assign(preview,{provenance:receipt,colors:mockColors(p.colors,receipt),savedHtmlHash:typeof p.savedHtmlHash==='string'&&/^[a-f0-9]{64}$/.test(p.savedHtmlHash)?p.savedHtmlHash:undefined})
 }
 return {source: mockSourceUrl(a.source), requirement: text(a.requirement,2000), request: text(a.request,8000), preview, saveToEpic:a.saveToEpic===true,...(readHistory?{journal:readMockJournal(a.journal,p=>mockBlockData({preview:p},false).preview,preview)}:{})}
}
export function mockBlockTask(data: MockBlockData): string | null {
 const source = mockSourceUrl(data.source), request = data.request.trim(), requirement = data.requirement.trim()
 if (!source || !request) return null
 return `/mock ${request}\n\nAtlas design source: ${source}${requirement ? '\nAtlas requirement record: '+requirement : ''}${data.saveToEpic?'\nAtlas mock delivery: epic':''}\nUse this explicitly selected design source for the free-form request. If it is a package Epic, select relevant indexed child components and shared foundations, verify their membership, and use their exact excerpts. Keep the Epic as the mock context. Otherwise download its complete body and use relevant exact excerpts. Requirements are optional; do not invent a requirement record or a binding/current-version claim. Show unresolved questions. ${data.saveToEpic?'For a package Epic, save the generated mock as its own child record with the package tag and source links. For a single source, prepare a preview only.':'Prepare a preview; attach files to Atlas only on an explicit press.'}`
}
/** This prefix is independent of the stored document: pasted previews cannot relax its CSP. */
export const STATIC_MOCK_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'"
export const mockBlockFrame = (document: string) => `<meta http-equiv="Content-Security-Policy" content="${STATIC_MOCK_CSP}">${document}`

/** Phase one: readers ship first; cloud creation waits until old clients are write-gated. */
export const MOCK_BLOCK_GENERATION = 7
export function mockBlocksAllowed(c: {active:{kind:string}; readOnly:boolean; outdated?:boolean; schemaMin:number|null}) {
 return !c.readOnly && !c.outdated && (c.active.kind === 'local' || (c.schemaMin ?? 0) >= MOCK_BLOCK_GENERATION)
}

/** An explicit import retains the source receipt for a later Atlas upload. */
export function mockPreviewFromArtifact(a:DesignMock):MockBlockPreview{
 return {title:a.title,document:a.document,width:a.width,height:a.height,createdAt:a.createdAt,htmlHash:a.htmlHash,targetUrl:a.atlasSaved?.url??a.atlasDestination?.url??a.target?.url??'',provenance:mockProvenance({...a,document:undefined}),colors:mockColors(a.colorAdjustments,mockProvenance({...a,document:undefined})),savedHtmlHash:a.atlasSaved?a.htmlHash:undefined}
}

/** Collection order is not an edit: team journals converge in stable identity order. */
export function sameMockBlock(a:unknown,b:unknown):boolean {
 const stable=(v:unknown):unknown=>{
  if(Array.isArray(v))return v.map(stable)
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]))
  return v
 }
 const canonical=(raw:unknown)=>{
  const s=mockBlockData(raw),j=s.journal
  if(j)s.journal={...j,notes:[...j.notes].sort((a,b)=>a.id.localeCompare(b.id)),versions:[...j.versions].sort((a,b)=>a.key.localeCompare(b.key)),proposals:[...(j.proposals??[])].sort((a,b)=>a.id.localeCompare(b.id))}
  return JSON.stringify(stable(s))
 }
 return canonical(a)===canonical(b)
}
