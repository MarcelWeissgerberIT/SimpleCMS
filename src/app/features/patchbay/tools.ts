/**
 * Server tool groups (plan §1.5) — pure. Per server, in this order:
 *  - OUT    = the send tools of every profile matching it by name / host (`ServerInput.out`, outToolsOf): switched off in
 *             every toolset One builds — never a decider's way out, a third jack "OUT n · BY HAND" with no cable;
 *  - READ   = tools the name heuristic calls a read (agents/mcpTools isReadTool), plus the declared `reads` of the
 *             profiles that describe this server whose names carry NO write word (§6 A4), minus OUT;
 *  - WRITE? = everything else. A write-named tool a profile declares a read stays here, marked "declared read by <id>"
 *             — still a way out.
 * The "?" shows only where the heuristic placed a tool. A server never tested here has no list: "READ ? · WRITE ?",
 * and a processor that attaches it without an allow-list counts it as a way out (fail closed, §1.3 / §6 A7).
 * READ tools whose names say fetch / url / http / web / browse / search may carry data out in their arguments: they
 * never light a fuse, the plate names them as "still connected" (residual risk, §1.5 / §6 A33).
 *
 * mcpTools.ts is imported directly (a dependency-free leaf of the agents area, like agents/saveChecks.ts): the agents
 * index loads the store, the cloud and CSS, and this module runs in Node specs.
 */
import { isReadTool, isWriteNamed, toolWords } from '../agents/mcpTools'
import { hostOf, matchMiss, outToolsOf } from '../../store/integrations'
import type { IntegrationProfile } from '../../store/types'
import type { ModelInput, ModuleRef } from './types'

/** Words of a READ tool's name that may carry data out through its arguments (§1.5). */
const LEAKY = new Set(['fetch', 'url', 'http', 'web', 'browse', 'search'])

export interface ToolGroups {
  /** the tool list is known (a connection test on this device) */
  tested: boolean
  read: string[]
  write: string[]
  out: string[]
  /** write-named tools a profile declared as read → the declaring profile ids (they stay WRITE?) */
  declared: Record<string, string[]>
  /** a READ tool placed by the name heuristic alone (not declared by a profile) — the READ jack's "?" */
  guessedRead: boolean
  /** a WRITE? tool placed by the heuristic ("what does not look like a read") — the WRITE? jack's "?" */
  guessedWrite: boolean
  /** READ tools that may carry data out (fetch / url / http / web / browse / search) */
  residual: string[]
}

/** What a profile declares for a server: its id and its `reads`. */
export interface DeclaredReads {
  id: string
  reads: readonly string[]
}

/** May this READ tool carry data out in its arguments? */
export const isLeaky = (name: string): boolean => toolWords(name).some((w) => LEAKY.has(w))

/**
 * The profiles that describe a server: their match would hold for it if it were switched on (a profile's `reads` and
 * `outTools` speak about that server's tools, whatever its switch says). Profiles without `reads` say nothing.
 */
export function declaringProfiles(profiles: readonly IntegrationProfile[], server: { name: string; url: string; tools?: string[] }): DeclaredReads[] {
  const out: DeclaredReads[] = []
  for (const p of profiles) {
    if (!p.reads?.length) continue
    const m = p.match
    if (!m || (!m.name && !m.host && !m.tools?.length)) continue
    if (matchMiss(m, { name: server.name, url: server.url, enabled: true, tools: server.tools })) continue
    out.push({ id: p.id, reads: p.reads })
  }
  return out
}

/** The class one tool name falls in, with the reason (declared or guessed). */
function classify(name: string, out: ReadonlySet<string>, declared: ReadonlyMap<string, string[]>): { group: 'read' | 'write' | 'out'; guessed: boolean; declaredBy?: string[] } {
  if (out.has(name)) return { group: 'out', guessed: false }
  const by = declared.get(name)
  if (by && !isWriteNamed(name)) return { group: 'read', guessed: false }
  if (by) return { group: 'write', guessed: true, declaredBy: by }
  return isReadTool(name) ? { group: 'read', guessed: true } : { group: 'write', guessed: true }
}

const declaredMap = (profiles: readonly DeclaredReads[]): Map<string, string[]> => {
  const m = new Map<string, string[]>()
  for (const p of profiles)
    for (const t of p.reads) {
      const list = m.get(t) ?? []
      if (!list.includes(p.id)) list.push(p.id)
      m.set(t, list)
    }
  return m
}

/** A server's tool groups: `tools` from its last connection test (null / empty = never tested here), `out` its OUT tools. */
export function toolGroups(tools: readonly string[] | null | undefined, out: readonly string[], profiles: readonly DeclaredReads[] = []): ToolGroups {
  const outSet = new Set(out)
  const declared = declaredMap(profiles)
  const g: ToolGroups = { tested: !!tools?.length, read: [], write: [], out: [...outSet], declared: {}, guessedRead: false, guessedWrite: false, residual: [] }
  if (!tools?.length) return g
  for (const name of new Set(tools)) {
    const c = classify(name, outSet, declared)
    if (c.group === 'out') continue
    if (c.group === 'read') {
      g.read.push(name)
      if (c.guessed) g.guessedRead = true
      if (isLeaky(name)) g.residual.push(name)
    } else {
      g.write.push(name)
      g.guessedWrite = true
      if (c.declaredBy) g.declared[name] = c.declaredBy
    }
  }
  // OUT counts what is locked, listed or not (a tested list without the tool still has it locked)
  return g
}

