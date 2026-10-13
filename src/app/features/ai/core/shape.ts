/**
 * Request text built for the route (D-S2-28): every call site that builds text from pages runs
 *
 *   const pre = precheck({ purpose, sources, route })            // the route, its redaction and page filter
 *   const text = withShape(shapeOf(pre), () => build())           // names / transcripts / pages it may not see left out
 *   await facade({ …, ...routed(pre) })                           // the same route; `applied` tells the gate's backstop
 *
 * shapeOf() is null for a route that sees everything (Claude without rules): withShape() is then the call itself and the
 * text keeps today's bytes. Inside the scope the Markdown serializers (editor docToMarkdown / docToFileMarkdown) run every
 * doc through redactDoc and the task serializer names owners "@Person n" (src/shared/ai/redact.ts). Plain text (`plain`,
 * textContent) is never shaped: a call site that sends it switches to Markdown when shapeOf() is not null.
 */
import { createRedactor, currentRedaction, withRedaction, type RedactOptions, type Redactor } from '@/shared/ai/redact'
import { routeKey } from '@/shared/ai/route'
import type { Route } from '@/shared/ai/types'
import { useWorkspace } from '../../../store/store'
import type { Applied, Prepared } from './gate'

export interface Shape {
  r: Redactor
  o: RedactOptions
}

/** How a page the route may not see reads in request text. */
export const hiddenLabel = (): string => (useWorkspace.getState().settings.language === 'de' ? '[Seite]' : '[Page]')

const PERSON_LIKE = new Set(['person', 'created_by', 'last_edited_by'])

/**
 * May a chart over database `dbId` label its data by field `propId` for this route? Not a person-like field when names
 * are redacted, not a relation into a database the route may not see (or into a Contacts directory when names are
 * redacted), not a formula / rollup (its value could spell either out). The computed Type column and fields of its own
 * kind (select, date, number …) may.
 */
function chartAxisFor(pre: Pick<Prepared, 'redact' | 'visible'>) {
  return (dbId: string, propId: string): boolean => {
    const s = useWorkspace.getState()
    const p = s.databases[dbId]?.properties.find((x) => x.id === propId)
    if (!p) return propId === '__type__' // TYPE_PROP_ID: the computed Type column (record type names)
    if (PERSON_LIKE.has(p.type)) return !pre.redact.people
    if (p.type === 'relation') {
      const target = p.relationDatabaseId
      if (!target || !pre.visible(target)) return false
      return !(pre.redact.people && s.databases[target]?.system === 'mail-contacts')
    }
    return p.type !== 'formula' && p.type !== 'rollup'
  }
}

/** The route's shaping (null: it sees everything — the text stays as it is). One redactor per request. */
export function shapeOf(pre: Pick<Prepared, 'sees' | 'redact' | 'visible'> & Partial<Pick<Prepared, 'allows'>>): Shape | null {
  if (pre.sees === 'all') return null
  return {
    r: createRedactor(),
    o: { people: pre.redact.people, transcript: pre.redact.transcript, visible: pre.visible, hidden: hiddenLabel(), rows: pre.allows ? pre.allows('rows') : false, chartAxis: chartAxisFor(pre) },
  }
}

/** Run `fn` (synchronously) as request text for the route's shape (none: as it is). */
export function withShape<T>(shape: Shape | null, fn: () => T): T {
  return shape ? withRedaction(shape.r, fn, shape.o) : fn()
}

/** What a call site applied for the route (the gate's backstop checks it against the route it resolves again). */
export const appliedOf = (pre: Pick<Prepared, 'route'>): Applied => ({ people: true, transcript: true, visible: true, ...(pre.route ? { route: routeKey(pre.route) } : {}) })

/**
 * The facade options of a request whose text was built for `pre`: the same route, what its text went through, and who
 * picked the route — the person (a chip) or the gate (prepare() never moves a gate-pinned route — Regler G-D4).
 */
export const routed = (pre: Pick<Prepared, 'route'> & Partial<Pick<Prepared, 'level'>>): { route?: Route; applied: Applied; pinned: 'person' | 'gate' } => ({
  ...(pre.route ? { route: pre.route } : {}),
  applied: appliedOf(pre),
  pinned: pre.level === 'chip' ? 'person' : 'gate',
})

/** The shape of the request text being built now (a tool call of a route that does not see everything; null: none). */
export function currentShape(): Shape | null {
  const c = currentRedaction()
  return c?.o ? { r: c.r, o: c.o } : null
}
