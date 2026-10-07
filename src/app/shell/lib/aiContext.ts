/**
 * "Copy for AI context": a page as Markdown for Claude Code, the AI terminal or any chat — its title, where it is
 * (path, One link, page id), a row's filled fields, a database's entries, the sub-pages, then the content Claude may
 * read (context marks; comments and button actions never leave — docToMarkdown). Nothing is sent anywhere: it goes
 * to the clipboard only.
 */
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, selectBreadcrumbs, selectRows } from '../../store/selectors'
import type { ID } from '../../store/types'
import { readableContent } from '../../editor'
import { propertyValueToText } from '../../database'
import { t } from '../../i18n'

const MAX_LIST = 50

const untitled = (title: string) => title.trim() || t('common.untitled')

/** The page as Markdown for an AI (null: no such page). */
export function pageForAI(id: ID, link: string): string | null {
  const s = useWorkspace.getState()
  const page = s.pages[id]
  if (!page || isEffectivelyTrashed(s.pages, id)) return null
  const parts: string[] = [`# ${untitled(page.title)}`]
  const path = selectBreadcrumbs(s.pages, id)
    .map((p) => untitled(p.title))
    .join(' › ')
  parts.push([`- ${t('shell.ai.path')}: ${path}`, `- ${t('shell.ai.link')}: ${link}`, `- ${t('shell.ai.id')}: ${id}`].join('\n'))
  const db = page.databaseId ? s.databases[page.databaseId] : undefined
  if (db) {
    const fields = db.properties
      .filter((p) => p.type !== 'title')
      .map((p) => [p.name, propertyValueToText(db, p, page).trim()] as const)
      .filter(([, v]) => v)
    if (fields.length) parts.push(`## ${t('shell.ai.fields')}\n${fields.map(([k, v]) => `- ${k}: ${v.replace(/\s+/g, ' ')}`).join('\n')}`)
  }
  if (s.databases[id]) {
    const rows = selectRows(s.pages, id).filter((r) => !r.trashed)
    if (rows.length) parts.push(`## ${t('shell.ai.entries')} (${rows.length})\n${rows.slice(0, MAX_LIST).map((r) => `- ${untitled(r.title)} (${r.id})`).join('\n')}${rows.length > MAX_LIST ? '\n- …' : ''}`)
  }
  const children = Object.values(s.pages).filter((p) => p.parentId === id && !p.databaseId && !p.trashed && !inTemplate(s.pages, p.id))
  if (children.length) parts.push(`## ${t('shell.ai.subpages')}\n${children.slice(0, MAX_LIST).map((p) => `- ${untitled(p.title)} (${p.id})`).join('\n')}`)
  const body = readableContent(id).markdown
  if (body) parts.push(`## ${t('shell.ai.content')}\n\n${body}`)
  return parts.join('\n\n')
}
