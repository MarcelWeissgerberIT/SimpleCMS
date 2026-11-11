import {polarionPdfReceipt,type PolarionPdfReceipt} from './polarionPdf.ts'
import {ATLAS_CODE_READ_TOOLS,readCodeCitation,type AtlasCodeCitation} from './atlasCode.ts'
import {type QuantumProof} from '../quandprofile/runtime.ts'
/** Run-local facts from tool responses. Model prose, discovery and document bodies cannot mint facts. */
export type AtlasReceipt = {
  polarionPdf?: PolarionPdfReceipt
  authentication?: { url: string }
  code?:{citation:AtlasCodeCitation;verified:boolean}
  quantum?: QuantumProof
  server?: string
  tool: string
  outcome: 'ok' | 'partial' | 'error'
  effect: 'read' | 'write_accepted' | 'queued' | 'unknown'
  refs: number[]
  /** Structured links only: not fetched bodies and never writable targets. */
  linkedRefs?: number[]
  ids: string[]
  counts: Array<{ unit: string; value: number; scope?: 'returned'|'total'; tenant?:string }>
  person?: string
  status?: string
  verification?: 'not_checked' | 'read_back_matches' | 'read_back_differs' | 'unavailable'
}
export type FactIssue = { kind: 'reference' | 'count' | 'effect' | 'outcome'; detail: string }
/** Models need the observed effect, target and read-back state. Cryptographic gate details
 * remain in the original host receipt/inspector; repeating them per read crowds out source text. */
export function modelAtlasReceipt({quantum,...receipt}:AtlasReceipt){return {...receipt,...(quantum?{quantum:{gate:quantum.gate,status:quantum.status}}:{})}}
type Call = { server: string; name: string; arguments: Record<string, unknown> }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const READ = new Set<string>([...ATLAS_CODE_READ_TOOLS,'atlas_whoami','atlas_project_list','atlas_tenant_search','atlas_record_kinds','atlas_get','atlas_search','atlas_query','atlas_constraints','atlas_children','atlas_graph','atlas_sprint_report','atlas_code_resolve','atlas_setup_bootstrap','atlas_setup_changelog','atlas_similar','atlas_context','atlas_briefing','atlas_agent_list','atlas_flow_list','atlas_agent_inbox','atlas_agent_approvals','atlas_my_agent_jobs','atlas_polarion_export_pdf','atlas_polarion_pdf_chunk','atlas_polarion_status','atlas_polarion_resolve','atlas_polarion_read','atlas_polarion_inspect','atlas_polarion_search'])
const WRITE = new Set(['atlas_code_change_save','atlas_code_change_publish','atlas_code_propose','atlas_create','atlas_update','atlas_comment','atlas_log_work','atlas_bulk_update','atlas_sprint_commit','atlas_delete','atlas_restore','atlas_attach','atlas_attach_link','atlas_setup_checkup','atlas_assess','atlas_health_scan','atlas_project_delete','atlas_tenant_select','atlas_agent_create','atlas_agent_propose','atlas_agent_flow','atlas_agent_trigger','atlas_flow_start','atlas_agent_job_claim','atlas_agent_job_done','atlas_agent_job_approve','atlas_agent_update','atlas_agent_token','atlas_agent_token_revoke','atlas_agent_revoke','atlas_agent_block','atlas_memory_save'])
/** Host classification; model-supplied annotations do not grant an effect. Unknown tools fail closed. */
export function atlasTaskEffect(name:string,args:Record<string,unknown>):'read'|'write'|'execute'|'authenticate'|'forbidden'{
  if(READ.has(name)||name==='atlas_agent_flow'&&['list','get'].includes(String(args.action)))return 'read'
  if(['atlas_flow_start','atlas_agent_trigger','atlas_agent_job_claim'].includes(name))return 'execute'
  if(name==='atlas_polarion_prepare_change')return 'read'
  if(name==='atlas_polarion_connect')return 'authenticate'
  if(name==='atlas_polarion_apply_change')return 'execute'
  if(WRITE.has(name))return 'write'
  return 'forbidden'
}
/** Only the actual selected catalogue may identify a generic operation as read-only.
 * Tool names, descriptions and model-supplied arguments cannot establish that fact. */
