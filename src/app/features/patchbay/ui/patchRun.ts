/**
 * The one way the page patches (P4, B16; plan §1.13, §2.9, §3.9) — a drop, a pick in "Connect to …", Delete on a jack:
 *
 *   startPatch(patch, at) → plan it (patching.ts planOn — the editors' own checks run first, patch.ts) →
 *     refused: the popover at the target jack says why (and "Open the editor" where it is changed instead), the polite
 *              region too; nothing to do (already so): the same popover, in ink;
 *     asks:    the popover at the target jack asks once — "+F2" (the fuse it would open), a mirror's tool list, the last
 *              start, a webhook trigger — "Plug anyway" writes, Esc / Cancel gives the keyboard back to the source jack;
 *     else:    committed at once (`you~patchbay`), a toast with Undo, said politely, the keyboard back on the source jack.
 *   runPatchUndo(pw, id?) → the toast's Undo (any route) and Mod+Z on the route: `you~undo`, refused when a target
 *     changed since ("Changed since — open the editor"); a non-creator's Undo says the agent still waits for its creator.
 * Names are taken when the patch is made (the toast and its Undo say them as they were).
 */
import { useUI } from '../../../store/ui'
import { canFocus, focusIsNowhere, focusMainRegion } from '../../../ui/focus'
import { commitOn, planOn, planRefused, undoOn, type PatchDone, type PatchNames, type PlanOk } from '../patching'
import { choicesOf, jackOf, type Choice } from '../patchPick'
import { nameOf, placeNameOf } from '../plain'
import { kindOfKey } from '../ref'
import type { Model, ModelInput, MsgRef, Patch, PatchEnd } from '../types'
import type { PlateWords } from './plateParts'
import type { Words } from './words'
import { announce } from './store'
import { openTarget } from './open'
import { setPick, setPop, usePatchUI } from './patchUI'

const P = 'features.patchbay'

const dec = (p: string | undefined): string | null => {
  if (p === undefined || p === '-' || p === '') return null
  try {
    return decodeURIComponent(p)
  } catch {
    return null
  }
}

/** A patch end by name ("Werktags um 07:30", "Mails · command", "Outbox · IN-01", a net flag's name). */
export function endName(e: PatchEnd, model: Model, input: ModelInput, w: Words): string {
  const title = (id: string | null) => (id && input.pages[id]?.title.trim()) || w.t(`${P}.untitled`)
  if (e.module.startsWith('net:')) {
    const n = model.nets.find((x) => x.key === e.module)
    if (n) return w.flag(n)
    const [, db, prop] = e.module.split(':')
    const d = dec(db)
    return d ? placeNameOf(model, input, { db: d, prop: prop === '*' || prop === '+row' ? prop : (dec(prop) ?? '*') }, w.ctx) : e.module
  }
  const kind = kindOfKey(e.module)
  const p = e.module.split(':').slice(1).map(dec)
  if (kind === 'database' && e.role === 'rows') return w.t(`${P}.patch.end.rows`, { db: title(p[0]) })
  if (kind === 'outbox' && !p[1]) {
    const prof = input.profiles.find((x) => x.profile.id === p[0])?.profile
    return w.t(`${P}.module.outbox.profile`, { profile: prof?.name?.trim() || p[0] || '' })
  }
  const m = model.modules.find((x) => x.key === e.module)
  if (m) return w.name(m)
  if (kind === 'database' || kind === 'page') return title(p[0])
  return nameOf(model, input, e.module, w.ctx)
}

/** A patch end's kind word ("Clock", "Agent", "Command" for a database's commands). */
export function endKind(e: PatchEnd, model: Model, w: Words): string {
  if (e.module.startsWith('net:')) return w.t(`${P}.kind.rowTrigger`)
  const kind = kindOfKey(e.module)
  if (kind === 'database' && e.role === 'rows') return w.t(`${P}.kind.command`)
  if (kind === 'outbox') return w.t(`${P}.module.outbox.kind`)
  const m = model.modules.find((x) => x.key === e.module)
  if (m) return w.kind(m)
  return kind ? w.t(`${P}.kind.${kind}`) : ''
}

