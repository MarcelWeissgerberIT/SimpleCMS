/** Private invitation preparation. These records are never workspace content or model context. */
export interface WelcomeRecipient {
  id: string; name: string; email: string; workspaceId: string
  role: 'member' | 'viewer'; guest: boolean; note: string
  status: 'draft' | 'sending' | 'sent' | 'uncertain'
  hasAtlasLink: boolean; hasAtlasToken: boolean; atlasHost: string | null
  sentAt?: number
}
export interface WelcomeDraft {
  revision: number; title: string; notBefore: number; lang: 'de' | 'en'
  recipients: WelcomeRecipient[]
}
export interface WelcomePatch extends Omit<WelcomeDraft, 'recipients'> {
  recipients: Array<WelcomeRecipient & { atlasLink?: string; atlasToken?: string }>
}
const normalized = (s: string) => s.toLocaleLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9@]+/g,' ').trim()
/** Deterministic local parser. No AI or network; unmatched/duplicate blocks abort the entire import. */
export function parseWelcomePaste(text: string, recipients: Pick<WelcomeRecipient,'id'|'name'|'email'>[]): { updates: Array<{id:string;atlasLink?:string;atlasToken?:string}>; issues: string[] } {
  if (text.length > 200000) return {updates:[],issues:['too_large']}
  const updates = new Map<string,{id:string;atlasLink?:string;atlasToken?:string}>(), issues: string[] = []
  let current: string | null = null
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line=raw.trim(); if (!line) continue
    const identity=normalized(line.replace(/https:\/\/\S+/g,'').replace(/(?:token|key)\s*[:=].*$/i,''))
    const matches=recipients.filter(r=>[normalized(r.name),normalized(r.email)].some(n=>n && (` ${identity} `).includes(` ${n} `)))
    if(matches.length>1){issues.push(String(index+1));current=null;continue}
    if(matches.length===1) current=matches[0]!.id
    const urls=line.match(/https:\/\/[^\s<>"|]+/g) ?? []
    const token=/(?:atlas[-_ ]?token|token|api[-_ ]?key)\s*[:=]\s*([^\s|;,]+)/i.exec(line.replace(/https:\/\/[^\s<>"|]+/g,''))?.[1]
    if(urls.length || token){
      if(!current || urls.length>1){issues.push(String(index+1));continue}
      const item=updates.get(current)??{id:current}
      if(urls.length){if(item.atlasLink && item.atlasLink!==urls[0])issues.push(String(index+1));item.atlasLink=urls[0]}
      if(token){if(item.atlasToken && item.atlasToken!==token)issues.push(String(index+1));item.atlasToken=token}
      updates.set(current,item)
    }else if(!matches.length){issues.push(String(index+1));current=null}
  }
  return {updates:issues.length?[]:[...updates.values()],issues}
}