export function mcpTaskEffect(name:string,args:Record<string,unknown>,catalogue?:{readOnly?:boolean}){
  if(name.startsWith('atlas_'))return atlasTaskEffect(name,args)
  return catalogue?.readOnly===true?'read':'forbidden'
}
const COUNTS: Record<string, string> = { kinds:'record_kinds', projects:'projects', agents:'agents', flows:'flows', jobs:'jobs', tenants:'tenants', items:'records', rows:'records', records:'records', constraints:'constraints' }
const META = new Set(['item','agent','proposal','job','chain','sprint','subject','next','result','run'])
const REF_KEYS = new Set(['ref','eventRef','runRef','subjectRef','doneRunRef','triggerRunRef'])
const ID_KEYS = new Set(['id','chainId','flowId','tokenId'])
const REFERENCE_WRITE = new Set(['atlas_update','atlas_comment','atlas_log_work','atlas_delete','atlas_attach','atlas_attach_link','atlas_sprint_commit'])

export function atlasData(raw: unknown): Record<string, any> | null {
  try {
    let v = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (object(v) && Array.isArray(v.content) && v.content.length === 1 && v.content[0]?.type === 'text') v = JSON.parse(v.content[0].text)
    return object(v) ? v : null
  } catch { return null }
}

/** Only a structured Polarion response can produce an automatic sign-in action. */
export function polarionSignInUrl(tool: string, data: Record<string, any> | null): string | undefined {
  if (!['atlas_polarion_connect', 'atlas_polarion_status'].includes(tool)) return
  const interaction = data?.result?.interaction ?? data?.interaction
  if (interaction?.type !== 'url' || interaction?.purpose !== 'authentication' || typeof interaction.url !== 'string') return
  try {
    const url = new URL(interaction.url)
    if (url.origin !== 'https://aj-atlas.com' || url.username || url.password || url.search || url.hash
      || !/^\/mcp\/secure-input\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(url.pathname)) return
    return url.href
  } catch { return }
}

export function atlasReceipt(tool: string, raw: unknown, failed = false): AtlasReceipt {
  const data = atlasData(raw), envelope = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw
  const error = failed || envelope?.isError === true || data?.ok === false || typeof data?.error === 'string'
  const refs = new Set<number>(), ids = new Set<string>()
  // Only protocol metadata, never arbitrary body/comment/prompt text or model-supplied _one* fields.
  const walk = (v: unknown, depth = 0) => {
    if (!object(v) || depth > 7) return
    for (const [key, value] of Object.entries(v)) {
      if (REF_KEYS.has(key) && Number.isSafeInteger(value) && Number(value) > 0) refs.add(Number(value))
      if (ID_KEYS.has(key) && typeof value === 'string' && value.length <= 100) ids.add(value)
      if (META.has(key)) walk(value, depth + 1)
      if (key in COUNTS && Array.isArray(value)) value.slice(0, 200).forEach(row => walk(row, depth + 1))
    }
  }
  if (!error) walk(data)
  const counts: AtlasReceipt['counts'] = []
  if (!error && data) {
    for (const [key, unit] of Object.entries(COUNTS)) if (Array.isArray(data[key])) counts.push({ unit:tool.startsWith('atlas_code_')?({atlas_code_repos:'repositories',atlas_code_versions:'snapshots',atlas_code_files:'files',atlas_code_drafts:'drafts',atlas_code_compare:'files'} as Record<string,string>)[tool]??unit:unit, value:data[key].length, ...(['atlas_search','atlas_query'].includes(tool)&&unit==='records'?{scope:'returned' as const}:{}) })
    if (['atlas_search','atlas_query'].includes(tool)) for (const key of ['count','total']) if (Number.isSafeInteger(data[key]) && data[key] >= 0) counts.push({ unit:'records', value:data[key], scope:key==='count'?'returned':'total' })
    if(tool==='atlas_project_list'&&Array.isArray(data.projects)){
      const groups=new Map<string,number>()
      for(const p of data.projects)if(object(p)&&typeof p.tenant==='string'&&/^[a-z0-9_-]{1,80}$/i.test(p.tenant))groups.set(p.tenant,(groups.get(p.tenant)??0)+1)
      for(const [tenant,value] of [...groups].slice(0,100))counts.push({unit:'projects',value,tenant})
    }
  }
  const linkedRefs=new Set<number>()
  if(!error&&data){
    // Only known structured relation/constraint metadata; never scrape body, prompt or comment text.
    for(const rows of [data.activeConstraints,data.item?.activeConstraints,data.item?.relations])if(Array.isArray(rows))for(const r of rows.slice(0,200))if(object(r)&&Number.isSafeInteger(r.ref)&&r.ref>0)linkedRefs.add(r.ref)
  }
  let effect: AtlasReceipt['effect'] = READ.has(tool) ? 'read' : WRITE.has(tool) ? 'write_accepted' : 'unknown'
  if (tool === 'atlas_agent_flow' && data?.flow === undefined) effect = 'unknown'
  if (['atlas_flow_start','atlas_agent_trigger'].includes(tool) && data?.job?.status !== 'done') effect = 'queued'
  const citation=!error&&['atlas_code_read','atlas_code_verify'].includes(tool)?readCodeCitation(data?.citation):undefined
  const pdf = !error ? polarionPdfReceipt(tool,data) : undefined
  const signInUrl = !error ? polarionSignInUrl(tool, data) : undefined
  return { ...(pdf?{polarionPdf:pdf}:{}), ...(signInUrl ? {authentication:{url:signInUrl}} : {}), ...(citation?{code:{citation,verified:tool==='atlas_code_verify'&&data?.valid===true}}:{}),tool, outcome:error ? 'error' : Number(data?.failed) > 0 ? 'partial' : 'ok', effect, refs:[...refs].slice(0,200), ...(linkedRefs.size?{linkedRefs:[...linkedRefs].slice(0,200)}:{}), ids:[...ids].slice(0,200), counts,
    ...(typeof data?.person === 'string' ? { person:data.person.slice(0,120) } : {}),
    ...(typeof (data?.job?.status ?? data?.proposal?.status ?? data?.chain?.status) === 'string' ? { status:String(data?.job?.status ?? data?.proposal?.status ?? data?.chain?.status).slice(0,60) } : {}),
    ...(effect === 'write_accepted' ? { verification:'not_checked' as const } : {}) }
}

