/**
 * Per-field trust — which trust keys (store/autonomy.ts) a staged change writes, and how a key reads on the plate.
 * Pure (a Node spec loads it): the workspace and the translator come in as arguments.
 */
import type { Translate } from '@/shared/i18n'
import type { Database, ID, Page, Workspace } from '../../../store/types'
import { TRUST_KEY_RE, parseTrustKey, propTrustKey, rowTrustKey, type TrustKey } from '../../../store/autonomy'
import type { StagedChange } from '../../ai/agent/types'

const valid = (k: string): k is TrustKey => TRUST_KEY_RE.test(k)

/**
 * The keys a staged change writes (`resolveRow`: a staged row / page id → the real id). update_row: one per property
 * (the database from the change, else the resolved row's); create_row: the database; append / rename / edit: the row's
 * database, else the page; create_page: its parent ('-' = top level); every other kind: none. Keys that would not fit
 * the grammar are left out.
 */
export function keysOfChange(c: StagedChange, resolveRow: (id: ID) => ID, pages: Record<ID, Page>): TrustKey[] {
  const keys: string[] = []
  switch (c.kind) {
    case 'update_row': {
      const row = resolveRow(c.pageId)
      const db = c.databaseId ?? pages[row]?.databaseId
      if (!db) return []
      const seen = new Set<string>()
      for (const p of c.props ?? []) {
        if (seen.has(p.propId)) continue
        seen.add(p.propId)
        keys.push(propTrustKey(db, p.propId))
      }
      break
    }
    case 'create_row': {
      const db = c.databaseId ?? null
      if (db) keys.push(rowTrustKey(resolveRow(db)))
      break
    }
    case 'append':
    case 'rename':
    case 'edit': {
      const id = resolveRow(c.pageId)
      keys.push(`${c.kind}:${pages[id]?.databaseId ?? id}`)
      break
    }
    case 'create_page': {
      const parent = c.parentId ? resolveRow(c.parentId) : null
      keys.push(`page:${parent ?? '-'}`)
      break
    }
    default:
      return []
  }
  return keys.filter(valid)
}

export interface KeyLabel {
  /** the field ("Neuer Kommentar"), "Neue Zeile", "Anhängen · Bericht" … */
  name: string
  /** the micro-label: the property type (HAKEN · AUSWAHL · TEXT …) or the kind of change (ANLEGEN …) */
  kind: string
  /** the database (or the page) it is about ('' for a new top-level page) */
  db: string
}

const titleOf = (pages: Record<ID, Page>, id: ID, t: Translate) => pages[id]?.title.trim() || t('common.untitled')

/** How a key reads on the plate and in the run (`s`: the workspace now). */
export function keyLabel(k: TrustKey, s: Pick<Workspace, 'pages' | 'databases'>, t: Translate): KeyLabel {
  const p = parseTrustKey(k)
  if (!p) return { name: k, kind: '', db: '' }
  switch (p.kind) {
    case 'prop': {
      const db: Database | undefined = s.databases[p.db]
      const prop = db?.properties.find((d) => d.id === p.prop)
      return {
        name: prop?.name.trim() || t('features.agents.trust.key.goneProp'),
        kind: prop ? t(`features.agents.trust.kind.${prop.type}`) : '',
        db: titleOf(s.pages, p.db, t),
      }
    }
    case 'row':
      return { name: t('features.agents.trust.key.row'), kind: t('features.agents.trust.kind.row'), db: titleOf(s.pages, p.db, t) }
    case 'append':
    case 'rename':
    case 'edit': {
      const title = titleOf(s.pages, p.target, t)
      return { name: t(`features.agents.trust.key.${p.kind}`, { title }), kind: t(`features.agents.trust.kind.${p.kind}`), db: title }
    }
    case 'page': {
      const title = p.parent ? titleOf(s.pages, p.parent, t) : ''
      return { name: p.parent ? t('features.agents.trust.key.page', { title }) : t('features.agents.trust.key.pageTop'), kind: t('features.agents.trust.kind.page'), db: title }
    }
  }
}
