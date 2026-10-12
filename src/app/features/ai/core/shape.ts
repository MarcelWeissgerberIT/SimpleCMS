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

/** The route's shaping (null: it sees everything — the text stays as it is). One redactor per request. */
export function shapeOf(pre: Pick<Prepared, 'sees' | 'redact' | 'visible'>): Shape | null {
  if (pre.sees === 'all') return null
  return { r: createRedactor(), o: { people: pre.redact.people, transcript: pre.redact.transcript, visible: pre.visible, hidden: hiddenLabel() } }
}

/** Run `fn` (synchronously) as request text for the route's shape (none: as it is). */
export function withShape<T>(shape: Shape | null, fn: () => T): T {
  return shape ? withRedaction(shape.r, fn, shape.o) : fn()
}

/** What a call site applied for the route (the gate's backstop checks it against the route it resolves again). */
export const appliedOf = (pre: Pick<Prepared, 'route'>): Applied => ({ people: true, transcript: true, visible: true, ...(pre.route ? { route: routeKey(pre.route) } : {}) })

/** The facade options of a request whose text was built for `pre`: the same route, and what its text went through. */
export const routed = (pre: Pick<Prepared, 'route'>): { route?: Route; applied: Applied } => ({ ...(pre.route ? { route: pre.route } : {}), applied: appliedOf(pre) })

/** The shape of the request text being built now (a tool call of a route that does not see everything; null: none). */
export function currentShape(): Shape | null {
  const c = currentRedaction()
  return c?.o ? { r: c.r, o: c.o } : null
}
