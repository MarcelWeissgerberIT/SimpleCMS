/**
 * The workspace as a decision's route may read it (state.ts's StateWorld), built from the store and what the gate
 * decided for the request: its page filter (`visible`), whether names may go (`redact.people`), one redactor per
 * request, a row's fields through rowFactsFor and page text through docToMarkdown inside the route's shape.
 */
import { createRedactor } from '@/shared/ai/redact'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { docToMarkdown } from '../../../editor'
import type { Prepared } from '../core/gate'
import { hiddenLabel, shapeOf, withShape } from '../core/shape'
import { rowFactsFor } from '../rowFacts'
import type { StateWorld } from './state'

export function stateWorld(pre: Pick<Prepared, 'sees' | 'redact' | 'visible' | 'allows'>, scope: ((id: ID) => boolean) | null): StateWorld {
  const s = useWorkspace.getState()
  const shape = shapeOf(pre)
  const people = new Set((s.people ?? []).map((p) => p.id))
  const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
  return {
    pages: s.pages,
    databases: s.databases,
    isId: (tok) => own(s.pages, tok) || own(s.databases, tok) || people.has(tok),
    visible: pre.visible,
    people: !pre.redact.people,
    redactor: shape?.r ?? createRedactor(),
    hidden: hiddenLabel(),
    rowFacts: (db, row) => rowFactsFor(db, row, { shape, visible: pre.visible }),
    markdown: (doc) => withShape(shape, () => docToMarkdown(doc)),
    inScope: scope,
  }
}
