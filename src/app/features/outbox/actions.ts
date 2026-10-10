/**
 * Changing a slip before it goes out (the person's keys, or the feature that staged it): the text (resets "seen"),
 * hold / release, withdraw, a tick on a flagged address, "seen", "send anyway" after CHANGED, a group item's tick.
 * Every change is one compare-and-set on the stored slip (store.ts mutateSlip / transition); nothing here sends.
 */
import { addressesTicked, personAddresses, sealOf } from './seal'
import { argsHashOf } from './hash'
import { ownOrigin } from './provenance'
import { getSlip, mutateSlip, transition, useOutbox, withLog } from './store'
import { cleanParams, fillArgs, textParam } from './template'
import { slipText } from './text'
import { unsent } from './machine'
import type { Slip, SlipId } from './types'

/**
 * The slip with a new text: params, args, hash, seal recomputed; rev + 1 and unseen (a text counts as seen only once
 * it is shown in full, Payload). `typed`: the person typed it in the slip's editor — only then can an address be theirs,
 * decided per address against every earlier text of the slip (the previous revision, Claude's draft); a caller's text,
 * or a caller's word that the person wrote it, never makes one theirs. Addresses the person typed stay theirs.
 */
async function withText(cur: Slip, text: string, by: 'person' | 'caller' | 'claude', typed: boolean): Promise<Slip | null> {
  const route = cur.route.snapshot
  const tp = textParam(route)
  if (!tp || !cur.draft) return null
  const clean = cleanParams(route, { ...cur.params }, text)
  if (!clean.ok) return null
  const filled = fillArgs(route, { key: cur.target.key, params: clean.params })
  if (!filled.ok) return null
  const rev = cur.draft.rev + 1
  const claudeText = by === 'claude' ? text : cur.draft.claudeText
  const fresh = typed ? personAddresses(`${slipText(cur)}\n${cur.draft.claudeText ?? ''}`, text, ownOrigin()) : []
  const typedAddrs = [...new Set([...(cur.typedAddrs ?? []), ...fresh])].slice(-50)
  return {
    ...cur,
    params: clean.params,
    args: filled.value,
    argsHash: await argsHashOf(filled.value),
    draft: { rev, by, ...(claudeText !== undefined ? { claudeText } : {}), seenRev: null },
    ...(typedAddrs.length ? { typedAddrs } : {}),
    seal: sealOf({ text, sources: cur.sources, complete: cur.seal.complete, ownText: cur.instruction, ownAddresses: typedAddrs, origin: ownOrigin(), previous: cur.seal }),
  }
}

/** The hand path's question ("Sent in …?") was about the text that was copied — a new text drops it. */
const dropAsking = (id: SlipId) => useOutbox.setState((st) => (st.asking?.id === id ? { asking: null } : {}))

async function setText(id: SlipId, text: string, by: 'person' | 'caller', typed: boolean): Promise<boolean> {
  const cur = getSlip(id)
  if (!cur || !unsent(cur.state)) return false
  const nx = await withText(cur, text, by, typed)
  if (!nx) return false
  let ok = false
  await mutateSlip(id, (stored) => {
    if (stored.argsHash !== cur.argsHash || stored.draft?.rev !== cur.draft?.rev || !unsent(stored.state)) return stored
    ok = true
    const state = stored.state === 'missing' || stored.state === 'held' ? 'ready' : stored.state
    return withLog({ ...nx, state, log: stored.log }, by === 'person' ? 'edited' : 'replaced', { rev: nx.draft!.rev })
  })
  if (ok) dropAsking(id)
  return ok
}

/**
 * A new text from the feature that staged the slip (the public API). A 'missing' or held slip becomes ready. `by`
 * is kept on the slip, nothing more: an address in the text is never taken as the person's own from a caller.
 */
export function replaceDraft(id: SlipId, text: string, by: 'person' | 'caller'): Promise<boolean> {
  return setText(id, text, by, false)
}