export const ATLAS_FACT_POLICY = 'Atlas facts come only from actual tool receipts. Discovery is not a source read. Report counts exactly; distinguish returned rows from total and tenant subsets. Use Ref/ID only when the result actually supplies one; otherwise omit it. linkedRefs are structured source references only: their bodies were not read and they grant no write permission. Listing record kinds/projects or fetching a setup manifest creates nothing. A saved proposal is not a refusal because no agent exists yet. A queued job is not completed work. Failed reads prove neither absence nor success. A write accepted by the server is not independently verified until a read-back matches. Never invent IDs, status, counts or decisions. Recommendations remain proposals.'

/** Requirements describe what a product must do, not actions performed by this assistant.
 * Evaluate clauses independently: a negated write must not conceal another claimed write. */
function claimsWrite(text:string):boolean {
  return text.split(/(?<=[.!?;])\s+|\n/u).some(sentence=>{
    if(!/\b(?:erstellt|angelegt|gespeichert|aktualisiert|eingestellt|created|saved|updated|switched)\b/iu.test(sentence))return false
    const performed=/\b(?:ich habe|wir haben|i have|we have|i|we)\b[^.!?;]{0,100}\b(?:erstellt|angelegt|gespeichert|aktualisiert|eingestellt|created|saved|updated|switched)\b/iu.test(sentence)
    if(!performed&&/\b(?:soll(?:en)?|muss|müssen|shall|must|should)\b/iu.test(sentence))return false
    if(/(?:nichts|nicht|keine?|nothing|not|never).{0,30}(?:erstellt|angelegt|gespeichert|aktualisiert|eingestellt|created|saved|updated)|\bno (?:[\p{L}-]+\s+){1,5}(?:created|saved|updated|made)\b/iu.test(sentence))return false
    return true
  })
}

