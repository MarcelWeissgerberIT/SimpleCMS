/**
 * The margin rail's outline: headings H1–H3 and toggle headings (`details` with attrs.heading)
 * read from the page's editor, a scroll-spy (IntersectionObserver — no work per scroll frame)
 * and the jumps to a heading or a date mention (opening closed toggles / hidden tabs on the way).
 */
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface OutlineItem {
  level: number
  text: string
  /** Block id (UniqueID) when the heading has one — React key only. */
  id: string | null
}

function levelOf(node: PMNode): number {
  if (node.type.name === 'heading') return Number(node.attrs.level) || 0
  if (node.type.name !== 'details') return 0
  const n = Number(node.attrs.heading)
  return n >= 1 && n <= 3 ? n : 0
}

/** Headings in document order with their positions (no descent into textblocks or atoms). */
function walk(doc: PMNode, visit: (node: PMNode, level: number, pos: number) => void) {
  doc.descendants((node, pos) => {
    const level = levelOf(node)
    if (level) visit(node, level, pos)
    if (node.type.name === 'heading') return false
    return node.isBlock && !node.isAtom && !node.isTextblock
  })
}

const titleOf = (node: PMNode) => (node.type.name === 'details' ? (node.firstChild?.textContent ?? '') : node.textContent).trim()

const cache = new WeakMap<PMNode, OutlineItem[]>()
/** Non-empty headings of a document (cached per document instance). */
export function outlineOf(doc: PMNode): OutlineItem[] {
  const hit = cache.get(doc)
  if (hit) return hit
  const out: OutlineItem[] = []
  walk(doc, (node, level) => {
    const text = titleOf(node)
    if (text) out.push({ level, text, id: (node.attrs.id as string | null) ?? null })
  })
  cache.set(doc, out)
  return out
}

/** DOM elements of the outline's headings, in outline order. */
function headingEls(editor: Editor): HTMLElement[] {
  const els: HTMLElement[] = []
  walk(editor.state.doc, (node, _level, pos) => {
    if (!titleOf(node)) return
    const el = editor.view.nodeDOM(pos)
    els.push(el instanceof HTMLElement ? el : (editor.view.dom as HTMLElement))
  })
  return els
}

function sameOutline(a: OutlineItem[], b: OutlineItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].level !== b[i].level || a[i].text !== b[i].text || a[i].id !== b[i].id) return false
  return true
}

/** Closest scrolling ancestor (the page column). */
export function scrollHostOf(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

const EMPTY: OutlineItem[] = []

/**
 * The outline of an editor plus the index of the section being read. The outline follows
 * document changes (debounced); the active section comes from an IntersectionObserver: a heading
 * counts as passed once it reached the top quarter of the scroll column.
 */
export function useOutline(editor: Editor | null, enabled: boolean): { items: OutlineItem[]; active: number; pin: (i: number) => void } {
  const [items, setItems] = useState<OutlineItem[]>(EMPTY)
  const [active, setActive] = useState(-1)
  const [els, setEls] = useState<HTMLElement[]>([])
  // a jump pins the picked entry until the reader moves on (wheel, touch, pointer, key): at the
  // end of a page several headings share the top of the column, the picked one stays lit
  const pinned = useRef(false)
  // re-read soon (document changed, or the editor re-rendered a heading the spy was watching)
  const reread = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled || !editor || editor.isDestroyed) {
      setItems(EMPTY)
      setEls([])
      return
    }
    let timer = 0
    const read = () => {
      timer = 0
      if (editor.isDestroyed) return
      const next = outlineOf(editor.state.doc)
      setItems((old) => (sameOutline(old, next) ? old : next))
      const nextEls = headingEls(editor)
      setEls((old) => (old.length === nextEls.length && old.every((el, i) => el === nextEls[i]) ? old : nextEls))
    }
    read()
    reread.current = () => {
      if (!timer) timer = window.setTimeout(read, 160)
    }
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) reread.current()
    }
    editor.on('transaction', onTr)
    return () => {
      editor.off('transaction', onTr)
      window.clearTimeout(timer)
      reread.current = () => {}
    }
  }, [editor, enabled])

  useEffect(() => {
    if (!els.length) {
      setActive(-1)
      return
    }
    const host = scrollHostOf(els[0])
    const passed = new Array<boolean>(els.length).fill(false)
    const index = new Map(els.map((el, i) => [el, i]))
    const unpin = (e: Event) => {
      if (!e.isTrusted || !pinned.current) return
      pinned.current = false
      setActive(passed.lastIndexOf(true))
    }
    const opts = { capture: true, passive: true }
    const kinds = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    kinds.forEach((k) => window.addEventListener(k, unpin, opts))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = index.get(e.target as HTMLElement)
          if (i === undefined) continue
          if (!e.target.isConnected) reread.current()
          const r = e.boundingClientRect
          // folded away (closed toggle, hidden tab): never the section being read
          passed[i] = e.isIntersecting && (r.width > 0 || r.height > 0)
        }
        if (!pinned.current) setActive(passed.lastIndexOf(true))
      },
      // the band reaches from far above the column down to its top quarter: crossing that line
      // flips the state in either direction, even when a jump skips a whole screen
      { root: host, rootMargin: '1000000px 0px -75% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => {
      io.disconnect()
      kinds.forEach((k) => window.removeEventListener(k, unpin, opts))
    }
  }, [els])

  const pin = (i: number) => {
    pinned.current = true
    setActive(i)
  }
  return { items, active, pin }
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Open what hides an element: closed toggles and inactive tabs around it (outermost first). */
function reveal(el: HTMLElement, root: HTMLElement): boolean {
  const chain: HTMLElement[] = []
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) chain.unshift(p)
  let changed = false
  for (const p of chain) {
    if (p.dataset.type === 'details' && !p.classList.contains('is-open')) {
      p.querySelector<HTMLButtonElement>(':scope > button')?.click()
      changed = true
    } else if (p.dataset.type === 'tab' && !p.getClientRects().length) {
      const tabs = p.closest<HTMLElement>('[data-type="tabs"]')
      const i = Array.from(p.parentElement?.children ?? []).indexOf(p)
      tabs?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]?.click()
      changed = true
    }
  }
  return changed
}

