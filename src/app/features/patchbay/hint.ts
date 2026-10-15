/**
 * Fuse hints where the setting lives (plan §1.2, §1.20) — THE one dependency-free module of the Patchbay that other
 * areas may import directly (sanctioned like features/preflight/registry): the agent editor's write-mode row, the
 * agent's MCP tool list and AutomationsModal show "On fuse F1 — show in the Patchbay" from it, read in O(1).
 *
 * Imports only React, i18n, lib/router and ui/* (never the model, the store or another area) — and its own few CSS
 * lines (hint.css). The fuse computation (B8: after first paint, in idle — never at boot) writes the list with
 * setFuseHints; nothing is stored.
 *  - fuseHintOf(kind, id) / useFuseHint(kind, id): the open fuse a thing sits on (null: none)
 *  - FuseHintLine { kind, id, onOpen? }: the one line (§1.20) — nothing while the thing sits on no open fuse; a link to
 *    `#/patchbay?f=<path key>` ("On fuse F1 — show in the Patchbay"); `onOpen` runs first (a dialog closes itself —
 *    a route change alone leaves a modal open). B15 draws it for AutomationsModal; B10 places it in the agent editor.
 * Seam (DEV / `?e2e`): `window.__onePatchbayHints` = { set(list), of(kind, id) } — specs feed hints before the idle fuse
 * computation exists in their build, or without opening the Patchbay.
 * Ids per kind: 'agent' = agent id · 'agentServer' = `${agentId}:${serverName}` · 'automation' = `${dbId}:${automationId}` ·
 * 'autofill' = `${dbId}:${propId}`.
 */
import { createElement, useSyncExternalStore, type MouseEvent } from 'react'
import { useT } from '../../i18n'
import { navigate, routeHref } from '../../lib/router'
import type { FuseHint, HintKind } from './types'
import './hint.css'

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

/**
 * "On fuse F1 — show in the Patchbay" where the setting lives (§1.20): one line, only while `kind` / `id` sits on an
 * open fuse. A link (Mod / Shift + click keep the browser's own meaning); a plain click runs `onOpen` (the host dialog
 * closes) and opens `#/patchbay?f=<path key>`.
 */
export function FuseHintLine(props: { kind: HintKind; id: string; onOpen?: () => void }) {
  const t = useT()
  const hint = useFuseHint(props.kind, props.id)
  if (!hint) return null
  const route = { name: 'patchbay' as const, f: hint.key }
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    props.onOpen?.()
    navigate(route)
  }
  return createElement(
    'p',
    { className: 'pb-hint', 'data-pb-hint': hint.key },
    createElement(
      'a',
      { className: 'pb-hint__link', href: routeHref(route), onClick: open },
      createElement('span', { className: 'pb-hint__fuse', 'aria-hidden': true }),
      createElement('span', { className: 'pb-hint__text' }, t('features.patchbay.hint.onFuse', { f: hint.label })),
    ),
  )
}

const seamOn = (() => {
  try {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()

if (seamOn && typeof window !== 'undefined') {
  ;(window as unknown as { __onePatchbayHints?: unknown }).__onePatchbayHints = { set: setFuseHints, of: fuseHintOf }
}
