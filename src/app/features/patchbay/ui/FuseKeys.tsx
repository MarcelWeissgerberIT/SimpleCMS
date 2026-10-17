/**
 * The fuse plate's key column (plan §3.5, §1.9; §6 U8 / U21 / U12): "Resolve — changes the real setting", then each key
 * of the fuse (keys.ts writes it) — a button with a mono "what it changes" line; its `.kbd` digit shows only while the
 * fuse list or its plate has the keyboard (patchbay.css `:focus-within`; never on touch); a refused key is
 * `aria-disabled` (never `disabled`) with the reason under it — owners and admins named where rights are missing; a
 * key that works on this device only says so; the team note sits under key 1 / 2b; a mirror agent's tool list asks
 * first (an inline confirm row). Then "Copy link" (`#/patchbay?f=<path key>`) to hand the fuse over.
 *
 * `runKey` / `runUndo` are the one way the page presses a key and takes one back (click, 1 / 2 / 3, the closed plate's
 * Undo, the toast's Undo from any route, Mod+Z on the route): the toast (with Undo), the polite live region, and for key
 * 1 / 2 the closed plate of this visit — selected, its heading given the keyboard.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Check, Hand, Link2, ShieldCheck, Undo2, Unplug } from 'lucide-react'
import { useUI } from '../../../store/ui'
import { signoffAdmins } from '../../../store/fuseSignoffs'
import { routeHref } from '../../../lib/router'
import { isMac, shortcutLabel } from '../../../ui/controls'
import { focusIsNowhere } from '../../../ui/focus'
import { typing } from '../../../ui/keys'
import { lastKey, pressKey, undoKey, useKeyStack, type KeyDone, type UndoResult } from '../keys'
import type { FuseKey, FuseState, Model, ModelInput, MsgRef, OpenTarget } from '../types'
import { closedRow } from './fuseRows'
import { openTarget } from './open'
import { usePlateWords, type PlateWords } from './plateParts'
import type { Words } from './words'
import { announce, noteClosed, selectFuse } from './store'
import { refreshModel } from '../state'

const P = 'features.patchbay'

/** The undo shortcut as the plate and the closed plate name it ("Ctrl+Z" / "⌘Z"). */
export const UNDO_KBD = 'Mod+Z'

/** A key's refusal in words — the owners / admins named when the model could not (it never reads the member list). */
export function refusalOf(k: Pick<FuseKey, 'refusal'>): MsgRef | undefined {
  if (k.refusal?.key !== `${P}.key.adminsOnlyNone`) return k.refusal
  const names = signoffAdmins().filter(Boolean)
  return names.length ? { key: `${P}.key.adminsOnly`, vars: { names: names.join(', ') } } : k.refusal
}

/**
 * The words a key was pressed with (its model and input then): a closed plate names its path as it was — after the key
 * the model may no longer hold a module it ran through (a server no longer attached, a trigger nobody listens to).
 */
const pressedWith = new Map<string, PlateWords>()
export const wordsOfKey = (d: KeyDone, now: PlateWords): PlateWords => pressedWith.get(d.id) ?? now

/** Focus a closed / reopened plate's heading once it is on the page (the model rebuilds a frame later). */
function focusHeading(selector: string, tries = 24): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) {
      el.focus({ preventScroll: true })
      el.closest('#pb-fuse-plate, .pb-fcard')?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (tries > 0) focusHeading(selector, tries - 1)
  })
}

/** The words of a key that was pressed ("Fuse F1 closed — Inbox-Helfer: Apply directly → Proposals for review"). */
function doneSay(d: KeyDone, pw: PlateWords): string {
  const t = pw.w.t
  if (d.kind === 'allow') return t(`${P}.keys.allowedSay`, { f: d.fuse.label })
  if (d.kind === 'withdraw') return t(`${P}.keys.withdrawnSay`, { f: d.fuse.label })
  return t(`${P}.keys.closedSay`, { f: d.fuse.label, what: pw.say(d.what) })
}

/** Take a key back (`id`; none: the newest) — the toast, the polite region, the plate given the keyboard again. */
export function runUndo(pw: PlateWords, id?: string, opts: { focus?: boolean } = {}): UndoResult {
  const t = pw.w.t
  const toast = useUI.getState().toast
  const r = undoKey(id)
  if (!r.ok) {
    const why = pw.say(r.refused)
    const said = r.done ? t(`${P}.keys.undoRefused`, { why }) : why
    announce(said)
    const open = r.open
    toast({ message: said, kind: 'error', ...(open ? { action: { label: t(`${P}.keys.openEditor`), run: () => openTarget(open) } } : {}) })
    return r
  }
  const d = r.done
  const said = t(d.kind === 'withdraw' ? `${P}.keys.undoneAllowed` : `${P}.keys.undone`, { f: d.fuse.label })
  const waits = d.waits ? t(`${P}.keys.undoneWaits`, { creator: pw.member(d.waits.creator) ?? t(`${P}.plate.someone`) }) : ''
  announce(waits ? `${said} ${waits}` : said)
  toast({ message: said, kind: 'success', ...(waits ? { detail: waits } : {}) })
  if (opts.focus !== false && document.querySelector('[data-testid="patchbay-page"]')) {
    selectFuse(d.fuse.key)
    focusHeading(`[data-pb-plate="${CSS.escape(d.fuse.key)}"] #pb-fplate-h`)
  }
  return r
}

