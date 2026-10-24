/** Minimal device observations. Never a credential, source excerpt or arbitrary URL. */
export type ReadinessObservation = ({ signal:'atlas'; project:string; record:number } | { signal:'copilot'|'repo'|'worker' }) & {version?:string}
export interface ReadinessEvidence { at:number; source:'session'|'relay'|'device-mcp'|'device-worker'; project?:string; record?:number; version?:string; online?:boolean }
export function atlasReadProof(tool:string, content:unknown):{project:string;record:number}|null {
  if(tool!=='atlas_get')return null
  const decode=(v:unknown):any=>{
    if(typeof v==='string'){if(v.length>200000)return null;try{return JSON.parse(v)}catch{return null}}
    return v
  }
  let v=decode(content)
  if(Array.isArray(v))v=decode(v.filter(b=>b?.type==='text').map(b=>b.text).join(''))
  if(v?.isError||v?.is_error||v?.error)return null
  if(v?.content){v=decode(v.content);if(Array.isArray(v))v=decode(v.filter(b=>b?.type==='text').map(b=>b.text).join(''))}
  if(v?.isError||v?.is_error||v?.error)return null
  const item=v?.item, record=Number(item?.ref)
  return item&&typeof item.project==='string'&&/^[a-z0-9_-]{1,100}$/.test(item.project)&&Number.isSafeInteger(record)&&record>0?{project:item.project,record}:null
}

export interface ReadinessConfig {
  /** Account-bound status observations; recipient is an opaque welcome-draft id, never an email/token. */
  automation?: { recipient: string; evidence: string; atlasProjects: string[] }
  v: 1
  checks: Record<'one' | 'atlas' | 'worker' | 'copilot' | 'repo', string>
  role: string
  participation: string
  blocker: string
  next: string
  owner: string
  note: string
  changedAt: string
  changedBy: string
}

export interface ReadinessDatabase {readiness?:ReadinessConfig;properties:Array<{id:string;type:string;options?:Array<{id:string}>}>}
export const CHECKS = ['one', 'atlas', 'worker', 'copilot', 'repo'] as const
export type Check = typeof CHECKS[number]
export type CheckState = 'open' | 'ready' | 'blocked' | 'na'
export type Overall = 'open' | 'ready' | 'blocked' | 'later'
export function readReadiness(db: ReadinessDatabase): ReadinessConfig | null {
  const c = db.readiness
  if (!c || c.v !== 1 || !c.checks) return null
  const type = (id: string | undefined, expected: string) => !!id && db.properties.some(p => p.id === id && p.type === expected)
  if (!CHECKS.every(k => type(c.checks[k], 'select') && ['open','ready','blocked','na'].every(value => db.properties.find(p => p.id === c.checks[k])?.options?.some(o => o.id === value)))) return null
  if (![c.role, c.participation].every(id => type(id, 'select'))) return null
  const a=c.automation
  if (![c.blocker, c.next, c.owner, c.note, c.changedAt, c.changedBy].every(id => type(id, 'text'))) return null
  if(a&&(!type(a.recipient,'text')||!type(a.evidence,'text')||!Array.isArray(a.atlasProjects)||!a.atlasProjects.length||a.atlasProjects.length>10||!a.atlasProjects.every(p=>typeof p==='string'&&/^[a-z0-9_-]{1,100}$/.test(p))))return null
  const ids = [...CHECKS.map(k => c.checks[k]), c.role, c.participation, c.blocker, c.next, c.owner, c.note, c.changedAt, c.changedBy, ...(a?[a.recipient,a.evidence]:[])]
  return new Set(ids).size === ids.length ? c : null
}
export function participant(row: {properties:Record<string,unknown>}, c: ReadinessConfig) {
  const guest = row.properties[c.role] === 'guest'
  const later = row.properties[c.participation] === 'later'
  const required: readonly Check[] = guest ? ['one', 'atlas'] : CHECKS
  const states = Object.fromEntries(CHECKS.map(k => {
    const v = row.properties[c.checks[k]]
    // A required check cannot turn green by choosing "not needed" or an unknown value.
    return [k, later || !required.includes(k) ? 'na' : v === 'ready' || v === 'blocked' ? v : 'open']
  })) as Record<Check, CheckState>
  const done = required.filter(k => states[k] === 'ready').length
  const overall: Overall = later ? 'later' : required.some(k => states[k] === 'blocked') ? 'blocked' : done === required.length ? 'ready' : 'open'
  return { guest, later, required, states, done, total: required.length, overall }
}

/** A past setup proof and a current connection are separate facts. No silent deletion of prior checks. */
export function workerConnection(e:unknown,now=Date.now()):'online'|'offline'|'stale'|'unknown'{
 if(!e||typeof e!=='object')return 'unknown'
 const v=e as ReadinessEvidence
 if(!Number.isSafeInteger(v.at)||!['relay','device-worker'].includes(v.source)||typeof v.online!=='boolean')return 'unknown'
 if(v.at>now+5000||now-v.at>90000)return 'stale'
 return v.online?'online':'offline'
}
