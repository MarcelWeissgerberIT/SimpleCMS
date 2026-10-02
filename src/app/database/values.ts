/**
 * propertyValueToText — plain-text rendering of any property value (search, export, AI context).
 * Works outside React: reads the current workspace state.
 */
import type { Database, Page, PropertyDef } from '../store/types'
import { useWorkspace } from '../store/store'
import { t } from '../i18n'
import { Resolver } from './model/resolve'

let cached: { pages: unknown; databases: unknown; people: unknown; lang: string; minute: number; r: Resolver } | null = null

function resolver(): Resolver {
  const s = useWorkspace.getState()
  const lang = s.settings.language
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  // One resolver (formula / rollup cache) per workspace snapshot, language and minute (now()).
  if (cached && cached.pages === s.pages && cached.databases === s.databases && cached.people === s.people && cached.lang === lang && cached.minute === minute) return cached.r
  const r = new Resolver({
    pages: s.pages,
    databases: s.databases,
    people: s.people,
    lang,
    now,
    labels: {
      today: t('database.date.today'),
      tomorrow: t('database.date.tomorrow'),
      yesterday: t('database.date.yesterday'),
      untitled: t('common.untitled'),
      yes: t('database.yes'),
      no: t('database.no'),
    },
  })
  cached = { pages: s.pages, databases: s.databases, people: s.people, lang, minute, r }
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