/** Mod+Z on the route: the newest key of this tab session (false: nothing to take back). */
export function undoNewest(pw: PlateWords): boolean {
  const d = lastKey()
  if (!d) return false
  runUndo(pw, d.id)
  return true
}

/**
 * Press a key of a fuse: a refused one is said (never written); a written one raises its toast with Undo; key 1 / 2
 * leave the closed plate of this visit, selected, its heading with the keyboard; key 3 keeps the keyboard where it is.
 * Returns the refusal shown under the key (null: written).
 */
export function runKey(f: FuseState, k: FuseKey, pw: PlateWords): { refused: MsgRef; open?: OpenTarget } | null {
  const t = pw.w.t
  const r = pressKey(f, k)
  if (!r.ok) {
    const refused = k.offered ? r.refused : (refusalOf(k) ?? r.refused)
    announce(t(`${P}.keys.refusedSay`, { key: pw.say(k.label), why: pw.say(refused) }))
    return { refused, ...(r.open ? { open: r.open } : {}) }
  }
  const d = r.done
  pressedWith.set(d.id, pw)
  // the session's stack keeps ≤ 20 keys: the words of keys that fell off go too
  for (const id of [...pressedWith.keys()]) if (!useKeyStack.getState().done.some((x) => x.id === id)) pressedWith.delete(id)
  // fix mid: "closed" only when the rebuilt model says so — the same path, or the same decider still reaching the same
  // way out by another route, still open: said as it is, the plate of that fuse keeps the keyboard (no closed plate)
  const still = d.n !== 3 ? stillOpen(f) : null
  const said = still ? pw.say({ key: `${P}.keys.stillOpenSay`, vars: { f: d.fuse.label, what: pw.say(d.what), module: f.chain.exit?.module ?? '' } }) : doneSay(d, pw)
  const detail = [d.team ? pw.say(d.team) : '', d.device ? t(`${P}.key.deviceOnly`) : ''].filter(Boolean).join(' · ')
  announce(detail ? `${said} — ${detail}` : said)
  useUI.getState().toast({ message: said, kind: still ? 'info' : 'success', ...(detail ? { detail } : {}), action: { label: t('common.undo'), undo: true, run: () => void runUndo(pw, d.id) } })
  if (still) {
    selectFuse(still.key)
    focusHeading(`[data-pb-plate="${CSS.escape(still.key)}"] #pb-fplate-h`)
  } else if (d.n !== 3) {
    noteClosed(d.id, closedRow(d.fuse.key))
    focusHeading(`[data-pb-closed="${CSS.escape(d.fuse.key)}"] #pb-fplate-h`)
  }
  return null
}

/**
 * The fuse a key 1 / 2 left open (null: it closed): the model built again now (the key's write is in the store), the
 * same path — or the same decider reaching the same way out by another route — still an open fuse.
 */
function stillOpen(f: FuseState): FuseState | null {
  const model = refreshModel() as Model
  const open = (model.fuses as FuseState[]).filter((x) => x.allowed?.state !== 'allowed')
  return open.find((x) => x.key === f.key) ?? open.find((x) => x.chain.decider === f.chain.decider && !!x.chain.exit && x.chain.exit.edge === f.chain.exit?.edge) ?? null
}

const ICON: Record<FuseKey['kind'], typeof Check> = {
  proposals: ShieldCheck,
  autofillHand: ShieldCheck,
  organiseHand: ShieldCheck,
  bridgeAsk: ShieldCheck,
  handOnly: Hand,
  cutTools: Unplug,
  noAutofill: Unplug,
  autoOff: ShieldCheck,
  readTools: Unplug,
  allow: Check,
  withdraw: Undo2,
}

