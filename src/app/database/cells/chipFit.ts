/**
 * Chip rows on one line (table cells, list rows, free-board card fields): a chip is never cut by the edge.
 *
 * The row (`.db-chips[data-fit]`, database.css) wraps inside a one-line clip, so a chip that does not fit drops
 * onto a hidden line below — whole, never cut mid-border — and a lone chip wider than the row shrinks, its name
 * ending in "…" inside its own border. This module only adds the count: the first `k` chips get `data-on` (sorted
 * before the "+n" key and a forced line break), every other chip keeps the style it was mounted with and so waits on
 * a hidden line; the key (`.db-more`) says how many and names them in its title (on hover).
 *
 * Cheap by design — the work per row follows what it SHOWS, never how many values it holds: one ResizeObserver for
 * every row on the page and, per row, the chips the plan read (the shown ones, the first hidden one or two) and the
 * key; a fit only on mount, a new render of the row, a size change of the row or a change of a watched chip's width
 * (a file name read later, a web font arriving, the text size or the look's font switched — none of which renders
 * the row again or changes its size). Each batch = one pass of reads (no style queries — offset / box sizes only),
 * then one of writes, and a write only where the plan changed. A row that mounts gets the plan the widths this page
 * already measured call for (`guess`, written before its first layout), so a fit that finds it right writes
 * nothing. Rows of one chip are never watched (CSS alone keeps them whole).
 */
import type { SyntheticEvent } from 'react'
import { t } from '../../i18n'

/** The text of each chip kind (the chip itself when it has none: plain formula chips). */
const NAME = '.db-rel__name, .db-person__name, .db-tag__text, .db-file__name'
/** `.db-chips` gap (database.css). */
const GAP = 4
/** Names in the count's title. */
const MAX_NAMES = 12
/** Widths remembered for guesses (chips by kind + text, rooms by column). */
const MAX_REMEMBERED = 4000

interface Natural {
  /** The chip's width with its whole name. */
  w: number
  /** What never shrinks: padding, icon / avatar, gaps. */
  fixed: number
}

interface Plan {
  /** Chips shown; the rest wait behind the count. */
  k: number
  /** The first chip shrinks to leave room for the count (`--more-room`). */
  squeeze: number
  /** What the shown chips and the count take (a row that sizes to its content takes only that). */
  used: number
  /** The row's height when it was read. */
  h?: number
}

const ALL: Plan = { k: Infinity, squeeze: 0, used: 0 }

let observer: ResizeObserver | null = null
/** The size each row was last fitted at: the observer's first report of a row a render just fitted is skipped. */
const fittedAt = new WeakMap<HTMLElement, string>()
/** The chips (and the key) of each watched row that the observer watches too, each one's row, and its width at the last fit. */
const rowChips = new WeakMap<HTMLElement, Set<HTMLElement>>()
const chipRow = new WeakMap<Element, HTMLElement>()
const chipWidth = new WeakMap<Element, number>()
/** Per row: the chips marked shown, the one squeezed, the links taken out of the tab order. */
const shownOf = new WeakMap<HTMLElement, HTMLElement[]>()
const squeezedOf = new WeakMap<HTMLElement, HTMLElement>()
const untabbedOf = new WeakMap<HTMLElement, Set<HTMLElement>>()
/** A row that sizes to its content (`data-fit="shrink"`): the room it had before it took only what it shows. */
const roomOf = new WeakMap<HTMLElement, number>()
/** The column a row belongs to (property + place) — its room is the room of every row of that column. */
const colOf = new WeakMap<HTMLElement, string>()
const queue = new Set<HTMLElement>()
let queued = false
let framed = 0

/** What this page measured: each chip's whole width by kind + text, each column's room, the key's width. */
const widths = new Map<string, Natural>()
const rooms = new Map<string, number>()
let keyWidth = 0

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  if (map.size >= MAX_REMEMBERED && !map.has(key)) map.clear()
  map.set(key, value)
}

/** A chip's border-box width as the observer reports it. */
function reported(e: ResizeObserverEntry): number {
  const b = e.borderBoxSize?.[0]
  return b ? b.inlineSize : e.target.getBoundingClientRect().width
}

