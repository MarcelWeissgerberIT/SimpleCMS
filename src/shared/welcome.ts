/** Private invitation preparation. These records are never workspace content or model context. */
export interface WelcomeRecipient {
  id: string; name: string; email: string; workspaceId: string
  role: 'member' | 'viewer'; guest: boolean; note: string
  status: 'draft' | 'sending' | 'sent' | 'uncertain'
  hasAtlasLink: boolean; hasAtlasToken: boolean; atlasHost: string | null
  /** Presence only, never the URL credential. Absent on older servers. */
  hasAtlasLinkToken?: boolean
  sentAt?: number
}
export interface WelcomeDraft {
  revision: number; title: string; notBefore: number; lang: 'de' | 'en'
  recipients: WelcomeRecipient[]
}
export interface WelcomePatch extends Omit<WelcomeDraft, 'recipients'> {
  recipients: Array<WelcomeRecipient & { atlasLink?: string; atlasToken?: string }>
}
/** Extract a URL credential for explicit personal display/copy, never as a verified MCP token. */
export function atlasLinkToken(link: string): string | null {
  try {
    if (link.length > 4096) return null
    const url = new URL(link)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const hash = url.hash.slice(1)
    const fragment = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash)
    const values = [url.searchParams, fragment].flatMap(params => ['token', 'invite_token', 'access_token'].flatMap(key => params.getAll(key)))
    const tokens = [...new Set(values.map(v => v.trim()).filter(Boolean))]
    return tokens.length === 1 && !/\s/.test(tokens[0]!) ? tokens[0]! : null
  } catch {
    return null
  }
}
const normalized = (s: string) => s.toLocaleLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9@]+/g,' ').trim()
const tokenLabel = '(?:(?:atlas|mcp|agent(?:en)?)[-_ ]*)?token|api[-_ ]?key|authorization'
const tokenField = new RegExp(`(?:^|[\\s|;,])(?:\\*\\*)?(${tokenLabel})(?:\\*\\*)?\\s*[:=]\\s*`, 'gi')
const tokenHeader = new RegExp(`^(?:[-*]\\s+)?(?:\\*\\*)?(${tokenLabel})(?:\\*\\*)?\\s*[:=]\\s*$`, 'i')
/** Bearer credentials only: never interpret URL parameters or arbitrary prose as a token. */
function credential(value: string): string | null {
  const raw=value.trim().replace(/^Bearer\s+/i,'').replace(/^(["'`])(.+)\1$/,'$2')
  return raw.length<=4096 && /^[A-Za-z0-9._~+\/-]+=*$/.test(raw)?raw:null
}
/** Deterministic local parser. No AI or network; unmatched/duplicate blocks abort the entire import. */
export function parseWelcomePaste(text: string, recipients: Pick<WelcomeRecipient,'id'|'name'|'email'>[]): { updates: Array<{id:string;atlasLink?:string;atlasToken?:string}>; issues: string[] } {
  if (text.length > 200000) return {updates:[],issues:['too_large']}
  const updates = new Map<string,{id:string;atlasLink?:string;atlasToken?:string}>(), issues: string[] = []
  let current: string | null = null
  let pending: {line:number;authorization:boolean} | null = null
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line=raw.trim(); if (!line) continue
    // Strip URLs before looking for labels: ?token= is an invitation value, not a credential.
    const withoutUrls=line.replace(/https:\/\/[^\s<>"|]+/g,'').replace(/\*\*/g,'')
    const fields=[...withoutUrls.matchAll(tokenField)]
    const identity=normalized(fields.length?withoutUrls.slice(0,fields[0]!.index):withoutUrls)
    const matches=recipients.filter(r=>[normalized(r.name),normalized(r.email)].some(n=>n && (` ${identity} `).includes(` ${n} `)))
    if(pending){
      const token=!matches.length && (!pending.authorization || /^Bearer\s+/i.test(line))?credential(line):null
      if(token && current){
        const item=updates.get(current)??{id:current}
        if(item.atlasToken && item.atlasToken!==token)issues.push(String(index+1))
        item.atlasToken=token;updates.set(current,item);pending=null;continue
      }
      issues.push(String(pending.line));pending=null;current=null
    }
    if(matches.length>1){issues.push(String(index+1));current=null;continue}
    if(matches.length===1) current=matches[0]!.id
    const urls=line.match(/https:\/\/[^\s<>"|]+/g) ?? []
    const header=tokenHeader.exec(withoutUrls.trim())
    if(header && current && !urls.length){pending={line:index+1,authorization:header[1]!.toLowerCase()==='authorization'};continue}
    const tokens=fields.map((f,i)=>{
      const value=withoutUrls.slice(f.index!+f[0].length,fields[i+1]?.index).split(/[|;,]/,1)[0]!.trim()
      return f[1]!.toLowerCase()==='authorization'&&!/^Bearer\s+/i.test(value)?null:credential(value)
    })
    if(tokens.some(t=>t===null) || new Set(tokens).size>1){issues.push(String(index+1));continue}
    const token=tokens[0]
    if(urls.length || token){
      if(!current || urls.length>1){issues.push(String(index+1));continue}
      const item=updates.get(current)??{id:current}
      if(urls.length){if(item.atlasLink && item.atlasLink!==urls[0])issues.push(String(index+1));item.atlasLink=urls[0]}
      if(token){if(item.atlasToken && item.atlasToken!==token)issues.push(String(index+1));item.atlasToken=token}
      updates.set(current,item)
    }else if(!matches.length){issues.push(String(index+1));current=null}
  }
  if(pending)issues.push(String(pending.line))
  return {updates:issues.length?[]:[...updates.values()],issues}
}
