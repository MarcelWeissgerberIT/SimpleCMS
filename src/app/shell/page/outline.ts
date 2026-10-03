/**
 * The margin rail's outline: headings H1–H3 and toggle headings (`details` with attrs.heading)
 * read from the page's editor, a scroll-spy (IntersectionObserver — no work per scroll frame)
 * and the jump to a heading (opening closed toggles / hidden tabs on the way).
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
  // a jump pins the clicked entry until the smooth scroll settled
  const pinned = useRef(0)

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
    const onTr = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged || timer) return
      timer = window.setTimeout(read, 160)
    }
    editor.on('transaction', onTr)
    return () => {
      editor.off('transaction', onTr)
      window.clearTimeout(timer)
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
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = index.get(e.target as HTMLElement)
          if (i === undefined) continue
          const r = e.boundingClientRect
          // folded away (closed toggle, hidden tab): never the section being read
          passed[i] = e.isIntersecting && (r.width > 0 || r.height > 0)
        }
        if (Date.now() < pinned.current) return
        setActive(passed.lastIndexOf(true))
      },
      // the band reaches from far above the column down to its top quarter: crossing that line
      // flips the state in either direction, even when a jump skips a whole screen
      { root: host, rootMargin: '1000000px 0px -75% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [els])

  const pin = (i: number) => {
    pinned.current = Date.now() + 700
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

/** Scroll the page column to the n-th outline heading and flash it. */
export function jumpToHeading(editor: Editor | null, n: number): boolean {
  if (!editor || editor.isDestroyed) return false
  const el = headingEls(editor)[n]
  if (!el || el === editor.view.dom) return false
  const host = scrollHostOf(el)
  const go = () => {
    if (!el.isConnected) return
    if (host) {
      const top = el.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - 28
      host.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' })
    } else el.scrollIntoView({ block: 'start' })
    el.classList.remove('is-target')
    void el.offsetWidth // restart the flash when the same heading is picked twice
    el.classList.add('is-target')
    window.setTimeout(() => el.classList.remove('is-target'), 2200)
  }
  // revealed content lays out on the next frames (the tabs view re-renders through React)
  if (reveal(el, editor.view.dom as HTMLElement)) requestAnimationFrame(() => requestAnimationFrame(go))
  else go()
  return true
}