/**
 * Watch a chip row: fit it again whenever its size changes (a column resized, the window) or one of its watched
 * chips changes width without it. The fit runs in the next frame, never inside the observer's callback: a row whose
 * width follows its content (list rows) may change size by the fit itself, which inside the callback would be an
 * observer loop. Until then the CSS clip keeps every chip whole. `col` names the column (property + place): a row
 * that mounts takes the plan the widths measured in it call for. Returns the unwatch.
 */
export function watchFit(el: HTMLElement, col?: string): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  observer ??= new ResizeObserver((entries) => {
    for (const e of entries) {
      const target = e.target as HTMLElement
      const row = chipRow.get(target)
      if (row) {
        // a chip: only a real change of its width (its first report after a fit matches what the fit read)
        if (Math.abs(reported(e) - (chipWidth.get(target) ?? -1)) > 0.25) queue.add(row)
      } else if (fittedAt.get(target) !== sizeKey(e.contentRect.width, e.contentRect.height)) queue.add(target)
    }
    if (queue.size) framed ||= requestAnimationFrame(flush)
  })
  if (col) colOf.set(el, col)
  observer.observe(el)
  guess(el)
  return () => {
    observer?.unobserve(el)
    for (const c of rowChips.get(el) ?? []) {
      observer?.unobserve(c)
      chipRow.delete(c)
    }
    rowChips.delete(el)
    queue.delete(el)
    // the row may stay (now one chip): nothing of the count is left behind
    apply(el, ALL)
  }
}

/** Watch the chips the fit read and the key (after a fit): new ones join, the others leave. Writes nothing to the DOM. */
function track(el: HTMLElement, watched: HTMLElement[]): void {
  if (!observer) return
  let set = rowChips.get(el)
  if (!set) rowChips.set(el, (set = new Set()))
  const now = new Set(watched)
  for (const c of set)
    if (!now.has(c)) {
      observer.unobserve(c)
      set.delete(c)
      chipRow.delete(c)
    }
  for (const c of watched)
    if (!set.has(c)) {
      set.add(c)
      chipRow.set(c, el)
      observer.observe(c, { box: 'border-box' })
    }
}

/** Fit a row after a render, before it is painted (its chips may have changed while its size did not). */
export function queueFit(el: HTMLElement): void {
  queue.add(el)
  if (queued) return
  queued = true
  queueMicrotask(flush)
}

function flush(): void {
  queued = false
  if (framed) cancelAnimationFrame(framed)
  framed = 0
  if (!queue.size) return
  const rows = [...queue]
  queue.clear()
  // all reads first, then all writes: one layout for the whole batch
  const plans = rows.map((el) => (el.isConnected ? plan(el) : null))
  rows.forEach((el, i) => {
    const p = plans[i]
    if (!p) return
    apply(el, p)
    track(el, p.watched)
  })
}

/** The row's "+n" key (always its last child). */
function keyOf(el: HTMLElement): HTMLElement | null {
  const last = el.lastElementChild as HTMLElement | null
  return last?.classList.contains('db-more') ? last : null
}

const nameOf = (chip: Element): Element => (chip.matches(NAME) ? chip : (chip.querySelector(NAME) ?? chip))

/** A chip's width with its whole name, also while it is shrunk (its name's hidden overflow added back). */
function natural(chip: HTMLElement): Natural {
  const name = nameOf(chip) as HTMLElement
  const w = chip.offsetWidth
  const shown = name.clientWidth
  return { w: w + Math.max(0, name.scrollWidth - shown), fixed: name === chip ? 0 : Math.max(0, w - shown) }
}

/** What a chip's width depends on: its kind and its text (the avatar's initials, an emoji icon included). */
const sigOf = (chip: Element): string => `${chip.className}\u0001${chip.textContent ?? ''}`

const sizeKey = (w: number, h: number) => `${Math.round(w)}x${Math.round(h)}`

/**
 * How many chips show beside the count, from their whole widths (read, or remembered for a guess — `width` returns
 * null for one unknown). Reads only up to the first chip that would not fit even without the count: nothing after it
 * can show. `read` = how many it asked for.
 */
