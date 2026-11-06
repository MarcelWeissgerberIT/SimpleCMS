/** Explicit destinations and conservative, local-only hints. No inferred classification ever changes a rule. */
import type { ProviderId, Restriction, SourceRef } from './types.ts'
import { SHARED_PREFIX } from './shared-model.ts'
import { STORED_PROVIDERS } from './models.ts'
export interface DataFlowRules {
  /** Missing = existing provider rules. [] = no model destination. */
  providers?: ProviderId[]
  /** Exact origins, never tokens, paths or wildcard patterns. Missing = existing MCP setup. */
  mcpOrigins?: string[]
  hints?: 'quiet' | 'off'
}
export function originOf(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  try { const u = new URL(raw); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.origin : null } catch { return null }
}
export function readDataFlow(v: unknown): DataFlowRules | undefined {
  if (v === undefined) return undefined
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { providers: [], mcpOrigins: [] }
  const x = v as Record<string, unknown>, out: DataFlowRules = {}
  if (Object.hasOwn(x, 'providers')) out.providers = Array.isArray(x.providers) ? [...new Set(x.providers.filter((p): p is ProviderId => STORED_PROVIDERS.includes(p as ProviderId)))] : []
  if (Object.hasOwn(x, 'mcpOrigins')) out.mcpOrigins = Array.isArray(x.mcpOrigins) ? [...new Set(x.mcpOrigins.map(originOf).filter((s): s is string => !!s))].slice(0, 64) : []
  if (x.hints === 'quiet' || x.hints === 'off') out.hints = x.hints
  return Object.keys(out).length ? out : undefined
}
export const modelDestinationAllowed = (p: ProviderId, flow?: DataFlowRules | null): boolean => !flow?.providers || flow.providers.includes(p)
export const mcpDestinationAllowed = (url: string, flow?: DataFlowRules | null): boolean => !flow?.mcpOrigins || flow.mcpOrigins.includes(originOf(url) ?? '')
export const hasFlowLimits = (flow?: DataFlowRules | null): boolean => flow?.providers !== undefined || flow?.mcpOrigins !== undefined
export const codingProvider = (agent: string): ProviderId | null => agent === 'claude' ? 'anthropic' : STORED_PROVIDERS.includes(agent as ProviderId) ? agent as ProviderId : null
export interface FlowPage { parentId?: string | null; content?: unknown }
export interface FlowWorld { pages: Record<string, FlowPage> }
function copies(content: unknown): string[] {
  const out: string[] = []; let nodes = 0
  const walk = (n: any, depth: number) => { if (!n || depth > 64 || ++nodes > 20000) return; if (n.type === 'syncedBlock' && typeof n.attrs?.sourcePageId === 'string') out.push(n.attrs.sourcePageId); if (Array.isArray(n.content)) for (const c of n.content) walk(c, depth + 1) }
  walk(content, 0); return out
}
/** Ancestor rules intersect. A child cannot reopen a parent. Synced copies keep their source boundary. */
export function pageDestinationAllowed(p: ProviderId, id: string, w: FlowWorld, restrictions: readonly Restriction[] = []): boolean {
  if (!restrictions.length) return true
  const seen = new Set<string>(), pending = [id]
  while (pending.length) {
    const next = pending.pop()!; if (seen.has(next)) continue
    if (seen.size >= 512) return false
    seen.add(next)
    let cur: string | null = next; const ancestors = new Set<string>()
    while (cur) {
      if (ancestors.has(cur) || ancestors.size >= 256) return false
      ancestors.add(cur)
      if (restrictions.some(r => r.root === cur && !r.to.includes(p))) return false
      const page: FlowPage | undefined = w.pages[cur]
      if (!page) return false
      if (cur === next) for (const copy of copies(page.content)) pending.push(copy)
      cur = page.parentId ?? null
    }
  }
  return true
}
export function sourceDestinationsAllowed(p: ProviderId, sources: readonly SourceRef[], w: FlowWorld, restrictions: readonly Restriction[] = []): boolean {
  return sources.every(s => 'page' in s ? pageDestinationAllowed(p, s.page, w, restrictions) : 'row' in s ? pageDestinationAllowed(p, s.row, w, restrictions) : 'db' in s ? pageDestinationAllowed(p, s.db, w, restrictions) : true)
}
export function providersForSources(flow: DataFlowRules | undefined, sources: readonly SourceRef[], w: FlowWorld, restrictions: readonly Restriction[]): ProviderId[] {
  return STORED_PROVIDERS.filter(p => modelDestinationAllowed(p, flow) && sourceDestinationsAllowed(p, sources, w, restrictions))
}
export type SensitiveHint = 'confidential' | 'internal-protocol' | 'personal'
/** Local, bounded heuristic. Categories only: no quotations, matched names or content persisted. */
export function sensitiveHints(text: string): SensitiveHint[] {
  const s = text.slice(0, 100000), out: SensitiveHint[] = []
  if (/\b(vertraulich|confidential|streng geheim|trade secret|betriebsgeheimnis|nur für den internen gebrauch|internal use only)\b/i.test(s)) out.push('confidential')
  if (/(?:propriet[aä]r|intern(?:al|e[nsrm]?)?).{0,65}(?:wire protocol|protokoll(?:aufbau|format|struktur)|register(?:map|belegung)|firmware|sicherheitslücke|vulnerability)/is.test(s)) out.push('internal-protocol')
  if (/\b(?:patient(?:en)?(?:name|nummer|daten)|personalnummer|sozialversicherungsnummer|social security number)\s*[:=]\s*\S+/i.test(s)) out.push('personal')
  return out
}
export function inferencePlace(p: ProviderId, model = ''): 'local-worker' | 'shared-local' | 'cloud' {
  return p === 'local' ? model.startsWith(SHARED_PREFIX) ? 'shared-local' : 'local-worker' : 'cloud'
}
