/**
 * Integration profiles on the team server (the app's twin: src/app/store/integrations.ts; docs/CLOUD.md § Meta
 * document schema → integrations, § Agents → Integration profiles). Profiles are workspace data in the shared meta
 * document's `integrations` map (owners and admins write it — collab/admin-map.ts puts other members' changes back).
 *
 * The server reads only what it needs — `id`, `match.name`, `match.host`, `unlocks` — with its own sanitizer: a value
 * that is no profile is ignored. Matching: the runtime's MCP servers have no tested tool lists here, so only `name` /
 * `host` count (globs with `*` and `?`, case-insensitive, the whole text); a profile without either never matches on
 * the server. A matching profile unlocks its features for every server agent of the workspace:
 *  - 'upsert'     → the tool upsert_rows
 *  - 'agentState' → agent_state_get / agent_state_set
 * (keys / "Only by hand" on properties and an agent's tool allow-list are always ENFORCED — nothing here loosens them;
 * 'notify' has no server side: the inbox is per device.)
 */
import * as Y from 'yjs'

export type IntegrationFeature = 'keys' | 'onlyByHand' | 'upsert' | 'toolAllowList' | 'agentState' | 'notify'
export const INTEGRATION_FEATURES: readonly IntegrationFeature[] = ['keys', 'onlyByHand', 'upsert', 'toolAllowList', 'agentState', 'notify']

export interface ServerProfile {
  id: string
  name?: string
  host?: string
  unlocks: IntegrationFeature[]
}

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const NAME_GLOB = /^[A-Za-z0-9_*?-]{1,100}$/
const HOST_GLOB = /^[A-Za-z0-9.*?-]{1,100}$/
const MAX_PROFILES = 50

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)

/** The part of a profile the server uses, or null when it is none (the app's sanitizer drops the same ones). */
export function sanitizeProfile(key: string, raw: unknown): ServerProfile | null {
  if (!isObj(raw) || own(raw, 'schema') !== 'one.integration/1') return null
  const id = own(raw, 'id')
  if (typeof id !== 'string' || !PROFILE_ID.test(id) || id !== key) return null
  // a profile without a name is none for the app either
  const title = own(raw, 'name')
  if (typeof title !== 'string' || !title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()) return null
  const match = own(raw, 'match')
  if (!isObj(match)) return null
  const glob = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v.trim()) && v.replace(/[*?]/g, '').trim() ? v.trim().toLowerCase() : undefined)
  const name = glob(own(match, 'name'), NAME_GLOB)
  const host = glob(own(match, 'host'), HOST_GLOB)
  const raws = own(raw, 'unlocks')
  const unlocks = Array.isArray(raws) ? INTEGRATION_FEATURES.filter((f) => raws.includes(f)) : []
  return { id, ...(name ? { name } : {}), ...(host ? { host } : {}), unlocks }
}

/**
 * Every usable profile of a meta document (the shared one): at most MAX_PROFILES, the first valid ones by id — the
 * same ones the app's binding keeps (src/app/cloud/binding.ts readIntegrations), whatever order the map holds them in.
 */
export function readProfiles(doc: Y.Doc): ServerProfile[] {
  const out: ServerProfile[] = []
  const map = doc.getMap<unknown>('integrations')
  const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  for (const key of keys) {
    if (out.length >= MAX_PROFILES) break
    const raw = map.get(key)
    try {
      const p = sanitizeProfile(key, raw)
      if (p) out.push(p)
    } catch {
      /* a broken entry is ignored */
    }
  }
  return out
}

/** `*` = any characters, `?` = one; case-insensitive, the whole text (no RegExp built from input). */
export function globMatch(glob: string, text: string): boolean {
  const g = glob.toLowerCase()
  const s = text.toLowerCase()
  let gi = 0
  let si = 0
  let star = -1
  let mark = 0
  while (si < s.length) {
    if (gi < g.length && (g[gi] === '?' || g[gi] === s[si])) {
      gi++
      si++
    } else if (gi < g.length && g[gi] === '*') {
      star = gi++
      mark = si
    } else if (star >= 0) {
      gi = star + 1
      si = ++mark
    } else return false
  }
  while (gi < g.length && g[gi] === '*') gi++
  return gi === g.length
}

const hostOf = (url: string): string => {
  try {
    return new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** The runtime server a profile matches by name / host (null: none, or no name / host condition). */
export function profileMatch(p: ServerProfile, servers: ReadonlyArray<{ name: string; url: string }>): string | null {
  if (!p.name && !p.host) return null
  for (const s of servers) {
    if (p.name && !globMatch(p.name, s.name)) continue
    if (p.host && !globMatch(p.host, hostOf(s.url))) continue
    return s.name
  }
  return null
}

/** The features the workspace's profiles unlock for its server agents. */
export function serverUnlocks(profiles: ServerProfile[], servers: ReadonlyArray<{ name: string; url: string }>): Set<IntegrationFeature> {
  const out = new Set<IntegrationFeature>()
  for (const p of profiles) if (profileMatch(p, servers)) for (const f of p.unlocks) out.add(f)
  return out
}