function decide(n: number, room: number, count: number, width: (i: number) => Natural | null): (Plan & { read: number }) | null {
  // whole-pixel reads: a little slack so a chip that "just fits" never drops behind the count
  const slack = (i: number) => 1 + i * 0.5
  let total = 0
  let k = 0
  let used = 0
  let read = 0
  let first: Natural | null = null
  for (let i = 0; i < n; i++) {
    const w = width(i)
    if (!w) return null
    first ??= w
    read = i + 1
    total += w.w + (i ? GAP : 0)
    if (k === i && total + GAP + count <= room - slack(i + 1)) {
      k = i + 1
      used = total + GAP + count + slack(i + 1)
    }
    if (total > room - slack(i + 1)) break
  }
  if (read === n && total <= room - slack(n)) return { k: n, squeeze: 0, used: 0, read }
  if (k) return { k, squeeze: 0, used, read }
  // the first chip alone is wider than the room beside the count: it shrinks ("…" in its own border) —
  // unless not even its icon would fit, then the count stands alone
  const squeeze = GAP + count + 1
  return first && first.fixed + 12 + squeeze <= room ? { k: 1, squeeze, used: room, read } : { k: 0, squeeze: 0, used: count, read }
}

/** A row that sizes to its content gets the width of what it shows; its room is the one it had before. */
const shrinks = (el: HTMLElement) => el.dataset.fit === 'shrink'

function roomFor(el: HTMLElement): number {
  return shrinks(el) && el.style.width ? (roomOf.get(el) ?? el.clientWidth) : el.clientWidth
}

/** Reads only. */
function plan(el: HTMLElement): (Plan & { watched: HTMLElement[] }) | null {
  const h = el.offsetHeight
  fittedAt.set(el, sizeKey(el.offsetWidth, h))
  const kids = el.children
  const more = keyOf(el)
  const n = more ? kids.length - 1 : kids.length
  if (!more || n < 2) return { k: n, squeeze: 0, used: 0, watched: [] }
  const watched: HTMLElement[] = []
  const watch = (i: number) => {
    const c = kids[i] as HTMLElement
    watched.push(c)
    chipWidth.set(c, c.getBoundingClientRect().width)
  }
  // a row that counts nothing and whose last chip sits on the first line: every chip fits. Read from the chips,
  // never the row's scroll height — the unseen key (one line high, out of flow) is no chip waiting below
  if (!el.hasAttribute('data-more') && (kids[n - 1] as HTMLElement).offsetTop < el.clientHeight) {
    for (let i = 0; i < n; i++) watch(i)
    watched.push(more)
    chipWidth.set(more, more.getBoundingClientRect().width)
    return { k: n, squeeze: 0, used: 0, watched }
  }
  const room = roomFor(el)
  if (shrinks(el)) roomOf.set(el, room)
  const count = more.offsetWidth
  const p = decide(n, room, count, (i) => {
    const c = kids[i] as HTMLElement
    const w = natural(c)
    // the same chip measured otherwise than before: fonts, text size or the look changed — forget every width
    if (w.w > 0) {
      const sig = sigOf(c)
      const was = widths.get(sig)
      if (was && Math.abs(was.w - w.w) > 0.5) widths.clear()
      remember(widths, sig, w)
    }
    return w
  })!
  for (let i = 0; i < p.read; i++) watch(i)
  watched.push(more)
  chipWidth.set(more, more.getBoundingClientRect().width)
  const col = colOf.get(el)
  if (col && room > 0) remember(rooms, col, room)
  if (count > 0) keyWidth = count
  return { ...p, h, watched }
}

/**
 * A row that mounts in a column this page has fitted: the plan the remembered widths call for, written before the
 * row is laid out for the first time (so it costs no second layout), checked by the fit right after. No guess while
 * a width is unknown or when everything fits (the row as rendered is right then).
 */
function guess(el: HTMLElement): void {
  const col = colOf.get(el)
  const room = col ? rooms.get(col) : undefined
  const more = keyOf(el)
  if (!room || !keyWidth || !more) return
  const kids = el.children
  const n = kids.length - 1
  if (n < 2) return
  const p = decide(n, room, keyWidth, (i) => widths.get(sigOf(kids[i])) ?? null)
  if (!p || p.k >= n) return
  if (shrinks(el)) roomOf.set(el, room)
  apply(el, p)
}

