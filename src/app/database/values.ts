/**
 * propertyValueToText — plain-text rendering of any property value (search, export, AI context).
 * Works outside React: reads the current workspace state.
 */
import type { Database, Page, PropertyDef } from '../store/types'
import { useWorkspace } from '../store/store'
import { Resolver } from './model/resolve'
import { currentMe, workspaceCtx } from './model/ctx'

let cached: { pages: unknown; databases: unknown; people: unknown; lang: string; minute: number; me: string; r: Resolver } | null = null

function resolver(): Resolver {
  const s = useWorkspace.getState()
  const lang = s.settings.language
  const minute = Math.floor(Date.now() / 60_000)
  const me = currentMe()
  const meKey = `${me.id ?? ''}\n${me.name}`
  // One resolver (formula / rollup cache) per workspace snapshot, language, minute (now()) and "me".
  if (cached && cached.pages === s.pages && cached.databases === s.databases && cached.people === s.people && cached.lang === lang && cached.minute === minute && cached.me === meKey) return cached.r
  const r = new Resolver(workspaceCtx(me))
  cached = { pages: s.pages, databases: s.databases, people: s.people, lang, minute, me: meKey, r }
  return r
}

export function propertyValueToText(db: Database, prop: PropertyDef, row: Page): string {
  if (prop.type === 'title') return row.title
  try {
    return resolver().text(db, prop, row)
  } catch {
    return ''
  }
}
