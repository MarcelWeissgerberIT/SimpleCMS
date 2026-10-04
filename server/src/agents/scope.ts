/**
 * What a server agent may see: the workspace's shared meta document only (another member's private
 * pages live in their own documents and are never read), without the trash and templates
 * (`outOfReach`), and — unless its scope is "everything" — only the pages, databases and rows below
 * the pages and databases its scope names.
 */
import { type PageInfo, type PropertyDef, type Roots, outOfReach, pageMap } from '../api/meta.ts'
import { friendly, type ValueContext } from '../api/values.ts'
import type { AgentScope } from './types.ts'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A page, row or database the agent may read and (with its write mode) change. */
export function inScope(r: Roots, scope: AgentScope, id: string): boolean {
  if (!pageMap(r, id) || outOfReach(r, id)) return false
  if (scope.everything) return true
  const roots = new Set([...scope.pages, ...scope.databases])
  const seen = new Set<string>()
  let cur: string | null = id
  while (cur && !seen.has(cur)) {
    if (roots.has(cur)) return true
    seen.add(cur)
    const parent: unknown = pageMap(r, cur)?.get('parentId')
    cur = typeof parent === 'string' && parent ? parent : null
  }
  return false
}

/**
 * Related rows outside the scope keep their id but lose their title: a relation value of an
 * in-scope row must not reveal what the agent may not read. (Friendly values: `{ id, title }`.)
 */
export function redact(r: Roots, scope: AgentScope, value: unknown): unknown {
  if (scope.everything || !Array.isArray(value)) return value
  return value.map((v) => (isObj(v) && typeof v.id === 'string' && 'title' in v && !inScope(r, scope, v.id) ? { id: v.id, title: '(outside this agent’s scope)' } : v))
}

/** A friendly value as one line of display text ('' = empty). */
export function displayText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(displayText).filter(Boolean).join(', ')
  if (isObj(v)) {
    if (typeof v.start === 'string') {
      const start = v.start.replace('T', ' ')
      return typeof v.end === 'string' && v.end ? `${start} → ${v.end.replace('T', ' ')}` : start
    }
    if (typeof v.title === 'string') return v.title || 'Untitled'
    if (typeof v.name === 'string' && v.name) return v.name
    if (typeof v.email === 'string') return v.email
    if (typeof v.kind === 'string') return v.kind
  }
  return ''
}

/** The display text of a property's value on a row (or on a value about to be stored). */
export function valueText(prop: PropertyDef, row: Pick<PageInfo, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'properties'>, ctx: ValueContext): string {
  try {
    return displayText(friendly(prop, row, ctx))
  } catch {
    return ''
  }
}
