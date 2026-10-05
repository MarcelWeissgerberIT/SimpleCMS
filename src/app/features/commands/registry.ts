/**
 * Kinds of own database commands: the built-ins (actions, agent, view — kinds/) and the ones other areas
 * add with registerCommandKind (e.g. features/script's "Run script"). A kind is code; a command stores only
 * its kind name and JSON settings, so a stored command of a kind this build doesn't know is kept untouched.
 */
import { create } from 'zustand'
import type { CommandKindDef } from './types'

export const KIND_RE = /^[a-z][a-z0-9-]{1,23}$/

/** The registered kinds (a store: the editor's "Add command" menu follows late registrations). */
export const useKinds = create<{ kinds: Record<string, CommandKindDef> }>(() => ({ kinds: {} }))

/**
 * Add a kind of own command (call once, at module load of the area that owns it). A second
 * registration of the same kind replaces the first (hot reload). Throws on an invalid kind name.
 */
export function registerCommandKind<C>(def: CommandKindDef<C>): void {
  if (!KIND_RE.test(def.kind) || def.kind === 'default') throw new Error(`registerCommandKind: invalid kind "${def.kind}"`)
  useKinds.setState((s) => ({ kinds: { ...s.kinds, [def.kind]: def as unknown as CommandKindDef } }))
}

export const kindOf = (kind: string): CommandKindDef | null => useKinds.getState().kinds[kind] ?? null

export const kindLabel = (def: CommandKindDef): string => (typeof def.label === 'function' ? def.label() : def.label)

/** Does a command of this kind write to the workspace (viewers don't get it)? Unknown kinds: yes. */
export function kindWrites(def: CommandKindDef | null, config: Record<string, unknown>): boolean {
  if (!def || def.writes === undefined) return true
  return typeof def.writes === 'function' ? def.writes(config) : def.writes
}