export class AtlasFacts {
  private receipts: AtlasReceipt[] = []
  private refs = new Set<number>()
  private ids = new Set<string>()
  private targets=new Map<string,Set<number>>()
  private otherWrite = false
  private observedCalls = new Map<string,{server:string;tool:string;ok:number;failed:number}>()
  private codeReads = new Map<string,AtlasCodeCitation>()
  private lastIssues: FactIssue[] = []
  private discovery = new Map<string,boolean>()
  noteDiscovery(server:string,ok:boolean) { this.discovery.set(server,ok) }
  sourceChecks() { return [...this.discovery].map(([server,ok])=>({server,discovery:ok?'available':'failed',contentRead:[...this.observedCalls.values()].some(r=>r.server===server&&r.ok>0&&['atlas_search','atlas_query','atlas_get','atlas_context','atlas_briefing','atlas_code_read'].includes(r.tool))})) }
  noteOtherWrite() { this.otherWrite=true }
  observedTargets(server:string) { return [...this.targets.get(server)??[]] }
  observe(call: Call, raw: unknown, failed = false) {
    const receipt = atlasReceipt(call.name, raw, failed)
    if (!call.name.startsWith('atlas_')) return receipt
    receipt.server=call.server
    if(call.name==='atlas_agent_flow'&&['list','get'].includes(String(call.arguments.action))){receipt.effect='read';delete receipt.verification}
    const callKey=JSON.stringify([call.server,call.name]),total=this.observedCalls.get(callKey)??{server:call.server,tool:call.name,ok:0,failed:0}
    if(receipt.outcome==='ok')total.ok++;else total.failed++
    if(this.observedCalls.size<200||this.observedCalls.has(callKey))this.observedCalls.set(callKey,total)
    if(receipt.code&&receipt.outcome==='ok'&&this.codeReads.size<200)this.codeReads.set(JSON.stringify(receipt.code.citation),receipt.code.citation)
    this.receipts.push(receipt); if (this.receipts.length > 32) this.receipts.shift()
    const targets=this.targets.get(call.server)??new Set<number>();this.targets.set(call.server,targets)
    if(receipt.outcome==='ok')for(const ref of receipt.refs)if(targets.size<2000)targets.add(ref)
    // Bounded to the current run. A failed target may be named in an error answer, but is not a source.
    for (const ref of [...receipt.refs, call.arguments.ref]) if (Number.isSafeInteger(ref) && Number(ref)>0 && this.refs.size<2000) this.refs.add(Number(ref))
    for(const ref of receipt.linkedRefs??[])if(this.refs.size<2000)this.refs.add(ref)
    for (const id of receipt.ids) if (this.ids.size<2000) this.ids.add(id)
    return receipt
  }
  preflight(call: Call): string | null {
    if (!REFERENCE_WRITE.has(call.name)) return null
    const ref = call.arguments.ref
    if (typeof ref === 'number' && !this.targets.get(call.server)?.has(ref)) return 'Read the exact target with atlas_get first. This write was NOT executed; a reference in model prose is not an observed target.'
    return null
  }
  snapshot() { return this.receipts.map(r => ({ ...r, refs:[...r.refs], ...(r.linkedRefs?{linkedRefs:[...r.linkedRefs]}:{}), ids:[...r.ids], counts:r.counts.map(c=>({...c})) })) }
  check(text: string): FactIssue[] {
    if (!this.receipts.length&&!this.discovery.size) return []
    const issues: FactIssue[] = []
    const add = (kind: FactIssue['kind'], detail: string) => { if (issues.length<8 && !issues.some(i=>i.kind===kind&&i.detail===detail)) issues.push({kind,detail}) }
    for (const m of text.matchAll(/(?:\/r\/|\b(?:Ref(?:erenz)?(?:[-/]ID)?|Record|ID)\s*(?:[:#=]|ist|is)?\s*[`#]?)([A-Za-z0-9][\w-]*)/gi)) {
      const value=m[1]; if(!value)continue; if (/^\d+$/.test(value) ? !this.refs.has(Number(value)) : /\d/.test(value)&&!this.ids.has(value)) add('reference','Reference not present in actual tool results: '+value.slice(0,100))
    }
    for (const m of text.matchAll(/"(?:ref|atlasRef|recordRef)"\s*:\s*(\d+)/g)) if (!this.refs.has(Number(m[1]))) add('reference','Reference not present in actual tool results: '+m[1])
    const units: Array<[RegExp,string]> = [[/\b(\d+)\s+(?:Record[- ]?Kinds?|Record[- ]?Typen?)\b/gi,'record_kinds'],[/\b(\d+)\s+(?:Projekte|projects)\b/gi,'projects'],[/\b(\d+)\s+(?:Agenten|agents)\b/gi,'agents'],[/\b(\d+)\s+(?:Treffer|results|matches)\b/gi,'records']]
    for (const [pattern,unit] of units) {
      for (const m of text.matchAll(pattern)) {
        const line=text.slice(text.lastIndexOf('\n',m.index)+1,text.indexOf('\n',m.index)<0?text.length:text.indexOf('\n',m.index))
        const tenant=unit==='projects'?line.match(/\bTenant\s*[:=]?\s*[`"'* ]*([a-z0-9_-]+)/iu)?.[1]:undefined
        const counts=this.receipts.filter(r=>r.outcome==='ok').flatMap(r=>r.counts.filter(c=>c.unit===unit&&(tenant?c.tenant===tenant:!c.tenant)).map(c=>c.value))
        if(counts.length&&!counts.includes(Number(m[1])))add('count',`Claimed ${m[1]} ${unit}${tenant?' for tenant '+tenant:''}; observed counts: ${[...new Set(counts)].join(', ')}.`)
      }
    }
    const successful=this.receipts.filter(r=>r.outcome==='ok')
    if (!this.otherWrite&&successful.length&&successful.every(r=>r.effect==='read')&&claimsWrite(text)) add('effect','Only read operations succeeded; no write or new object was observed.')
    // A successful identity/catalogue check cannot erase a failed content read.
    // Only an actual query response may establish a scoped empty result.
    const absence=text.split(/(?<=[.!?])\s+|\n/u).some(sentence=>!/(?:nicht (?:belegt|nachgewiesen|bestätigt)|not (?:established|verified|confirmed)|cannot (?:conclude|establish)|lässt sich nicht|kann.{0,20}nicht.{0,20}(?:sagen|feststellen))/iu.test(sentence)&&/(?:\b(?:es gibt|es existieren) keine?\s+(?:[\p{L}-]+\s+){0,4}(?:Dokumente?|Einträge?|Aufgaben?|Treffer|Ergebnisse?|Datensätze?|Records?)\b|\bkeine?\s+(?:[\p{L}-]+\s+){0,3}(?:Dokumente?|Einträge?|Aufgaben?|Treffer|Ergebnisse?|Datensätze?|Records?).{0,45}(?:gefunden|vorhanden|existier)|\b(?:no|zero)\s+(?:(?:open|active|matching|Atlas)\s+){0,3}(?:records?|documents?|tasks?|results?|matches|sources?)(?:\s+(?:were|are|have been))?\s*(?:found|available|exist))/iu.test(sentence))
    const lastQuery=this.receipts.filter(r=>['atlas_search','atlas_query'].includes(r.tool)).at(-1)
    const returned=lastQuery?.counts.find(c=>c.unit==='records'&&c.scope==='returned')
    if(absence&&(!lastQuery||lastQuery.outcome!=='ok'||!returned))add('outcome','No successful Atlas content query establishes this absence claim. Identity/discovery and failed reads are not evidence of missing records.')
    if(absence&&lastQuery?.outcome==='ok'&&returned&&returned.value>0&&!/(?:keine (?:weiteren|zusätzlichen|fachlich passenden|relevanten)|no (?:additional|further|more|relevant))/iu.test(text))add('outcome','The actual Atlas query returned records; a blanket empty-result claim contradicts the observed response.')
    const writes=this.receipts.filter(r=>r.outcome==='ok'&&r.effect==='write_accepted'&&['atlas_create','atlas_update'].includes(r.tool))
    if(writes.some(r=>r.verification!=='read_back_matches')&&/(?:unabhängig.{0,60}(?:verifiziert|bestätigt)|zurückgelesen.{0,40}(?:verifiziert|bestätigt|überein)|independently.{0,50}(?:verified|confirmed)|read.back.{0,35}(?:matches|verified|confirmed))/iu.test(text)&&!/(?:nicht|noch offen|not |unavailable|differs|weicht ab).{0,30}(?:verifiziert|verified|confirmed|matches)|(?:Rückleseprüfung|read.back).{0,50}(?:offen|nicht|unavailable|differs|weicht ab)/iu.test(text))add('outcome','An accepted write has no matching independent read-back. Do not claim verified persistence or completion.')
    const latest=this.receipts.at(-1)
    if(!latest){this.lastIssues=issues;return issues}
    if(latest.effect==='queued'&&latest.status!=='done'&&/(?:Job|Auftrag|Agent|Flow|Arbeit).{0,70}(?:abgeschlossen|erledigt|completed|finished)/i.test(text)&&!/(?:nicht|not).{0,20}(?:abgeschlossen|erledigt|completed|finished)/i.test(text))add('outcome','The actual job is queued; execution and completion were not observed.')
    if(latest.outcome==='partial'&&/(?:keine Fehler|ohne Fehler|no errors|without errors)/i.test(text))add('outcome','The actual response reports a partial failure, not an error-free operation.')
    if (latest.outcome==='ok'&&latest.tool==='atlas_agent_propose'&&latest.ids.length&&/(?:abgewiesen|abgelehnt|rejected|refused|keine ID|no ID)/i.test(text)) add('outcome','Atlas returned a stored proposal with an ID; this is not a refusal.')
    if (latest.outcome==='error'&&/(?:keine?.{0,50}(?:Dokument|Eintr[aä]g|Treffer).{0,40}(?:gefunden|vorhanden)|no.{0,35}(?:records|documents|matches).{0,25}found)/i.test(text)) add('outcome','The source request failed; absence of records was not established.')
    this.lastIssues=issues
    return issues
  }
  repair(issues: FactIssue[]) {
    return ATLAS_FACT_POLICY+'\nCorrect only the flagged claims in the draft using these host observations. No tools are available; do not repeat writes or add new tasks. This is the only fact-correction attempt. Remove unsupported identifiers; do not repeat them even in a retraction. Preserve unrelated qualified findings. This packet contains metadata, not source bodies: do not infer that a source was not read or a finding is false because it is absent from the recent receipt excerpt. Staged ONE changes are proposals awaiting review, not applied writes. Code citation verified=false means no separate citation verification, not a failed read.\n'+JSON.stringify({issues,sourceChecks:this.sourceChecks(),stagedOneChanges:this.otherWrite,observedCalls:[...this.observedCalls.values()],codeReads:[...this.codeReads.values()],codeReadsMayBeExcerpted:this.codeReads.size>=200,knownRefs:[...this.refs].slice(0,200),knownRefsExcerpted:this.refs.size>200,recentReceiptsOnly:true,receipts:this.snapshot().slice(-8).map(r=>({...modelAtlasReceipt(r),refs:r.refs.slice(0,12),ids:r.ids.slice(0,12),identifiersExcerpted:r.refs.length>12||r.ids.length>12}))})
  }
  fallback(labels: {heading:string;failed:string;discovery?:string;read?:string;write?:string;queued?:string;unknown?:string;next?:string;staged?:string;issues?:Partial<Record<FactIssue['kind'],string>>}) {
    const reasons=[...new Set(this.lastIssues.map(i=>labels.issues?.[i.kind]).filter(Boolean))]
    const rows=this.receipts.slice(-8).map(r=>{
      const status=r.outcome!=='ok'?labels.failed:r.effect==='read'?(labels.read??'Read'):r.effect==='queued'?(labels.queued??'Queued'):r.effect==='write_accepted'?(labels.write??'Accepted; read-back required'):(labels.unknown??'Effect unknown')
      const code=r.code?.citation
      const details=[...(code?[`${code.path} · ${code.lines[0]}–${code.lines[1]} · ${code.commit.slice(0,12)}`]:[]),...r.counts.map(c=>`${c.value} ${c.unit}${c.scope?' ('+c.scope+')':''}`),...(r.refs.length?['Ref: '+r.refs.slice(0,12).join(', ')+(r.refs.length>12?' …':'')]:[])]
      return '- '+r.tool+': '+status+(details.length?' · '+details.join(' · '):'')
    })
    return [labels.heading,...reasons,...(!this.receipts.length&&this.discovery.size?[labels.discovery??'Only discovery was checked. No content read was verified.']:[]),...(this.otherWrite&&labels.staged?[labels.staged]:[]),rows.join('\n'),labels.next??'Check the affected claim and continue with one bounded source or feature. Successful reads do not establish completion of the entire task.'].filter(Boolean).join('\n\n')
  }
}

/** Exact postcondition check only; never convert an accepted write into proof of broader task completion. */
export function checkAtlasReadback(call: Call, receipt: AtlasReceipt, raw: unknown): AtlasReceipt['verification'] {
  if (atlasReceipt('atlas_get', raw).outcome !== 'ok') return 'unavailable'
  const read=atlasData(raw), item=read?.item
  if (!object(item)||!receipt.refs.includes(item.ref)) return 'unavailable'
  const checks: boolean[]=[]
  for (const [key,value] of Object.entries(call.arguments)) {
    if (key==='title'&&typeof value==='string') checks.push(item.title===value)
    if ((key==='body'||key==='replaceBody')&&typeof value==='string') checks.push(item.body===value)
    if (key==='appendBody'&&typeof value==='string') checks.push(typeof item.body==='string'&&item.body.endsWith(value))
    if (key==='fields'&&object(value)) for (const [field,expected] of Object.entries(value)) if (expected!=='now') checks.push(JSON.stringify(item.fields?.[field])===JSON.stringify(expected))
  }
  return !checks.length?'not_checked':checks.every(Boolean)?'read_back_matches':'read_back_differs'
}
