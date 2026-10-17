/**
 * Module keys — THE one spelling of a module's identity (plan §2.2: `${kind}:${ids…}`, stable, ids only). Every track
 * builds keys here: the model (B2), the layout's stable order (B5), `#/patchbay?m=` links (Workspace › Automation's
 * "Show in the patchbay", B6), the live signal (B13), patching (B15). Pure.
 *
 * Each part is percent-encoded beyond [A-Za-z0-9_.~-] and the parts are joined with ':' — a key never holds a raw ':'
 * inside a part, so it splits back unambiguously and passes the router's check.
 */
import type { AgentTrigger, ID } from '../../store/types'
import type { ModuleKey, ModuleRef } from './types'

/** A key part: everything outside [A-Za-z0-9_.~-] percent-encoded (UTF-8). */
export function keyPart(v: string): string {
  return encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const join = (kind: string, ...parts: Array<string | null | undefined>): ModuleKey => [kind, ...parts.map((p) => (p == null || p === '' ? '-' : keyPart(p)))].join(':')

/** A schedule trigger's canonical key (every · at · weekday · day · tz): agents with the same schedule share one clock. */
export function scheduleKey(t: Extract<AgentTrigger, { type: 'schedule' }>): string {
  const at = t.every === 'hour' ? t.at.slice(-2) : t.at
  const weekday = t.every === 'week' ? String(t.weekday ?? 0) : ''
  const day = t.every === 'month' ? String(t.day ?? 1) : ''
  return [t.every, at, weekday, day, t.tz].join('|')
}

/** The module key of a ref. */
export function moduleKey(ref: ModuleRef): ModuleKey {
  switch (ref.kind) {
    case 'server':
      return ref.runtime || !ref.id ? join('server', 'rt', ref.name) : join('server', ref.id)
    case 'clock':
      return ref.template ? join('clock', 't', ref.template.db, ref.template.id) : join('clock', 's', ref.schedule)
    case 'rowTrigger':
      return join('rowTrigger', ref.db, ref.event, ref.prop)
    case 'button':
      return join('button', ref.page, ref.block)
    case 'command':
      return join('command', ref.db, ref.command)
    case 'incoming':
      return join('incoming', ref.hook, ref.agent, ref.db)
    case 'sync':
      return join('sync', ref.source)
    case 'clippings':
      return join('clippings', ref.inbox)
    case 'agent':
      return join('agent', ref.id)
    case 'automation':
      return join('automation', ref.db, ref.id)
    case 'script':
      return join('script', ref.id)
    case 'autofill':
      return join('autofill', ref.db, ref.prop)
    case 'organise':
      return join('organise', ref.db)
    case 'pipeline':
      return join('pipeline', ref.db)
    case 'bridge':
      return join('bridge', 'here')
    case 'planner':
      return join('planner', ref.db)
    case 'kit':
      return join('kit', ref.db, ref.prop)
    case 'database':
      return join('database', ref.id)
    case 'page':
      return join('page', ref.id)
    case 'inbox':
      return join('inbox', 'notes')
    case 'everything':
      return join('everything', 'all')
    case 'outbound':
      return join('outbound', ref.exit, ref.host, ref.method)
    case 'outbox':
      return join('outbox', ref.profile, ref.route)
  }
}

/** The keys of what Workspace › Automation lists (its "Show in the patchbay" links, B6) — the same keys the model builds. */
export const inventoryKeys = {
  agent: (id: ID): ModuleKey => moduleKey({ kind: 'agent', id }),
  script: (id: ID): ModuleKey => moduleKey({ kind: 'script', id }),
  automation: (db: ID, id: ID): ModuleKey => moduleKey({ kind: 'automation', db, id }),
  command: (db: ID, command: string): ModuleKey => moduleKey({ kind: 'command', db, command }),
  /**
   * An own command's key only when the rack draws it (as model.ts `commands()` builds them): an agent command whose
   * agent exists, a script command whose script exists, an actions command with an action that runs a script, sends
   * or adds a row. A view command, or one whose agent / script is gone, runs nothing by itself: null — no link.
   */
  wiredCommand: (db: ID, cmd: { id: string; kind: string; config?: Record<string, unknown> }, has: { agent: (id: string) => boolean; script: (id: string) => boolean }): ModuleKey | null => {
    const cfg = cmd.config ?? {}
    const wired =
      (cmd.kind === 'agent' && typeof cfg.agentId === 'string' && has.agent(cfg.agentId)) ||
      (cmd.kind === 'script' && typeof cfg.scriptId === 'string' && has.script(cfg.scriptId)) ||
      (cmd.kind === 'actions' && Array.isArray(cfg.actions) && cfg.actions.some((a) => !!a && typeof a === 'object' && ['run_script', 'webhook', 'add_page'].includes((a as { type?: unknown }).type as string)))
    return wired ? moduleKey({ kind: 'command', db, command: cmd.id }) : null
  },
  repeating: (db: ID, template: ID): ModuleKey => moduleKey({ kind: 'clock', schedule: '', agents: [], template: { db, id: template } }),
}

/** The kind of a module key (null: not one). */
export function kindOfKey(key: string): ModuleRef['kind'] | null {
  const m = /^([a-z][a-zA-Z]{1,15}):/.exec(key)
  return m ? (m[1] as ModuleRef['kind']) : null
}
