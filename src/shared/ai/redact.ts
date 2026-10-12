/**
 * Redaction (design § 10.4, D40, D-S2-28): request text for a route that may not receive people's names or meeting
 * transcripts — or not see every page — is built from the page JSON through redactDoc, then serialised. Pure (the team
 * server compiles it): a JSON walk, no DOM, no store.
 *  - people: every person mention label (and a task's frozen owner names) → "Person n", numbered by first appearance,
 *    stable per Redactor (one per request); the map never leaves the tab. Person property values go through
 *    redactPersonValue (row facts). Inside withRedaction(r, fn) the task serializer names owners "@Person n" too.
 *  - transcript: a meeting block's transcript is left out (its notes are page text and stay).
 *  - visible: a mention / page link / inline database of a page the route may not see reads "[Page]"; a synced-block
 *    copy whose source it may not see is left out.
 * Free text and titles are not redacted (redaction is structural — the help says so).
 */

/** A TipTap JSON node, as far as redaction reads it. */
export interface RedactNode {
  type?: string
  attrs?: Record<string, unknown>
  content?: RedactNode[]
  text?: string
  marks?: unknown[]
  [k: string]: unknown
}

/** Numbers people for one request: the same person (by id, else by name) is the same "Person n" throughout. */
export interface Redactor {
  /** "Person n" for a person's id or name */
  person(key: string): string
}

export function createRedactor(): Redactor {
  const seen = new Map<string, number>()
  return {
    person(key: string) {
      const k = key.trim()
      let n = seen.get(k)
      if (n === undefined) {
        n = seen.size + 1
        seen.set(k, n)
      }
      return `Person ${n}`
    },
  }
}

export interface RedactOptions {
  /** redact people's names */
  people: boolean
  /** leave meeting transcripts out */
  transcript: boolean
  /** may the route see this page? (absent: every page) */
  visible?: (pageId: string) => boolean
  /** what a page the route may not see reads as ("[Page]" / "[Seite]") */
  hidden?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * The doc as a route may receive it (a new object; the input is never changed). Identity when nothing applies — the
 * caller keeps today's bytes then (a route that sees everything never comes here).
 */
export function redactDoc<T extends RedactNode>(doc: T, o: RedactOptions, r: Redactor): T {
  const hidden = o.hidden ?? '[Page]'
  const unseen = (id: unknown) => !!o.visible && typeof id === 'string' && !!id && !o.visible(id)
  const walk = (n: RedactNode): RedactNode | null => {
    const a = n.attrs ?? {}
    if (n.type === 'mention') {
      if (a.kind === 'person' && o.people) return { ...n, attrs: { ...a, label: r.person(str(a.id) || str(a.label)) } }
      if ((a.kind === 'page' || a.kind === undefined || a.kind === null) && unseen(a.id)) return { type: 'text', text: hidden }
      return n
    }
    if ((n.type === 'pageLink' && unseen(a.pageId)) || (n.type === 'databaseBlock' && unseen(a.databaseId))) return { type: 'paragraph', content: [{ type: 'text', text: hidden }] }
    // a synced copy is content of its source page: left out where the route may not see that page
    if (n.type === 'syncedBlock' && unseen(a.sourcePageId)) return null
    let out: RedactNode = n
    if (n.type === 'meetingNotes' && o.transcript && Array.isArray(a.transcript) && a.transcript.length) out = { ...out, attrs: { ...a, transcript: [] } }
    if (n.type === 'workItem' && o.people) {
      const f = a.frozen as { people?: unknown } | null | undefined
      if (f && Array.isArray(f.people) && f.people.length) out = { ...out, attrs: { ...(out.attrs ?? a), frozen: { ...f, people: f.people.map((x) => r.person(str(x))) } } }
    }
    if (Array.isArray(n.content)) {
      const kids = n.content.map(walk).filter((x): x is RedactNode => x !== null)
      if (kids.length !== n.content.length || kids.some((k, i) => k !== n.content![i])) out = { ...out, content: kids }
    }
    return out
  }
  return (walk(doc) ?? { ...doc, content: [] }) as T
}

/** A person value (an id or a name) as a route without `people` reads it: "@Person n". */
export const redactPersonValue = (key: string, r: Redactor): string => `@${r.person(key)}`

/* ------------------------------------------------------------------ */
/* The scope serializers consult (sync only — the withItemLabels pattern) */
/* ------------------------------------------------------------------ */

interface Scope {
  r: Redactor
  /** what the Markdown serializers apply to every doc they write inside the scope (absent: owners only) */
  o?: RedactOptions
}

let current: Scope | null = null

/**
 * Runs `fn` (synchronously) as request text for a route that may not see everything: the task serializer names owners
 * "@Person n" (people redacted), and with `o` the Markdown serializers run every doc through redactDoc first — so
 * whatever builds request text inside the scope (a page, a selection, blocks to transform) is built for the route.
 */
export function withRedaction<T>(r: Redactor | null, fn: () => T, o?: RedactOptions): T {
  const before = current
  current = r ? { r, ...(o ? { o } : {}) } : null
  try {
    return fn()
  } finally {
    current = before
  }
}

/** The people redactor a serializer runs under (null: none — names as they are). */
export const currentRedactor = (): Redactor | null => (current && (!current.o || current.o.people) ? current.r : null)

/** The request-text scope open now (its redactor and options; null: none). */
export const currentRedaction = (): { r: Redactor; o?: RedactOptions } | null => current

/** Is request text being built for a route that does not see everything right now? */
export const redactionActive = (): boolean => current !== null

/** A doc as the current scope lets it go (the doc itself outside a scope, or when the scope redacts nothing of it). */
export const redactInScope = <T extends RedactNode>(doc: T): T => (current?.o ? redactDoc(doc, current.o, current.r) : doc)