/** What one processor gets from a server (its allow-list applied; OUT tools are always off). */
export interface ToolUse {
  /** the server is left out ([] allow-list, or nothing left after OUT) */
  leftOut: boolean
  /** READ tools it may call (null: unknown — never tested and no allow-list) */
  read: string[] | null
  /** WRITE? tools it may call (null: unknown) */
  write: string[] | null
  /** unknown tool list and no allow-list: every tool counts, a way out (fail closed) */
  failClosed: boolean
}

/**
 * The tools a processor may call on a server: `allow` = its allow-list for that server (undefined = every tool, the
 * toolset's behaviour; [] = the server is left out). An allow-list on an untested server is classed by name (+ the
 * declarations); only a list of read-classed names keeps the write cable away.
 */
export function toolUse(groups: ToolGroups, allow: readonly string[] | undefined, profiles: readonly DeclaredReads[] = []): ToolUse {
  if (allow && !allow.length) return { leftOut: true, read: [], write: [], failClosed: false }
  const outSet = new Set(groups.out)
  if (!allow) {
    if (!groups.tested) return { leftOut: false, read: null, write: null, failClosed: true }
    return { leftOut: !groups.read.length && !groups.write.length, read: [...groups.read], write: [...groups.write], failClosed: false }
  }
  const declared = declaredMap(profiles)
  const readSet = new Set(groups.read)
  const writeSet = new Set(groups.write)
  const read: string[] = []
  const write: string[] = []
  for (const name of new Set(allow)) {
    if (outSet.has(name)) continue
    if (readSet.has(name)) read.push(name)
    else if (writeSet.has(name)) write.push(name)
    else if (classify(name, outSet, declared).group === 'read') read.push(name)
    else write.push(name)
  }
  return { leftOut: !read.length && !write.length, read, write, failClosed: false }
}

/**
 * A runtime server's (the team server's agents) tools as this browser knows them: only from the server set up here at
 * the same host (the runtime names name + host only). A same-named server at another host is another server — its list
 * says nothing about this one (fix model: borrowing it would turn fail closed off, §6 A7) — null = not known here.
 */
export function runtimeTools(rt: { name: string; host: string | null }, local: ReadonlyArray<{ name: string; url: string; tools?: string[] }>): string[] | null {
  const own = rt.host ? local.find((s) => hostOf(s.url) === rt.host) : undefined
  return own?.tools?.length ? [...own.tools] : null
}

/**
 * A runtime server's OUT tools: the profiles matching ITS name and host (the team server's own matching,
 * server/src/agents/integrations.ts) — never those of a same-named server on this device at another host.
 */
export function runtimeOut(profiles: readonly IntegrationProfile[], rt: { name: string; host: string | null }): string[] {
  return outToolsOf([...profiles], { name: rt.name, url: rt.host ? `https://${rt.host}/` : '' })
}

/**
 * A server module's tool groups as the model drew them (B4: the fuses and the signature read them again) — this
 * device's server by id, or a runtime server by name (its tools from this device's server at the same host, its OUT
 * tools from the profiles matching its own name and host). `host` = the server's host, `declaredBy` = the profiles describing it with `reads`.
 */
export function serverToolGroups(input: ModelInput, ref: Extract<ModuleRef, { kind: 'server' }>): { groups: ToolGroups; host: string | null; declaredBy: string[]; profiles: DeclaredReads[] } {
  const profiles = input.profiles.map((p) => p.profile)
  if (!ref.runtime && ref.id) {
    const s = input.servers.find((x) => x.server.id === ref.id)
    if (s) {
      const declared = declaringProfiles(profiles, { name: s.server.name, url: s.server.url, tools: s.server.tools })
      return { groups: toolGroups(s.server.tools, s.out, declared), host: hostOf(s.server.url) || null, declaredBy: declared.map((d) => d.id), profiles: declared }
    }
  }
  const rt = Array.isArray(input.runtime) ? input.runtime : (input.lazy?.runtime ?? [])
  const host = rt.find((r) => r.name === ref.name)?.host ?? null
  const local = input.servers.map((s) => ({ name: s.server.name, url: s.server.url, tools: s.server.tools }))
  const tools = runtimeTools({ name: ref.name, host }, local)
  const url = host ? `https://${host}/` : ''
  const declared = declaringProfiles(profiles, { name: ref.name, url, tools: tools ?? undefined })
  return { groups: toolGroups(tools, runtimeOut(profiles, { name: ref.name, host }), declared), host, declaredBy: declared.map((d) => d.id), profiles: declared }
}
