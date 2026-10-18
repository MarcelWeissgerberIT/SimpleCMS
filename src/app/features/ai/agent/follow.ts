/**
 * What an MCP call left on a page, and what counts as "changed since" for its Undo (spec § 3.2: an Undo leaves anything
 * changed since alone). One baseline shape (`MadeAs`) for every Undo that compares a page with how the call left it — a
 * page / row it made (apply.ts removeCreated), a row it moved (mcp/tidy.ts), a page a script run started over MCP wrote
 * (mcp/script.ts) — and one way to keep that baseline in step with what the call itself set off since (`followCall`).
 */
import type { ID, Page } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { contentKey } from '../../history/snapshots'
import { currentWriter, formatWriterKey, type Writer, type WriterKey } from '../../../store/writer'

/** A page as a call left it: its text (rev + key), title, icon, cover, comment threads and stored values. */
export interface MadeAs {
  rev: number | undefined
  key: string
  title: string | undefined
  icon: string
  cover: string
  comments: string
  props: Record<string, unknown>
}

const json = (v: unknown) => JSON.stringify(v ?? null)
/** Comment threads as a fingerprint (none and an empty list are the same). */
const threads = (p: Page | undefined) => (p?.comments?.length ? JSON.stringify(p.comments) : 'null')

export const madeAs = (p: Page | undefined): MadeAs => ({
  rev: p?.contentRev,
  key: contentKey(p?.content),
  title: p?.title,
  icon: json(p?.icon),
  cover: json(p?.cover),
  comments: threads(p),
  props: { ...(p?.properties ?? {}) },
})

/** One value as valuesKey counts it (an emptied value is none). */
export const valueKey = (v: unknown) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? '' : JSON.stringify(v))

/** A row's values as a key: the order of keys and an emptied value (null, '', []) do not count as a change. */
export function valuesKey(props: Record<string, unknown> | undefined): string {
  const keys = Object.keys(props ?? {}).sort()
  const out: Array<[string, unknown]> = []
  for (const k of keys) {
    const v = props![k]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    out.push([k, v])
  }
  return JSON.stringify(out)
}

/** Did the text move away from the baseline (the same content written again counts as unchanged)? */
export const textMoved = (now: Page, b: MadeAs) => now.contentRev !== b.rev && contentKey(now.content) !== b.key

/** Changed since the baseline: text, title, icon, cover, comment threads or a stored value (its place is the caller's). */
export const changedSince = (now: Page, b: MadeAs): boolean =>
  textMoved(now, b) || now.title !== b.title || json(now.icon) !== b.icon || json(now.cover) !== b.cover || threads(now) !== b.comments || valuesKey(now.properties) !== valuesKey(b.props)

/** The writers a derived writer names as its cause chain (its key's causes, its raw cause one level deeper); null: none. */
export function causesOf(w: Writer | null): Set<string> | null {
  if (!w || w.kind === 'mcp') return null
  const raw = w.kind === 'script' ? w.via : 'cause' in w ? w.cause : undefined
  if (typeof raw !== 'string' || !raw) return null
  return new Set([...formatWriterKey(w).split('<').slice(1), ...raw.split('<')])
}

/** Move the baseline by what this write changed of a page, part by part, where that part was still as the call left it. */
function moveBase(b: MadeAs, before: Page, now: Page): void {
  if (now.contentRev !== before.contentRev && (before.contentRev === b.rev || contentKey(before.content) === b.key)) {
    b.rev = now.contentRev
    b.key = contentKey(now.content)
  }
  if (now.title !== before.title && before.title === b.title) b.title = now.title
  for (const [part, of] of [
    ['icon', (p: Page) => json(p.icon)],
    ['cover', (p: Page) => json(p.cover)],
    ['comments', threads],
  ] as const) {
    const was = of(before)
    if (of(now) !== was && was === b[part]) b[part] = of(now)
  }
  if (now.properties !== before.properties) {
    for (const k of new Set([...Object.keys(before.properties ?? {}), ...Object.keys(now.properties ?? {})])) {
      const was = valueKey(before.properties?.[k])
      if (valueKey(now.properties?.[k]) !== was && was === valueKey(b.props[k])) b.props[k] = now.properties?.[k]
    }
  }
}

interface Follow {
  id: ID
  calls: ReadonlySet<string>
  base: MadeAs
}

/**
 * Pages followed for their calls: what the call itself set off since — a row_created / property_changed automation,
 * autofill, the kit, a script an automation ran (a derived writer whose `cause` chain names the call, store/writer.ts) —
 * counts as the page as the call left it, so its Undo still takes it back. Such a write moves only the parts it changed,
 * and only while they were still as the call left them (an edit of the person's before it stays an edit); anyone
 * else's write never moves the baseline. One store listener for all, idle unless such a writer writes.
 */
const followed = new Set<Follow>()
let unfollow: (() => void) | null = null

/**
 * Follow page `id` from `base` (as the call left it) for the writes `calls` (writer keys: the call's, a script run it
 * started …) set off. `base()` reads the baseline now; `stop()` ends the follow (call it when the Undo ran or went).
 */
export function followCall(id: ID, calls: WriterKey | readonly WriterKey[], base: MadeAs): { base: () => MadeAs; stop: () => void } {
  const f: Follow = { id, calls: new Set(typeof calls === 'string' ? [calls] : calls), base }
  followed.add(f)
  unfollow ??= useWorkspace.subscribe((s, prev) => {
    // only a write some other write set off (an automation, autofill, the kit, a script …) can move a baseline
    const causes = causesOf(currentWriter())
    if (!causes) return
    for (const g of followed) {
      const now = s.pages[g.id]
      const before = prev.pages[g.id]
      if (!now) followed.delete(g)
      else if (before && now !== before && [...g.calls].some((c) => causes.has(c))) moveBase(g.base, before, now)
    }
  })
  return {
    base: () => f.base,
    stop: () => {
      followed.delete(f)
      if (!followed.size && unfollow) {
        unfollow()
        unfollow = null
      }
    },
  }
}