/** A patch end's jack in words ("Write? 4", "start"). */
export function endJack(e: PatchEnd, model: Model, w: Words): string {
  const j = jackOf(model, `${e.module}.${e.role}`)
  const m = j ? model.modules.find((x) => x.key === j.module) : undefined
  return (j && m && w.jack(j, m)) || w.t(`${P}.jack.role.${e.role}`)
}

/** The names a patch is said with (a tool: its server · the tool → the profile's Outbox). */
export function namesOf(patch: Patch, model: Model, input: ModelInput, w: Words): PatchNames {
  const from = endName(patch.from, model, input, w)
  const to = endName(patch.to, model, input, w)
  return patch.from.tool !== undefined ? { from: `${from} · ${patch.from.tool}`, to, tool: patch.from.tool } : { from, to }
}

/** What a written patch says ("Plugged: A → B", "Locked: create_issue (OUT) · Outbox · IN-01"). */
function doneText(d: Pick<PatchDone, 'patch' | 'names'>, w: Words): string {
  const { names, patch } = d
  if (names.tool !== undefined) return w.t(patch.op === 'plug' ? `${P}.patch.done.lock` : `${P}.patch.done.unlock`, { tool: names.tool, to: names.to })
  return w.t(patch.op === 'plug' ? `${P}.patch.done.plug` : `${P}.patch.done.unplug`, { from: names.from, to: names.to })
}

/** Where the keyboard goes back to: the source jack (the model rebuilds a frame later), else its module, else the main region. */
export function focusJack(key: string, tries = 12): void {
  requestAnimationFrame(() => {
    const esc = CSS.escape(key)
    const el = document.querySelector<HTMLElement>(`.pb-jk[data-jack="${esc}"]`)
    if (el && canFocus(el)) {
      el.focus({ preventScroll: true })
      return
    }
    if (tries > 0) return focusJack(key, tries - 1)
    const mod = key.slice(0, key.lastIndexOf('.'))
    const m = document.querySelector<HTMLElement>(`.pb-mod[data-key="${CSS.escape(mod)}"]`)
    if (m) m.focus({ preventScroll: true })
    else if (focusIsNowhere()) focusMainRegion()
  })
}

/** The element the popover hangs at: the end's jack on the rack, else its module (null: neither is drawn). */
export function anchorOf(e: PatchEnd): Element | null {
  return document.querySelector(`.pb-jk[data-jack="${CSS.escape(`${e.module}.${e.role}`)}"]`) ?? document.querySelector(`.pb-mod[data-key="${CSS.escape(e.module)}"]`)
}

interface At {
  /** where the popover hangs (the target jack) */
  anchor: Element
  /** the source jack's key (the keyboard goes back there) */
  source: string
}

/** Plan a patch and act on the plan: say why not, ask once, or write. */
export function startPatch(patch: Patch, at: At, pw: PlateWords): void {
  const t = pw.w.t
  const plan = planOn(patch)
  if (planRefused(plan)) {
    setPop({ kind: plan.info ? 'info' : 'refused', patch, msg: plan.refused, ...(plan.open ? { open: plan.open } : {}), anchor: at.anchor, source: at.source })
    const why = pw.say(plan.refused)
    announce(plan.info ? why : t(patch.op === 'unplug' ? `${P}.patch.unplugRefusedSay` : `${P}.patch.refusedSay`, { why }))
    return
  }
  const names = namesOf(patch, pw.model, pw.input, pw.w)
  if (plan.asks?.length) {
    setPop({ kind: 'ask', patch, plan, names, anchor: at.anchor, source: at.source })
    announce(plan.asks.map((a) => pw.say(a)).join(' '))
    return
  }
  commitAndSay(patch, plan, names, at, pw)
}

