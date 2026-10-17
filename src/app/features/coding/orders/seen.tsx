/**
 * Work orders — "seen in full" on the plate (spec §1.5): a station counts as seen only once it was rendered whole — its
 * top and its bottom edge have each been on screen (an IntersectionObserver per edge; a station taller than the screen is
 * seen once it was scrolled through) — and a fold of a page that goes along counts only once it was opened. Keyed by
 * what the station shows (an edit makes it a new station: seen again). Per tab, in memory: a book per scope (a plan's run,
 * a gate's next step at its version) that outlives the plate — leaving the page or taking a chain back keeps what was seen.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

/** A short, stable key for a text (FNV-1a). */
export function keyOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export interface SeenBook {
  /** the keys seen so far (`<key>:top`, `<key>:bottom`, `fold:<key>`) */
  has: (key: string) => boolean
  mark: (key: string) => void
  /** both edges of `key` were on screen */
  whole: (key: string) => boolean
}

/** The books of this tab (the newest 50 scopes). */
const books = new Map<string, Set<string>>()
const BOOKS = 50
let version = 0
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const getVersion = () => version

function bookOf(scope: string): Set<string> {
  let book = books.get(scope)
  if (!book) {
    book = new Set()
    books.set(scope, book)
    if (books.size > BOOKS) books.delete(books.keys().next().value!)
  }
  return book
}

/** Outside React (Preflight's card keys): was `key` seen in `scope` · were both edges of `key` on screen. */
export const seenHas = (scope: string, key: string): boolean => books.get(scope)?.has(key) ?? false
export const seenWhole = (scope: string, key: string): boolean => seenHas(scope, `${key}:top`) && seenHas(scope, `${key}:bottom`)
/** Called whenever something was marked seen (any scope). Returns the unsubscribe. */
export const onSeen = (fn: () => void): (() => void) => subscribe(fn)

/** The book of what was seen in `scope` (another plan, another version: another scope — nothing seen yet). */
export function useSeenBook(scope: string): SeenBook {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  const mark = useCallback(
    (key: string) => {
      const book = bookOf(scope)
      if (book.has(key)) return
      book.add(key)
      version++
      for (const fn of [...listeners]) fn()
    },
    [scope],
  )
  const book = bookOf(scope)
  return { has: (k) => book.has(k), mark, whole: (k) => book.has(`${k}:top`) && book.has(`${k}:bottom`) }
}

/** An invisible edge of something that must be seen whole: marks `<key>:<edge>` once it was on screen. */
export function Edge({ id, edge, book }: { id: string; edge: 'top' | 'bottom'; book: SeenBook }) {
  const ref = useRef<HTMLSpanElement>(null)
  const key = `${id}:${edge}`
  const done = book.has(key)
  const mark = book.mark
  useEffect(() => {
    const el = ref.current
    if (!el || done) return
    if (typeof IntersectionObserver === 'undefined') {
      mark(key)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) mark(key)
    })
    io.observe(el)
    return () => io.disconnect()
  }, [key, done, mark])
  return <span ref={ref} className="orc-edge" data-edge={edge} aria-hidden />
}

/**
 * A fold whose content counts as seen only once it was opened (its key marked then). Its content mounts on the first
 * open (a page rendered read-only costs nothing while the fold is closed).
 */
export function SeenFold({ id, book, summary, children, testId, className = 'orc-fold', defaultOpen }: { id: string; book: SeenBook; summary: ReactNode; children: ReactNode; testId?: string; className?: string; defaultOpen?: boolean }) {
  const key = `fold:${id}`
  const [open, setOpen] = useState(!!defaultOpen)
  const seen = book.has(key)
  const mark = book.mark
  useEffect(() => {
    if (open) mark(key)
  }, [open, key, mark])
  return (
    <details className={className} open={open || undefined} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid={testId} data-seen={seen ? '' : undefined}>
      {summary}
      {(open || seen) && children}
    </details>
  )
}
