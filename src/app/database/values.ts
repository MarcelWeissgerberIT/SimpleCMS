/**
 * propertyValueToText — plain-text rendering of any property value (search, export, AI context).
 * Works outside React: reads the current workspace state.
 */
import type { Database, Page, PropertyDef } from '../store/types'
import { useWorkspace } from '../store/store'
import { t } from '../i18n'
import { Resolver } from './model/resolve'

let cached: { key: unknown; r: Resolver } | null = null

function resolver(): Resolver {
  const s = useWorkspace.getState()
  // Reuse one resolver per workspace snapshot (formula / rollup cache).
  if (cached && cached.key === s.pages) return cached.r
  const r = new Resolver({
    pages: s.pages,
    databases: s.databases,
    people: s.people,
    lang: s.settings.language,
    now: Date.now(),
    labels: {
      today: t('database.date.today'),
      tomorrow: t('database.date.tomorrow'),
      yesterday: t('database.date.yesterday'),
      untitled: t('common.untitled'),
      yes: t('database.yes'),
      no: t('database.no'),
    },
  })
  cached = { key: s.pages, r }
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
