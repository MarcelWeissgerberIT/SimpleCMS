/**
 * Database.commands — reading (sanitized), merging with the computed defaults, saving.
 *
 * The stored list holds own commands and, for defaults the person moved or switched off, an entry
 * { id: <default key>, kind: 'default', hidden? }. Defaults that apply but are not in the list (a new
 * agent, a first template) take their place after the default before them.
 */
import { useWorkspace } from '../../store/store'
import { COLOR_NAMES, type ColorName, type DbCommand, type ID, type PageIcon } from '../../store/types'
import { KIND_RE, kindLabel, kindOf } from './registry'
import type { CommandEntry, DefaultSpec } from './types'

export const COMMAND_LIMITS = { commands: 60, label: 60, config: 20_000 }

const ID_RE = /^[\w:.-]{1,80}$/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)

function sanitizeIcon(v: unknown): PageIcon | null {
  if (!isObj(v)) return null
  const type = own(v, 'type')
  const value = own(v, 'value')
  if (typeof value !== 'string' || !value || value.length > 64) return null
  if (type === 'emoji' || type === 'asset') return { type, value }
  if (type === 'lucide') {
    const color = own(v, 'color')
    return COLOR_NAMES.includes(color as ColorName) ? { type, value, color: color as ColorName } : { type, value }
  }
  return null
}

/** Plain JSON of at most COMMAND_LIMITS.config characters, or null. */
function plainConfig(v: unknown): Record<string, unknown> | null {
  if (!isObj(v)) return {}
  try {
    const json = JSON.stringify(v)
    if (json.length > COMMAND_LIMITS.config) return null
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

/** One stored command → a clean copy, or null when it is not one. Unknown kinds keep their JSON settings. */
export function sanitizeCommand(raw: unknown): DbCommand | null {
  if (!isObj(raw)) return null
  const id = own(raw, 'id')
  const kind = own(raw, 'kind')
  if (typeof id !== 'string' || !ID_RE.test(id) || typeof kind !== 'string') return null
  const hidden = own(raw, 'hidden') === true
  if (kind === 'default') return { id, kind, ...(hidden ? { hidden } : {}) }
  if (!KIND_RE.test(kind)) return null
  const rawLabel = own(raw, 'label')
  // eslint-disable-next-line no-control-regex
  const label = typeof rawLabel === 'string' ? rawLabel.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, COMMAND_LIMITS.label) : ''
  let config = plainConfig(own(raw, 'config'))
  if (!config) return null
  const def = kindOf(kind)
  if (def?.sanitize) {
    const clean = def.sanitize(config)
    if (!clean) return null
    config = clean as Record<string, unknown>
  }
  return { id, kind, ...(hidden ? { hidden } : {}), label, icon: sanitizeIcon(own(raw, 'icon')), config }
}

/** A database's stored commands, sanitized (unique ids, at most COMMAND_LIMITS.commands). */
export function readDbCommands(raw: unknown): DbCommand[] {
  if (!Array.isArray(raw)) return []
  const out: DbCommand[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (out.length >= COMMAND_LIMITS.commands) break
    const c = sanitizeCommand(x)
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

/** The label an own command shows: its own, else its kind's name. */
export function ownLabel(c: DbCommand): string {
  const def = kindOf(c.kind)
  return c.label?.trim() || (def ? kindLabel(def) : c.kind)
}

/**
 * The full list in menu order: the stored entries (defaults that don't apply now stay out — `keep`
 * returns them too, for saving) and the applicable defaults the list doesn't mention yet.
 */
export function mergeCommands(stored: DbCommand[], defaults: DefaultSpec[], opts: { keep?: boolean } = {}): Array<CommandEntry | { id: string; source: 'gone'; command: DbCommand }> {
  const specs = new Map(defaults.map((d) => [d.key, d]))
  const out: Array<CommandEntry | { id: string; source: 'gone'; command: DbCommand }> = []
  const placed = new Set<string>()
  for (const c of stored) {
    if (c.kind === 'default') {
      const spec = specs.get(c.id)
      if (spec) {
        out.push({ id: c.id, source: 'default', hidden: !!c.hidden, spec })
        placed.add(c.id)
      } else if (opts.keep) out.push({ id: c.id, source: 'gone', command: c })
      continue
    }
    out.push({ id: c.id, source: 'own', hidden: !!c.hidden, command: c, def: kindOf(c.kind), label: ownLabel(c), icon: c.icon ?? null })
  }
  // defaults not in the list: after the default before them in the default order (else first)
  defaults.forEach((spec, i) => {
    if (placed.has(spec.key)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((e) => e.id === defaults[j].key)
      if (k >= 0) {
        at = k + 1
        break
      }
    }
    out.splice(at, 0, { id: spec.key, source: 'default', hidden: false, spec })
    placed.add(spec.key)
  })
  return out
}

/** The entries of a database's menu (in order, hidden ones included — the caller filters). */
export function commandEntries(stored: DbCommand[], defaults: DefaultSpec[]): CommandEntry[] {
  return mergeCommands(stored, defaults).filter((e): e is CommandEntry => e.source !== 'gone')
}

/** Can the person change this database's commands? (not locked, not a viewer) */
export function canEditCommands(dbId: ID, readOnly: boolean): boolean {
  const db = useWorkspace.getState().databases[dbId]
  return !!db && !db.locked && !readOnly
}

/** Save a database's command list (the editor). Nothing is written for a locked database (false). */
export function saveDbCommands(dbId: ID, list: DbCommand[]): boolean {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db || db.locked) return false
  s.updateDatabase(dbId, { commands: readDbCommands(list) })
  return true
}