/** One key: the button, what it changes, the notes under it, and why it is refused (here, or after a press). */
function KeyRow({ f, k, pw, primary, onPress, state }: { f: FuseState; k: FuseKey; pw: PlateWords; primary: boolean; onPress: (k: FuseKey, el: HTMLButtonElement) => void; state: { asking: boolean; refused: { refused: MsgRef; open?: OpenTarget } | null; onAsk: (go: boolean) => void } }) {
  const t = pw.w.t
  const Icon = ICON[k.kind]
  const id = `pb-fkey-${f.label}-${k.n}`
  const refusal = !k.offered ? refusalOf(k) : undefined
  const lines: ReactNode[] = []
  if (k.what) lines.push(<span key="w" className="pb-fkey__w">{pw.say(k.what)}</span>)
  if (k.note) lines.push(<span key="n" className="pb-fkey__note">{pw.say(k.note)}</span>)
  if (k.team && k.offered) lines.push(<span key="t" className="pb-fkey__note pb-fkey__note--team" data-testid="pb-fkey-team">{pw.say(k.team)}</span>)
  // Orders B10: a refused key with a place to take the step instead (the planner's untested server → its test)
  const openLabel = (o: OpenTarget) => t(k.kind === 'readTools' && o.to === 'mcp' ? `${P}.key.testServer` : `${P}.keys.openEditor`)
  if (refusal)
    lines.push(
      <span key="r" className="pb-fkey__why" data-testid="pb-fkey-why">
        {pw.say(refusal)}
        {k.open && !state.refused && (
          <button type="button" className="pb-fkey__open" onClick={() => openTarget(k.open!)} data-testid="pb-fkey-open">
            {openLabel(k.open)}
          </button>
        )}
      </span>,
    )
  const cls = k.n === 3 ? 'btn btn--ghost pb-fkey__b' : primary ? 'btn btn--primary pb-fkey__b' : 'btn pb-fkey__b'
  return (
    <div className="pb-fkey" data-n={k.n} data-kind={k.kind} data-offered={k.offered || undefined} data-testid="pb-fkey">
      <button
        type="button"
        className={cls}
        aria-disabled={!k.offered || undefined}
        aria-describedby={`${id}-d`}
        aria-keyshortcuts={String(k.n)}
        data-pb-key={k.n}
        onClick={(e) => onPress(k, e.currentTarget)}
      >
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="pb-fkey__l">{pw.say(k.label)}</span>
        <span className="kbd pb-fkey__kbd" aria-hidden="true">
          {k.n}
        </span>
      </button>
      <span className="pb-fkey__lines" id={`${id}-d`}>
        {lines}
      </span>
      {state.asking && k.asks && (
        <span className="pb-fkey__ask" role="group" aria-label={pw.say(k.asks)} data-testid="pb-fkey-ask">
          <span className="pb-fkey__asktext">{pw.say(k.asks)}</span>
          <span className="pb-fkey__askkeys">
            <button type="button" className="btn btn--sm btn--primary" onClick={() => state.onAsk(true)} data-pb-ask-go="">
              {t(`${P}.keys.ask.go`)}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => state.onAsk(false)}>
              {t('common.cancel')}
            </button>
          </span>
        </span>
      )}
      {state.refused && (
        <span className="pb-fkey__why pb-fkey__why--now" role="status" data-testid="pb-fkey-refused">
          {pw.say(state.refused.refused)}
          {state.refused.open && (
            <button type="button" className="pb-fkey__open" onClick={() => openTarget(state.refused!.open!)}>
              {openLabel(state.refused.open)}
            </button>
          )}
        </span>
      )}
    </div>
  )
}

