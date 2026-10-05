/**
 * "This script would: send 1 mail to anna@…, change 3 entries in Tasks, create 1 page" — the plain
 * summary of what a dry run planned (or a run did). Lines in the UI language.
 */
import type { Translate } from '@/shared/i18n'
import { useWorkspace } from '../../../store/store'
import type { ChangeItem, EffectItem } from '../runtime/types'

export interface SummaryLine {
  key: string
  text: string
  /** the rows / pages it is about (expandable) */
  items?: ChangeItem[]
}

const pick = (n: number) => (n === 1 ? 'one' : 'other')

export function summarize(changes: ChangeItem[], effects: EffectItem[], mode: 'dry' | 'run', t: Translate): SummaryLine[] {
  const pages = useWorkspace.getState().pages
  const dbName = (id: string | null) => (id ? pages[id]?.title.trim() || t('common.untitled') : '')
  const k = (name: string, n: number) => `features.script.sum.${mode}.${name}.${pick(n)}`
  const out: SummaryLine[] = []
  for (const e of effects) {
    if (e.status === 'skipped') continue
    if (e.kind === 'mail') out.push({ key: e.key, text: t(`features.script.sum.${mode}.mail`, { to: e.label }) })
    if (e.kind === 'http') out.push({ key: e.key, text: t(`features.script.sum.${mode}.http`, { to: e.label }) })
  }
  const asks = effects.filter((e) => e.kind === 'claude' && e.status !== 'skipped').length
  if (asks) out.push({ key: 'claude', text: t(k('claude', asks), { n: asks }) })

  const live = changes.filter((c) => !c.skipped)
  const group = (kind: ChangeItem['kind'], withDb: boolean) => {
    const by = new Map<string, ChangeItem[]>()
    for (const c of live) {
      if (c.kind !== kind || !!c.dbId !== withDb) continue
      const key = c.dbId ?? ''
      by.set(key, [...(by.get(key) ?? []), c])
    }
    return by
  }
  for (const [db, list] of group('set', true)) out.push({ key: `set:${db}`, text: t(k('setRows', list.length), { n: list.length, db: dbName(db) }), items: list })
  for (const [, list] of group('set', false)) out.push({ key: 'set:pages', text: t(k('setPages', list.length), { n: list.length }), items: list })
  const content = live.filter((c) => c.kind === 'content')
  if (content.length) out.push({ key: 'content', text: t(k('content', content.length), { n: content.length, page: content[0].title || t('common.untitled') }), items: content })
  for (const [db, list] of group('create', true)) out.push({ key: `create:${db}`, text: t(k('createRows', list.length), { n: list.length, db: dbName(db) }), items: list })
  for (const [, list] of group('create', false)) out.push({ key: 'create:pages', text: t(k('createPages', list.length), { n: list.length }), items: list })
  const trash = live.filter((c) => c.kind === 'trash')
  if (trash.length) out.push({ key: 'trash', text: t(k('trash', trash.length), { n: trash.length }), items: trash })
  return out
}
