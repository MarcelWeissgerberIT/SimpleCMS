/**
 * Fuse hints where the setting lives (plan §1.2, §1.20) — THE one dependency-free module of the Patchbay that other
 * areas may import directly (sanctioned like features/preflight/registry): the agent editor's write-mode row, the
 * agent's MCP tool list and AutomationsModal show "On fuse F1 — show in the Patchbay" from it, read in O(1).
 *
 * Imports only React, i18n, lib/router and ui/* (never the model, the store or another area). The fuse computation
 * (B8: after first paint, in idle — never at boot) writes the list with setFuseHints; nothing is stored.
 *  - fuseHintOf(kind, id) / useFuseHint(kind, id): the open fuse a thing sits on (null: none)
 *  - FuseHintLine { kind, id }: the one line (B10 draws it; B1 renders nothing)
 * Ids per kind: 'agent' = agent id · 'agentServer' = `${agentId}:${serverName}` · 'automation' = `${dbId}:${automationId}` ·
 * 'autofill' = `${dbId}:${propId}`.
 */
import { useSyncExternalStore } from 'react'
import type { FuseHint, HintKind } from './types'

let hints = new Map<string, FuseHint>()
const listeners = new Set<() => void>()

const slot = (kind: HintKind, id: string) => `${kind}|${id}`

/** The open fuse `kind` / `id` sits on (the lowest label when it sits on several), null: none. O(1). */
export function fuseHintOf(kind: HintKind, id: string): FuseHint | null {
  return hints.get(slot(kind, id)) ?? null
}

/** Replace every hint (the fuse computation, after each run). Same content → nothing changes, nobody re-renders. */
export function setFuseHints(list: Array<{ kind: HintKind; id: string; fuse: FuseHint }>): void {
  const next = new Map<string, FuseHint>()
  for (const h of list) {
    const k = slot(h.kind, h.id)
    const cur = next.get(k)
    if (!cur || h.fuse.label.localeCompare(cur.label, undefined, { numeric: true }) < 0) next.set(k, h.fuse)
  }
  if (next.size === hints.size && [...next].every(([k, v]) => hints.get(k)?.key === v.key && hints.get(k)?.label === v.label)) return
  hints = next
  for (const fn of [...listeners]) fn()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** React: the open fuse `kind` / `id` sits on (null: none), re-rendered only when the hints change. */
export function useFuseHint(kind: HintKind, id: string): FuseHint | null {
  return useSyncExternalStore(
    subscribe,
    () => fuseHintOf(kind, id),
    () => null,
  )
}

/** "On fuse F1 — show in the Patchbay" where the setting lives (B10 draws it; until then nothing). */
export function FuseHintLine(props: { kind: HintKind; id: string }): null {
  return null
}
