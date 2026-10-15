/**
 * Chip rows on one line (table cells, list rows, free-board card fields): a chip is never cut by the edge.
 *
 * The row (`.db-chips[data-fit]`, database.css) wraps inside a one-line clip, so a chip that does not fit drops
 * onto a hidden line below — whole, never cut mid-border — and a lone chip wider than the row shrinks, its name
 * ending in "…" inside its own border. This module only adds the count: chips past the first `k` get `data-off`
 * (behind the count and a forced line break, so always on a hidden line) and the "+n" key (`.db-more`) names them
 * in its title.
 *
 * Cheap by design: one ResizeObserver for every row on the page and the chips in it, a fit only on mount, a new
 * render of the row, a size change of the row or a change of a chip's width (a file name read later, the web
 * font arriving, the text size or the look's font switched — none of which renders the row again or changes its
 * size). Each batch = one pass of reads (no style queries — offset / box sizes only), then one of writes, and a
 * write only where the plan changed. Rows of one chip are never watched (CSS alone keeps them whole).
 */
import { t } from '../../i18n'

/** The text of each chip kind (the chip itself when it has none: plain formula chips). */
const NAME = '.db-rel__name, .db-person__name, .db-tag__text, .db-file__name'
/** `.db-chips` gap (database.css). */
const GAP = 4
/** Names in the count's title. */
const MAX_NAMES = 12

interface Plan {
  /** Chips shown; the rest wait behind the count. */
  k: number
  /** The first chip shrinks to leave room for the count (`--more-room`). */
  squeeze: number
}

let observer: ResizeObserver | null = null
/** The size each row was last fitted at: the observer's first report of a row a render just fitted is skipped. */
const fittedAt = new WeakMap<HTMLElement, string>()
/** The chips of each watched row that the observer watches too, each one's row, and its width at the last fit. */
const rowChips = new WeakMap<HTMLElement, Set<HTMLElement>>()
const chipRow = new WeakMap<Element, HTMLElement>()
const chipWidth = new WeakMap<Element, number>()
const queue = new Set<HTMLElement>()
let queued = false
let framed = 0

/** A chip's border-box width as the observer reports it. */
function reported(e: ResizeObserverEntry): number {
  const b = e.borderBoxSize?.[0]
  return b ? b.inlineSize : e.target.getBoundingClientRect().width
}

/**
 * Watch a chip row: fit it again whenever its size changes (a column resized, wrap switched, the window) or one of
 * its chips changes width without it. The fit runs in the next frame, never inside the observer's callback: a row
 * whose width follows its content (list rows) may change size by the fit itself, which inside the callback would be
 * an observer loop. Until then the CSS clip keeps every chip whole. Returns the unwatch.
 */
export function watchFit(el: HTMLElement): () => void {
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
  observer.observe(el)
  return () => {
    observer?.unobserve(el)
    for (const c of rowChips.get(el) ?? []) {
      observer?.unobserve(c)
      chipRow.delete(c)
    }
    rowChips.delete(el)
    queue.delete(el)
    // the row may stay (now one chip): nothing of the count is left behind
    apply(el, { k: Infinity, squeeze: 0 })
  }
}

/** Watch the row's chips as they are now (after a fit): new ones join, gone ones leave. Writes nothing to the DOM. */
function track(el: HTMLElement, chips: HTMLElement[]): void {
  if (!observer) return
  let set = rowChips.get(el)
  if (!set) rowChips.set(el, (set = new Set()))
  for (const c of set)
    if (c.parentElement !== el) {
      observer.unobserve(c)
      set.delete(c)
      chipRow.delete(c)
    }
  for (const c of chips)
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
    track(el, p.chips)
  })
}

function chipsOf(el: HTMLElement): { chips: HTMLElement[]; more: HTMLElement | null } {
  const chips: HTMLElement[] = []
  let more: HTMLElement | null = null
  for (const c of el.children) {
    if ((c as HTMLElement).classList.contains('db-more')) more = c as HTMLElement
    else chips.push(c as HTMLElement)
  }
  return { chips, more }
}