/**
 * A short signal tick in the gutter left of a heading (or line) — drawn in the scroll column, never in
 * the editor's DOM (ProseMirror re-renders a node whose attributes someone else touched).
 */
function markBlock(el: HTMLElement, host: HTMLElement) {
  host.querySelector(':scope > .mrail-mark')?.remove()
  const r = el.getBoundingClientRect()
  const h = host.getBoundingClientRect()
  const mark = document.createElement('div')
  mark.className = 'mrail-mark'
  mark.setAttribute('aria-hidden', 'true')
  mark.style.top = `${r.top - h.top + host.scrollTop}px`
  mark.style.left = `${r.left - h.left + host.scrollLeft - 16}px`
  mark.style.height = `${r.height}px`
  host.append(mark)
  window.setTimeout(() => mark.remove(), 1800)
}

/** Scroll the page column to the n-th outline heading and mark it. */
export function jumpToHeading(editor: Editor | null, n: number): boolean {
  if (!editor || editor.isDestroyed) return false
  return jumpTo(editor, headingEls(editor)[n])
}

/**
 * Scroll the page column to the block holding a date mention (a reminder of this page) and mark
 * it — the first mention of that date, preferably the one with that reminder code.
 */
export function jumpToDate(editor: Editor | null, iso: string, code: string): boolean {
  if (!editor || editor.isDestroyed) return false
  let exact = -1
  let first = -1
  editor.state.doc.descendants((node, pos) => {
    if (exact >= 0) return false
    if (node.type.name !== 'mention' || node.attrs.kind !== 'date' || node.attrs.id !== iso) return
    if (node.attrs.reminder === code) exact = pos
    else if (first < 0) first = pos
  })
  const pos = exact >= 0 ? exact : first
  if (pos < 0) return false
  // the text block around the mention: the tick marks a line, not a word
  const $pos = editor.state.doc.resolve(pos)
  const block = $pos.depth > 0 ? editor.view.nodeDOM($pos.before($pos.depth)) : editor.view.nodeDOM(pos)
  return jumpTo(editor, block instanceof HTMLElement ? block : null)
}

function jumpTo(editor: Editor, el: HTMLElement | null | undefined): boolean {
  if (!el || el === editor.view.dom) return false
  return scrollToBlock(el, editor.view.dom as HTMLElement)
}

/** Scroll the page column to an element and mark it, opening what hides it inside `root` first. */
export function scrollToBlock(el: HTMLElement, root?: HTMLElement): boolean {
  const host = scrollHostOf(el)
  const go = () => {
    if (!el.isConnected) return
    if (!host) return el.scrollIntoView({ block: 'start' })
    // the column undoes scrolls until the reader touches it (useColumnScroll's hold); a jump is
    // the reader's own wish — also when a screen reader activates the entry without a pointer
    host.dispatchEvent(new Event('pointerdown'))
    const top = el.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 28
    host.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' })
    markBlock(el, host)
  }
  // revealed content lays out on the next frames (the tabs view re-renders through React)
  if (root && reveal(el, root)) requestAnimationFrame(() => requestAnimationFrame(go))
  else go()
  return true
}
