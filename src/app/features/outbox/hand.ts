/**
 * Sending by hand (slice 1; nothing leaves One): "Copy & open" copies the text and opens the row's link in a new tab
 * (noopener, noreferrer) — the person posts it in the tool themselves, sets the other arguments the slip lists, and
 * comes back: "Mark as sent" turns the slip 'sent' (path 'hand'), then writes the row patch (one version, Undo =
 * "Reset row"), archives the answered inbox notes and keeps a receipt "BY HAND · not checked". The gate is the same
 * as for any send: ready, the text seen, every flagged address ticked, CHANGED acknowledged, the route unchanged, the
 * row and its key unchanged, storage working — and the row's link (a value the mirror wrote) pointing at the route's
 * server, its link base, or a host the person ticked for this slip.
 */
import { useWorkspace } from '../../store/store'
import { withWriter } from '../../store/writer'
import { useCloud } from '../../cloud'
import { hostOf, localized } from '../../store/integrations'
import { readServers } from '../ai/mcp-servers/config'
import { recipeRoleNames } from '../agents'
import { archiveItems } from '../inbox/state'
import { currentLang } from '../../i18n'
import { checksDone } from './actions'
import { applyAfter, resetPatch } from './after'
import { tabId } from './db'
import { routeSigOf } from './hash'
import { readRow } from './provenance'
import { resolveRoute } from './routes'
import { getSlip, mutateSlip, storageOk, useOutbox, withLog } from './store'
import { next } from './machine'
import { isChanged } from './counts'
import { slipText } from './text'
import type { Receipt, Slip, SlipId } from './types'

export type HandRefusal = 'storage' | 'state' | 'unseen' | 'ticks' | 'changed' | 'route' | 'row' | 'key' | 'via' | 'viewer' | 'link' | 'copied'

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
  const link = linkOf(s)
  if (link && !linkHome(s, link) && s.linkOk !== link) return 'link'
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

/** Same host, or one inside the other ("app.tracker.example" ↔ "tracker.example"; never a bare top-level name). */
const sameSite = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || (b.endsWith(`.${a}`) && a.includes('.')))

/**
 * Does the row's link lead where the route's server lives — its host (or one inside it) or the link base set for the
 * server on this device? A mirror writes the link from what the server returned; anything else is shown and needs a tick.
 */
export function linkHome(s: Slip, link: string): boolean {
  const host = hostOf(link)
  if (!host) return false
  const server = readServers(useWorkspace.getState().settings).find((x) => x.id === s.target.serverId || x.name === s.target.serverName)
  const homes = [hostOf(s.target.serverUrl), ...(server?.linkBase ? [hostOf(server.linkBase)] : [])]
  return homes.some((h) => sameSite(host, h))
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
  // the question is about exactly these arguments: a new text (E, R, a caller) drops it
  useOutbox.setState({ asking: { id, argsHash: s.argsHash } })
  await mutateSlip(id, (cur) => withLog(cur, 'hand.copied', { copied: copied ? 1 : 0, opened: url ? 1 : 0 }))
  return { ok: true, copied, opened }
}

/** Why "Mark as sent" is refused now (null: it may go): the hand path's gate, and the text must be the one copied. */
export function markBlock(s: Slip): HandRefusal | null {
  const asked = useOutbox.getState().asking
  if (!asked || asked.id !== s.id || asked.argsHash !== s.argsHash) return 'copied'
  return handBlock(s)
}

/** "Mark as sent": 'sent' by hand, then the row patch, the inbox notes, the receipt. Only for the text that was copied. */
export async function markSent(id: SlipId): Promise<Slip | null> {
  const s = getSlip(id)
  if (!s || markBlock(s)) return null
  const copiedHash = s.argsHash
  const forced = !!s.lastCheck?.ack
  // one compare-and-set: still the arguments that were copied (another tab may have changed the text), still ready
  let ok = false
  const sent = await mutateSlip(id, (cur) => {
    const to = cur.argsHash === copiedHash ? next(cur.state, 'markSent') : null
    if (!to) return cur
    ok = true
    return { ...withLog({ ...cur, attempt: { at: Date.now(), path: 'hand', tab: tabId(), forced } }, 'hand.sent'), state: to }
  })
  useOutbox.setState((st) => (st.asking?.id === id ? { asking: null } : {}))
  if (!ok || !sent) return null
  const label = localized(sent.route.label, currentLang()) || sent.route.routeId
  // the person's press (store/writer.ts): the patch lands after the slip's await, outside their click
  const rowPatch = withWriter({ kind: 'you', via: 'outbox', ref: id }, () => applyAfter(sent.target.rowId, sent.after, label))
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
  useOutbox.setState((st) => (st.asking?.id === id ? { asking: null } : {}))
}

/** The person accepts the row's link for this slip although it leads elsewhere (the tick on the hand plate). */
export async function acceptLink(id: SlipId, link: string | null): Promise<void> {
  await mutateSlip(id, (cur) => {
    if ((cur.linkOk ?? null) === link) return cur
    const { linkOk: _drop, ...rest } = cur
    return withLog(link ? { ...rest, linkOk: link } : rest, link ? 'link.ticked' : 'link.unticked', { host: link ? hostOf(link).slice(0, 80) : '' })
  })
}

/** "Reset row" (only in One): the values before the send where the Outbox's value is still there. */
export async function resetRow(id: SlipId): Promise<{ reset: number; kept: string[] } | null> {
  const s = getSlip(id)
  if (!s?.receipt || s.receipt.rowPatch.resetAt) return null
  const patch = s.receipt.rowPatch
  // the patch's Undo (lane undo, like every Undo — store/writer.ts)
  const res = withWriter({ kind: 'you', via: 'undo', ref: id }, () => resetPatch(s.target.rowId, patch))
  await mutateSlip(id, (cur) => (cur.receipt ? withLog({ ...cur, receipt: { ...cur.receipt, rowPatch: { ...cur.receipt.rowPatch, resetAt: Date.now(), resetSkipped: res.kept } } }, 'reset', { reset: res.reset, kept: res.kept.length }) : cur))
  return res
}