/** A chip's width with its whole name, also while it is shrunk (its name's hidden overflow added back). */
function natural(chip: HTMLElement): { w: number; fixed: number } {
  const name = chip.matches(NAME) ? chip : (chip.querySelector<HTMLElement>(NAME) ?? chip)
  const w = chip.offsetWidth
  const shown = name.clientWidth
  return { w: w + Math.max(0, name.scrollWidth - shown), fixed: name === chip ? 0 : Math.max(0, w - shown) }
}

const sizeKey = (w: number, h: number) => `${Math.round(w)}x${Math.round(h)}`

/** Reads only. */
function plan(el: HTMLElement): (Plan & { chips: HTMLElement[] }) | null {
  fittedAt.set(el, sizeKey(el.offsetWidth, el.offsetHeight))
  const { chips, more } = chipsOf(el)
  const n = chips.length
  // what the observer compares a chip's later reports with
  for (const c of chips) chipWidth.set(c, c.getBoundingClientRect().width)
  if (!more || n < 2) return { k: n, squeeze: 0, chips }
  // nothing below the clip (wrap mode, or every chip fits): all show, no count. Read from the chips, never the
  // row's scroll height — the unseen key (one line high, out of flow) is no chip waiting below
  const clip = el.clientHeight
  if (chips.every((c) => c.offsetTop < clip)) return { k: n, squeeze: 0, chips }
  const room = el.clientWidth
  const widths = chips.map(natural)
  // whole-pixel reads: a little slack so a chip that "just fits" never drops behind the count
  const slack = (i: number) => 1 + i * 0.5
  let total = 0
  for (let i = 0; i < n; i++) total += widths[i].w + (i ? GAP : 0)
  if (total <= room - slack(n)) return { k: n, squeeze: 0, chips }
  const count = more.offsetWidth
  let used = 0
  let k = 0
  for (let i = 0; i < n; i++) {
    const next = used + (i ? GAP : 0) + widths[i].w
    if (next + GAP + count > room - slack(i + 1)) break
    used = next
    k = i + 1
  }
  if (k) return { k, squeeze: 0, chips }
  // the first chip alone is wider than the room beside the count: it shrinks ("…" in its own border) —
  // unless not even its icon would fit, then the count stands alone
  const squeeze = GAP + count + 1
  return widths[0].fixed + 12 + squeeze <= room ? { k: 1, squeeze, chips } : { k: 0, squeeze: 0, chips }
}

/** Writes only — and only what changed. */
function apply(el: HTMLElement, p: Plan): void {
  const { chips, more } = chipsOf(el)
  const n = chips.length
  const hiding = p.k < n && !!more
  chips.forEach((c, i) => {
    const off = hiding && i >= p.k
    if (c.hasAttribute('data-off') !== off) c.toggleAttribute('data-off', off)
  })
  if (el.hasAttribute('data-more') !== hiding) el.toggleAttribute('data-more', hiding)
  const squeeze = hiding && p.squeeze ? `${p.squeeze}px` : ''
  if (el.style.getPropertyValue('--more-room') !== squeeze) {
    if (squeeze) el.style.setProperty('--more-room', squeeze)
    else el.style.removeProperty('--more-room')
  }
  if (!more) return
  if (!hiding) {
    if (more.hasAttribute('data-count')) more.removeAttribute('data-count')
    if (more.hasAttribute('title')) more.removeAttribute('title')
    return
  }
  const hidden = chips.slice(p.k)
  const count = String(hidden.length > 99 ? '99+' : `+${hidden.length}`)
  const names = hidden.slice(0, MAX_NAMES).map((c) => (c.matches(NAME) ? c : (c.querySelector(NAME) ?? c)).textContent?.trim() ?? '')
  const title = t('database.chips.more', { count: hidden.length, names: names.filter(Boolean).join(', ') + (hidden.length > MAX_NAMES ? ', …' : '') })
  if (more.getAttribute('data-count') !== count) more.setAttribute('data-count', count)
  if (more.getAttribute('title') !== title) more.setAttribute('title', title)
}