/** "Plug anyway" on the ask: written now (the targets read again — one changed meanwhile refuses "changed since"). */
export function confirmPop(pw: PlateWords): void {
  const pop = usePatchUI.getState().pop
  if (pop?.kind !== 'ask') return
  setPop(null)
  commitAndSay(pop.patch, pop.plan, pop.names, pop, pw)
}

/** Esc / Cancel / Close on the popover: nothing written, the keyboard back on the source jack. */
export function closePop(): void {
  const pop = usePatchUI.getState().pop
  if (!pop) return
  setPop(null)
  focusJack(pop.source)
}

function commitAndSay(patch: Patch, plan: PlanOk, names: PatchNames, at: At, pw: PlateWords): void {
  const t = pw.w.t
  const r = commitOn(patch, plan, names)
  if (!r.ok) {
    setPop({ kind: 'refused', patch, msg: r.refused, anchor: at.anchor, source: at.source })
    announce(t(patch.op === 'unplug' ? `${P}.patch.unplugRefusedSay` : `${P}.patch.refusedSay`, { why: pw.say(r.refused) }))
    return
  }
  const d = r.done
  const said = doneText(d, pw.w)
  const detail = [...d.notes.map((n) => pw.say(n)), ...d.opens.map((f) => t(`${P}.patch.done.opens`, { f }))].filter(Boolean).join(' · ')
  announce(detail ? `${said} — ${detail}` : said)
  useUI.getState().toast({ message: said, kind: 'success', ...(detail ? { detail } : {}), action: { label: t('common.undo'), undo: true, run: () => void runPatchUndo(pw, d.id) } })
  focusJack(at.source)
}

/** Take a patch back (`id`; none: the newest) — the toast, the polite region; refused: why, with "Open the editor". */
export function runPatchUndo(pw: PlateWords, id?: string): boolean {
  const t = pw.w.t
  const toast = useUI.getState().toast
  const r = undoOn(id)
  if (!r.ok) {
    const why = pw.say(r.refused)
    const said = r.done ? t(`${P}.keys.undoRefused`, { why }) : why
    announce(said)
    const open = r.open
    toast({ message: said, kind: 'error', ...(open ? { action: { label: t(`${P}.keys.openEditor`), run: () => openTarget(open) } } : {}) })
    return false
  }
  const d = r.done
  const said = t(`${P}.patch.undone`, { from: d.names.from, to: d.names.to })
  const waits = d.notes.find((n: MsgRef) => n.key === `${P}.key.confirmAfter`)
  const detail = waits ? t(`${P}.keys.undoneWaits`, { creator: pw.member(String(waits.vars?.creator ?? '')) ?? t(`${P}.plate.someone`) }) : ''
  announce(detail ? `${said} ${detail}` : said)
  toast({ message: said, kind: 'success', ...(detail ? { detail } : {}) })
  return true
}

/** A pick in "Connect to …": the picker closes, the patch is planned again and acted on (at the target jack). */
export function pickChoice(c: Choice, source: { el: HTMLElement; key: string }, pw: PlateWords): void {
  setPick(null)
  // the popover hangs at the target jack (the other end on the rack, else its module, else the source jack)
  const anchor = anchorOf(c.other) ?? source.el
  startPatch(c.patch, { anchor, source: source.key }, pw)
}

/** Delete / Backspace on a jack: its one cable unplugged — several: the picker lists them; none: said. */
export function unplugJack(el: HTMLElement, model: Model, input: ModelInput, pw: PlateWords): void {
  const key = el.dataset.jack
  const j = key ? jackOf(model, key) : null
  if (!key || !j) return
  const cables = choicesOf(j, model, input).filter((c) => c.group === 'unplug')
  if (!cables.length) {
    announce(pw.w.t(`${P}.patch.nothingPlugged`))
    return
  }
  if (cables.length === 1) {
    startPatch(cables[0].patch, { anchor: el, source: key }, pw)
    return
  }
  setPick({ jack: key, anchor: el, only: 'unplug' })
}