/** The person's own text, typed in the slip's editor (E, or the text of a 'missing' slip). */
export function writeText(id: SlipId, text: string): Promise<boolean> {
  return setText(id, text, 'person', true)
}

/** Claude's new draft for the slip (R): new text, the row's baseline from when the request was built, CHANGED cleared, unseen. */
export async function applyRedraft(id: SlipId, text: string, usd: number, baseline: Slip['baseline'], sources?: Slip['sources']): Promise<boolean> {
  const cur = getSlip(id)
  if (!cur || !unsent(cur.state) || cur.state === 'missing') return false
  const nx = await withText(sources ? { ...cur, sources } : cur, text, 'claude', false)
  if (!nx) return false
  let ok = false
  await mutateSlip(id, (stored) => {
    if (stored.argsHash !== cur.argsHash || stored.draft?.rev !== cur.draft?.rev || !unsent(stored.state)) return stored
    ok = true
    const { lastCheck: _drop, ...rest } = nx
    return withLog({ ...rest, baseline, state: stored.state === 'held' ? 'ready' : stored.state, usd: stored.usd + usd, log: stored.log }, 'redrafted', { rev: nx.draft!.rev })
  })
  if (ok) dropAsking(id)
  return ok
}

/** H: hold a ready slip, or release a held one. */
export async function toggleHold(id: SlipId): Promise<boolean> {
  const cur = getSlip(id)
  if (!cur) return false
  if (cur.state === 'ready') return !!(await transition(id, 'hold', (s) => withLog(s, 'held')))
  if (cur.state === 'held') return !!(await transition(id, 'release', (s) => withLog(s, 'released')))
  return false
}

/** Withdraw an unsent slip ('too-late' once anything left One — or it was marked sent). */
export async function withdrawSlip(id: SlipId, by: 'person' | 'origin'): Promise<'withdrawn' | 'too-late' | 'gone'> {
  const cur = getSlip(id)
  if (!cur) return 'gone'
  if (cur.state === 'withdrawn') return 'withdrawn'
  const done = await transition(id, 'withdraw', (s) => withLog(s, 'withdrawn', { by }))
  if (done) return 'withdrawn'
  return getSlip(id) ? 'too-late' : 'gone'
}

/** The person saw the whole text of this revision ("Show full text"). */
export async function markSeen(id: SlipId, rev: number): Promise<void> {
  await mutateSlip(id, (s) => (s.draft && s.draft.rev === rev && s.draft.seenRev !== rev ? { ...s, draft: { ...s.draft, seenRev: rev } } : s))
}

/** A tick on a flagged address (the person read it and means it). */
export async function tickAddress(id: SlipId, norm: string, on: boolean): Promise<void> {
  await mutateSlip(id, (s) => {
    const i = s.seal.addresses.findIndex((a) => a.norm === norm)
    if (i < 0 || s.seal.addresses[i].ticked === on) return s
    const addresses = s.seal.addresses.map((a, j) => (j === i ? { ...a, ticked: on } : a))
    return withLog({ ...s, seal: { ...s.seal, addresses } }, on ? 'address.ticked' : 'address.unticked', { address: norm.slice(0, 80) })
  })
}

/** "Send anyway" after CHANGED: the person read what changed. */
export async function ackChanged(id: SlipId): Promise<void> {
  await mutateSlip(id, (s) => (s.lastCheck && !s.lastCheck.ack ? withLog({ ...s, lastCheck: { ...s.lastCheck, ack: Date.now() } }, 'changed.ack') : s))
}

/** A group item ticked in or out (slice 2's group plate). */
export async function setIncluded(id: SlipId, on: boolean): Promise<boolean> {
  const after = await mutateSlip(id, (s) => (s.group && s.group.include !== on && unsent(s.state) ? { ...s, group: { ...s.group, include: on } } : s))
  return !!after?.group && after.group.include === on
}

/** May the slip's text go out as far as the person's checks go: seen, every flagged address ticked? */
export function checksDone(s: Slip): boolean {
  if (s.draft && s.draft.seenRev !== s.draft.rev) return false
  return addressesTicked(s.seal)
}
