/**
 * Who wrote, when no writer frame is open (store/writer.ts). Steps 1–3 are decided on the hot path, in
 * O(1): a cloud change (team), a replay of another tab's save (system:tab), a trusted user event (the
 * person — React handlers run inside the native event). Steps 4–6 are missing frames: the hot path keeps
 * what it knows then (an agent / AI scope open, the call stack in DEV / e2e) and the idle processor
 * decides with the diff: an editor's or a collab refresh's content-only change → the person; a synced
 * copy → synced<unknown>; an agent / AI scope → those lanes' unknown runs; else unknown. Every step 4–6
 * write is reported (reportFallback) — in DEV / e2e the whole suite is the net for write paths without a
 * writer. In production the write lands on its fallback lane, never on a guessed one.
 */
import type { Page } from '../../../store/types'
import { isApplyingRemote } from '../../../store/persistence'
import { reportFallback, SYSTEM, type Writer } from '../../../store/writer'
import { isApplyingCloudChange } from '../../../cloud'
import { isAgentWriting } from '../../agents/attribution'
import { isAIWriting } from '../../history/snapshots'

const USER_EVENTS = new Set([
  'click',
  'dblclick',
  'contextmenu',
  'keydown',
  'keyup',
  'keypress',
  'input',
  'beforeinput',
  'compositionend',
  'change',
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchend',
  'drop',
  'dragend',
  'paste',
  'cut',
  'submit',
  'blur',
  'focusout',
])

/** What the hot path knew about a write without a frame (decided in idle). */
export interface Pending {
  agent: boolean
  ai: boolean
  stack: string
}

const traces = (() => {
  if (typeof window === 'undefined') return false
  try {
    return !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV || new URLSearchParams(window.location.search).has('e2e')
  } catch {
    return false
  }
})()

/** Steps 1–3 on the hot path; null = a missing frame (`pending` carries what is known now). */
export function resolveHot(): { w: Writer } | { pending: Pending } {
  if (isApplyingCloudChange()) return { w: { kind: 'team' } }
  if (isApplyingRemote()) return { w: SYSTEM('tab') }
  const ev = typeof window !== 'undefined' ? (window as unknown as { event?: Event }).event : undefined
  if (ev?.isTrusted && USER_EVENTS.has(ev.type)) return { w: { kind: 'you', via: 'ui' } }
  return { pending: { agent: isAgentWriting(), ai: isAIWriting(), stack: traces ? (new Error().stack ?? '') : '' } }
}

const CONTENT_ONLY_FIELDS = new Set(['content', 'contentRev', 'contentOrigin', 'plain', 'updatedAt'])

/** Only content fields differ (and the origin names an editor or a collab refresh / the synced service). */
function contentOnlyOrigin(prev: Page | undefined, next: Page | undefined): string | null {
  if (!prev || !next) return null
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (CONTENT_ONLY_FIELDS.has(k)) continue
    if ((prev as unknown as Record<string, unknown>)[k] !== (next as unknown as Record<string, unknown>)[k]) return null
  }
  return next.contentOrigin ?? null
}

/**
 * Steps 4–6 in idle: the write's page pairs (empty for a database-only write) decide. Reported as a missing
 * frame with the hot path's stack.
 */
export function resolvePending(p: Pending, pairs: Array<[string, Page | undefined, Page | undefined]>, places: string[]): Writer {
  let w: Writer = { kind: 'unknown' }
  let step = 'unknown'
  const origins = pairs.map(([, a, b]) => contentOnlyOrigin(a, b))
  if (pairs.length && origins.every((o) => o !== null && (o.startsWith('editor:') || o === 'cloud'))) {
    w = { kind: 'you' }
    step = 'content'
  } else if (pairs.length && origins.every((o) => o === 'synced')) {
    w = { kind: 'synced', cause: 'unknown' }
    step = 'synced'
  } else if (p.agent) {
    w = { kind: 'agent', id: '-', run: '-' }
    step = 'agent'
  } else if (p.ai) {
    w = { kind: 'ai', run: '-', action: '-' }
    step = 'ai'
  }
  reportFallback(step, places, p.stack)
  return w
}