/** Writes only — and only what changed. O(shown): the chips that wait keep the style they were mounted with. */
function apply(el: HTMLElement, p: Plan): void {
  const kids = el.children
  const more = keyOf(el)
  const n = more ? kids.length - 1 : kids.length
  const hiding = !!more && p.k < n
  const k = hiding ? p.k : 0
  // the shown chips: the first k (those marked before are known — no walk over the ones that wait)
  const was = shownOf.get(el) ?? []
  const now: HTMLElement[] = []
  for (let i = 0; i < k; i++) now.push(kids[i] as HTMLElement)
  for (const c of was) if (!now.includes(c)) c.removeAttribute('data-on')
  for (const c of now) if (!c.hasAttribute('data-on')) c.setAttribute('data-on', '')
  if (now.length) shownOf.set(el, now)
  else shownOf.delete(el)
  // the first chip shrinks beside the count (its own custom property: nothing else restyles)
  const squeezed = hiding && p.squeeze ? now[0] : undefined
  const before = squeezedOf.get(el)
  if (before && before !== squeezed) before.style.removeProperty('--more-room')
  if (squeezed) {
    const v = `${p.squeeze}px`
    if (squeezed.style.getPropertyValue('--more-room') !== v) squeezed.style.setProperty('--more-room', v)
    squeezedOf.set(el, squeezed)
  } else squeezedOf.delete(el)
  if (el.hasAttribute('data-more') !== hiding) el.toggleAttribute('data-more', hiding)
  // a row that sizes to its content takes only what it shows (no gap where the waiting chips would be)
  if (shrinks(el) || el.style.width) {
    const width = hiding && shrinks(el) ? `${Math.ceil(p.used)}px` : ''
    if (el.style.width !== width) {
      el.style.width = width
      // its own new size is no reason to fit it again
      if (width && p.h !== undefined) fittedAt.set(el, sizeKey(Math.ceil(p.used), p.h))
    }
  }
  untab(el, kids, hiding ? k : n, n)
  if (!more) return
  const count = hiding ? (n - k > 99 ? '99+' : `+${n - k}`) : null
  if (more.getAttribute('data-count') !== count) {
    if (count) more.setAttribute('data-count', count)
    else more.removeAttribute('data-count')
  }
  if (!hiding && more.hasAttribute('title')) more.removeAttribute('title')
}

/** Links that wait behind the count leave the tab order (focus never lands on a chip nobody sees); shown ones come back. */
function untab(el: HTMLElement, kids: HTMLCollection, from: number, n: number): void {
  const was = untabbedOf.get(el)
  if (!was && (from >= n || (kids[0] as HTMLElement | undefined)?.tagName !== 'A')) return
  const now = new Set<HTMLElement>()
  for (let i = from; i < n; i++) {
    const c = kids[i] as HTMLElement
    if (c.tagName === 'A') now.add(c)
  }
  for (const c of was ?? []) if (!now.has(c)) c.removeAttribute('tabindex')
  for (const c of now) if (c.getAttribute('tabindex') !== '-1') c.setAttribute('tabindex', '-1')
  if (now.size) untabbedOf.set(el, now)
  else untabbedOf.delete(el)
}

/** The count's title, when the pointer comes to it: "2 more: Tessera, Launch plan" — the names as they are now. */
export function nameHidden(e: SyntheticEvent<HTMLElement>): void {
  const more = e.currentTarget
  const el = more.parentElement
  if (!el?.hasAttribute('data-more')) return
  const kids = el.children
  const n = kids.length - 1
  const k = shownOf.get(el)?.length ?? 0
  const names: string[] = []
  for (let i = k; i < n && names.length < MAX_NAMES; i++) {
    const name = nameOf(kids[i]).textContent?.trim()
    if (name) names.push(name)
  }
  more.title = t('database.chips.more', { count: n - k, names: names.join(', ') + (n - k > MAX_NAMES ? ', …' : '') })
}
