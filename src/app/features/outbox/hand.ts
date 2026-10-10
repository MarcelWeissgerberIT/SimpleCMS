/**
 * Sending by hand (slice 1; nothing leaves One): "Copy & open" copies the text and opens the row's link in a new tab
 * (noopener, noreferrer) — the person posts it in the tool themselves, sets the other arguments the slip lists, and
 * comes back: "Mark as sent" turns the slip 'sent' (path 'hand'), then writes the row patch (one version, Undo =
 * "Reset row"), archives the answered inbox notes and keeps a receipt "BY HAND · not checked". The gate is the same
 * as for any send: ready, the text seen, every flagged address ticked, CHANGED acknowledged, the route unchanged, the
 * row and its key unchanged, storage working.
 */
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { localized } from '../../store/integrations'
import { recipeRoleNames } from '../agents'
import { archiveItems } from '../inbox/state'
import { currentLang } from '../../i18n'
import { checksDone } from './actions'
import { applyAfter, resetPatch } from './after'
import { tabId } from './db'
import { routeSigOf } from './hash'
import { readRow } from './provenance'
import { resolveRoute } from './routes'
import { getSlip, mutateSlip, storageOk, transition, useOutbox, withLog } from './store'
import { isChanged } from './counts'
import { slipText } from './text'
import type { Receipt, Slip, SlipId } from './types'

export type HandRefusal = 'storage' | 'state' | 'unseen' | 'ticks' | 'changed' | 'route' | 'row' | 'key' | 'via' | 'viewer'

/** Why the hand path's keys are off for this slip now (null: they work). Synchronous: the route's sig is checked on the press. */
export function handBlock(s: Slip): HandRefusal | null {
  if (!storageOk()) return 'storage'
  if (s.state !== 'ready') return 'state'
  if (!(s.route.snapshot.via ?? ['worker', 'hand']).includes('hand')) return 'via'
  if (useCloud.getState().readOnly) return 'viewer'
  const row = useWorkspace.getState().pages[s.target.rowId]
  if (!row || row.trashed || row.databaseId !== s.target.dbId) return 'row'
  if (s.draft && s.draft.seenRev !== s.draft.rev) return 'unseen'
  if (!checksDone(s)) return 'ticks'
  if (isChanged(s)) return 'changed'
  return null
}

/** The live route still the one the slip was staged for, and the row's key unchanged? */
async function stillSame(s: Slip): Promise<HandRefusal | null> {
  const r = resolveRoute({ profileId: s.route.profileId, routeId: s.route.routeId }, s.target.dbId)
  if ('refused' in r) return 'route'
  if ((await routeSigOf(r.profile.id, r.route, r.server)) !== s.route.sig) return 'route'
  const read = readRow(s.target.rowId, recipeRoleNames(r.profile))
  if (!read || read.key !== s.target.key) return 'key'
  return null
}

/** The row's link (the mirror's `link` field), http(s) only. */
export function linkOf(s: Slip): string | null {
  const p = (useWorkspace.getState().integrations ?? []).find((x) => x.id === s.route.profileId)
  return readRow(s.target.rowId, p ? recipeRoleNames(p) : {})?.link ?? null
}

/** "Copy & open": the text to the clipboard, the row's link in a new tab; then the slip asks "Sent in the ticket tool?". */
export async function copyAndOpen(id: SlipId): Promise<{ ok: true; copied: boolean; opened: boolean } | { ok: false; refused: HandRefusal }> {
  const s = getSlip(id)
  if (!s) return { ok: false, refused: 'state' }
  const block = handBlock(s) ?? (await stillSame(s))
  if (block) return { ok: false, refused: block }
  const text = slipText(s)
  let copied = false
  if (text) {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      copied = false
    }
  }
  const url = linkOf(s)
  let opened = false
  if (url) {
    try {
      opened = !!window.open(url, '_blank', 'noopener,noreferrer') || true
    } catch {
      opened = false
    }
  }
  useOutbox.setState({ asking: id })
  await mutateSlip(id, (cur) => withLog(cur, 'hand.copied', { copied: copied ? 1 : 0, opened: url ? 1 : 0 }))
  return { ok: true, copied, opened }
}

/** "Mark as sent": 'sent' by hand, then the row patch, the inbox notes, the receipt. */
export async function markSent(id: SlipId): Promise<Slip | null> {
  const s = getSlip(id)
  if (!s || handBlock(s)) return null
  const forced = !!s.lastCheck?.ack
  const sent = await transition(id, 'markSent', (cur) => withLog({ ...cur, attempt: { at: Date.now(), path: 'hand', tab: tabId(), forced } }, 'hand.sent'))
  useOutbox.setState((st) => (st.asking === id ? { asking: null } : {}))
  if (!sent) return null
  const label = localized(sent.route.label, currentLang()) || sent.route.routeId
  const rowPatch = applyAfter(sent.target.rowId, sent.after, label)
  const archived = sent.answers.length ? sent.answers : []
  if (archived.length) await archiveItems(archived).catch(() => undefined)
  const receipt: Receipt = {
    at: Date.now(),
    path: 'hand',
    host: (() => {
      try {
        return new URL(sent.target.serverUrl).host
      } catch {
        return ''
      }
    })(),
    tool: sent.route.tool,
    argsHash: sent.argsHash,
    by: useCloud.getState().active.kind === 'cloud' ? (useCloud.getState().user?.id ?? null) : null,
    preRead: { at: sent.lastCheck?.at ?? sent.baseline?.at ?? 0, from: sent.baseline ? 'row' : 'none', changed: (sent.lastCheck?.changed ?? []).map((c) => c.field), forced },
    result: { isError: false, text: '', ids: {} },
    readBack: { state: 'none' },
    rowPatch,
    archived,
    usd: sent.usd,
  }
  return mutateSlip(id, (cur) => withLog({ ...cur, receipt }, 'receipt', { applied: rowPatch.applied.length, skipped: rowPatch.skipped.length }))
}

/** "Not yet": the question goes away, the slip stays ready. */
export function notYet(id: SlipId): void {
  useOutbox.setState((st) => (st.asking === id ? { asking: null } : {}))
}

/** "Reset row" (only in One): the values before the send where the Outbox's value is still there. */
export async function resetRow(id: SlipId): Promise<{ reset: number; kept: string[] } | null> {
  const s = getSlip(id)
  if (!s?.receipt || s.receipt.rowPatch.resetAt) return null
  const res = resetPatch(s.target.rowId, s.receipt.rowPatch)
  await mutateSlip(id, (cur) => (cur.receipt ? withLog({ ...cur, receipt: { ...cur.receipt, rowPatch: { ...cur.receipt.rowPatch, resetAt: Date.now(), resetSkipped: res.kept } } }, 'reset', { reset: res.reset, kept: res.kept.length }) : cur))
  return res
}
