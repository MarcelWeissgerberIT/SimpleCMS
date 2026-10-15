/**
 * The engines' rules on what a write can start (plan §1.3) — pure, shared by the rack (model.ts draws net flags only
 * where a listener can start) and the chain analysis (chains.ts walks the flow with the very same rules, §2.5):
 *  - automations fire only in the tab where the write happens, never on a remote write, never while paused: a server
 *    agent's write (remote in every tab) starts no automation and no autofill, only a kit value relay (recompute has no
 *    remote check, §6 A12); a team hook's write (on the server) starts no automation and no autofill;
 *  - `set_property` never starts automations (applyingAction); a script inside a `run_script` action runs with
 *    automations paused;
 *  - agents never start agents directly (both runners skip `agent:` writers) — through an automation they do;
 *  - autofill never starts autofill (its own fields are out of `rowHash`), and listens to its row's inputs;
 *  - a field "only by hand" (`agentReadOnly`) is never written by an agent or the MCP bridge (enforced in the agent's
 *    and the bridge's tools, §1.18) — every other writer ignores the flag (autofill, automations, kit, scripts).
 */
import type { FlowListen, ModuleKey, Place } from './types'

/** Who writes — the kind of writer decides what its write can start. */
export type WriterKind =
  | 'agent'
  | 'serverAgent'
  | 'automation'
  | 'autoScript'
  | 'script'
  | 'autofill'
  | 'organise'
  | 'kit'
  | 'bridge'
  | 'clock'
  | 'button'
  | 'command'
  | 'incoming'
  | 'sync'
  | 'clippings'

/** A place's key in the flow: `<db>:<prop | * | +row | -row>` · `page:<id>` · `inbox` · `everything` · `ext:<what>`. */
export function placeKey(p: Place): string {
  if ('db' in p) return `${p.db}:${p.prop ?? '*'}`
  if ('page' in p) return `page:${p.page}`
  if ('inbox' in p) return 'inbox'
  if ('everything' in p) return 'everything'
  return `ext:${p.external}`
}

/** Does this writer honour "only by hand" fields (§1.18)? Agents (browser and server) and the MCP bridge. */
export const honoursHandOnly = (kind: WriterKind): boolean => kind === 'agent' || kind === 'serverAgent' || kind === 'bridge'

/** Can a write by `w` start listener `l`? */
export function startable(w: { kind: WriterKind; key: ModuleKey }, l: FlowListen): boolean {
  if (l.module === w.key) return false
  switch (w.kind) {
    case 'agent':
      return l.kind !== 'agent'
    case 'serverAgent':
      // remote in every tab: no automation, no autofill, no agent (the runners skip agent writers) — kit relays only
      return l.kind === 'kit'
    case 'automation':
    case 'autoScript':
      return l.kind !== 'automation'
    case 'autofill':
      return l.kind !== 'autofill'
    case 'incoming':
      // written on the server: automations and autofill never run after a remote write
      return l.kind !== 'automation' && l.kind !== 'autofill'
    default:
      return true
  }
}

/** Does a write to `wp` reach a listener of `lp` (same database)? `autofillProps`: the database's auto autofill fields. */
export function reaches(wp: string, lp: string, l: FlowListen, autofillProps: ReadonlySet<string>): boolean {
  if (l.kind === 'autofill' && autofillProps.has(wp)) return false // autofill's own fields never start it (rowHash)
  if (wp === '+row') return lp === '+row' || (lp === '*' && (l.kind === 'autofill' || l.kind === 'kit'))
  if (wp === '-row') return lp === '-row'
  if (lp === '+row' || lp === '-row') return false
  if (wp === '*') return true
  return lp === wp || lp === '*'
}