/** The keys a fuse offers (key 1, 2, 3 — the model decides which and why one is refused). */
export function useFuseKeys(f: FuseState, pw: PlateWords) {
  const [asking, setAsking] = useState<number | null>(null)
  const [refused, setRefused] = useState<{ n: number; r: { refused: MsgRef; open?: OpenTarget } } | null>(null)
  const askFrom = useRef<HTMLButtonElement | null>(null)
  const press = (k: FuseKey, el?: HTMLButtonElement | null) => {
    setRefused(null)
    if (k.offered && k.asks && asking !== k.n) {
      // a mirror agent's recipe tool list changes: asked once, the confirm key takes the keyboard (Esc / Cancel: back)
      askFrom.current = el ?? null
      setAsking(k.n)
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-pb-plate="${CSS.escape(f.key)}"] [data-pb-ask-go]`)?.focus())
      return
    }
    setAsking(null)
    const r = runKey(f, k, pw)
    if (r) setRefused({ n: k.n, r })
  }
  const cancelAsk = () => {
    setAsking(null)
    askFrom.current?.focus()
  }
  const answer = (k: FuseKey, go: boolean) => {
    if (!go) return cancelAsk()
    setAsking(null)
    const r = runKey(f, k, pw)
    if (r) setRefused({ n: k.n, r })
  }
  return { asking, refused, press, answer, cancelAsk }
}

/** The key column of a fuse plate (`variant` 'card': the phone's keys, stacked full width under the sentence). */
export function FuseKeys({ f, pw, variant = 'plate', keys }: { f: FuseState; pw: PlateWords; variant?: 'plate' | 'card'; keys: ReturnType<typeof useFuseKeys> }) {
  const t = pw.w.t
  const [copied, setCopied] = useState(false)
  // the one signal key: key 1 on an open (or lapsed) plate — an allowed path is neutral ink, nothing calls for attention
  const firstOffered = f.allowed?.state === 'allowed' ? undefined : f.keys.find((k) => k.n === 1 && k.offered)
  const copy = async () => {
    const url = `${location.origin}${location.pathname}${routeHref({ name: 'patchbay', f: f.key })}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      announce(t(`${P}.keys.copied`, { f: f.label }))
      useUI.getState().toast({ message: t(`${P}.keys.copied`, { f: f.label }), kind: 'success' })
    } catch {
      useUI.getState().toast({ message: t(`${P}.keys.copyFailed`, { url }) })
    }
  }
  return (
    <div
      className="pb-fkeys"
      data-variant={variant}
      role="group"
      aria-label={t(`${P}.keys.aria`, { f: f.label })}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && keys.asking !== null) {
          e.preventDefault()
          e.stopPropagation()
          keys.cancelAsk()
        }
      }}
      data-testid="pb-fkeys"
    >
      {variant === 'plate' && <span className="label pb-fkeys__h">{t(`${P}.fuse.resolve`)}</span>}
      {f.keys.map((k) => (
        <KeyRow
          key={k.n}
          f={f}
          k={k}
          pw={pw}
          primary={k === firstOffered}
          onPress={(key, el) => keys.press(key, el)}
          state={{ asking: keys.asking === k.n, refused: keys.refused?.n === k.n ? keys.refused.r : null, onAsk: (go) => keys.answer(k, go) }}
        />
      ))}
      <button type="button" className="pb-fkeys__copy" title={t(`${P}.keys.copyTitle`)} onClick={() => void copy()} data-copied={copied || undefined} data-testid="pb-fkey-copy">
        <Link2 size={13} strokeWidth={1.75} aria-hidden="true" />
        {t(`${P}.key.copyLink`)}
      </button>
    </div>
  )
}

/** "Ctrl+Z in the Patchbay undoes every key" — the line under the facts. */
export function UndoAllLine({ pw }: { pw: PlateWords }) {
  const t = pw.w.t
  const text = t(`${P}.key.undoAll`, { kbd: '\u0000' })
  const [a, b] = text.split('\u0000')
  return (
    <p className="pb-fkeys__undo" data-testid="pb-undo-all">
      {a}
      <span className="kbd">{shortcutLabel(UNDO_KBD)}</span>
      {b}
    </p>
  )
}

/**
 * Mod+Z on #/patchbay (§1.9, §3.9): the newest key of this tab session, taken back — only with the keyboard in the page
 * (or nowhere), nobody typing, no dialog or popover open and nobody else having taken the key. Nothing to take back:
 * the key is left alone.
 */
export function PatchbayUndoKeys({ page, pw, extra }: { page: RefObject<HTMLElement | null>; pw: PlateWords; extra?: UndoExtra | UndoExtra[] | null }) {
  const latest = useRef(pw)
  latest.current = pw
  const more = useRef(extra)
  more.current = extra
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'z' || !(isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return
      const at = document.activeElement
      const root = page.current
      if (!root || typing(at)) return
      if (!(focusIsNowhere(at) || (!!at && root.contains(at)))) return
      if (document.querySelector('[aria-modal="true"]') || at?.closest('[data-popover], [role="dialog"]')) return
      // B12: a profile drop of this visit is one more thing Mod+Z takes back, B16 a patch — the newest of them and the
      // keys goes first
      const key = lastKey()
      const extras = more.current ? (Array.isArray(more.current) ? more.current : [more.current]) : []
      let best: { at: number; x: UndoExtra } | null = null
      for (const x of extras) {
        const at = x.at()
        if (at !== null && (!best || at > best.at)) best = { at, x }
      }
      if (!key && !best) return
      e.preventDefault()
      if (best && (!key || best.at > key.at)) best.x.run(latest.current)
      else undoNewest(latest.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page])
  return null
}

/** Something else Mod+Z on the route takes back (B12: the profile drop, B16: a patch): when it was done (null: nothing) and its Undo. */
export interface UndoExtra {
  at: () => number | null
  run: (pw: PlateWords) => void
}

/** The page's Mod+Z, with the plate's words (mounted once the model is there). */
export function UndoKeysHost({ page, model, input, words, extra }: { page: RefObject<HTMLElement | null>; model: Model; input: ModelInput; words: Words; extra?: UndoExtra | UndoExtra[] | null }) {
  const pw = usePlateWords(model, input, words)
  return <PatchbayUndoKeys page={page} pw={pw} extra={extra} />
}
