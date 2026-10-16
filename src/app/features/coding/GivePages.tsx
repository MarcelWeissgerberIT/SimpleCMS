/**
 * "Give the page" under Claude's question: the pages it names in quotes — „…“, "…", '…' — that are the exact title of a
 * live page here (coding/pagePick.ts suggestPages). One key per page puts it into the answer as "@Title" (the answer
 * field keeps the focus; nothing is sent by itself); a name several pages carry lists each with where it lives. A page
 * in the answer already, or one that goes along anyway, shows so.
 */
import { useMemo, type RefObject } from 'react'
import { Check, Plus } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { useT } from '../../i18n'
import { suggestPages } from './pagePick'
import { livePicks, type RefDraft } from './refDraft'
import { refPlan } from './refs'
import type { RefFieldHandle } from './RefField'

export function GivePages({ question, taskId, draft, allowPrivate, field }: { question: string; taskId: ID; draft: RefDraft; allowPrivate: boolean; field: RefObject<RefFieldHandle | null> }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const list = useMemo(() => suggestPages(question, taskId, allowPrivate), [question, taskId, allowPrivate, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  // what goes along anyway (the task's own pages and those linked in them)
  const along = useMemo(() => (list.length ? new Set(refPlan(taskId).pages.map((p) => p.id)) : new Set<ID>()), [list, taskId, pages]) // eslint-disable-line react-hooks/exhaustive-deps
  const picked = new Set(livePicks(draft).map((p) => p.id))
  if (!list.length) return null

  const chip = (p: { id: ID; title: string; path: string }, withPath: boolean) => {
    const state = picked.has(p.id) ? 'picked' : along.has(p.id) ? 'along' : null
    return (
      <button
        key={p.id}
        type="button"
        className="ctk-give__chip"
        data-state={state ?? undefined}
        disabled={!!state}
        title={state ? undefined : t('features.coding.give.add', { title: p.title })}
        // a click leaves the focus in the answer (the page goes in at its caret)
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => field.current?.add({ id: p.id, title: p.title })}
        data-testid="coding-give-chip"
      >
        {state ? <Check size={12} strokeWidth={2} aria-hidden /> : <Plus size={12} strokeWidth={2} aria-hidden />}
        <span className="ctk-give__title">{p.title}</span>
        {withPath && <span className="ctk-give__path">{p.path || t('features.coding.give.top')}</span>}
        {state && <span className="ctk-give__state">{t(`features.coding.give.${state}`)}</span>}
      </button>
    )
  }

  return (
    <div className="ctk-give" role="group" aria-label={t('features.coding.give.label')} data-testid="coding-give">
      <span className="label ctk-give__label">{t('features.coding.give.label')}</span>
      <div className="ctk-give__list">
        {list.map((s) =>
          s.pages.length === 1 ? (
            chip(s.pages[0]!, false)
          ) : (
            <div key={s.name} className="ctk-give__many" role="group" aria-label={t('features.coding.give.many', { name: s.name, n: s.pages.length })}>
              <span className="ctk-give__name">{t('features.coding.give.many', { name: s.name, n: s.pages.length })}</span>
              {s.pages.map((p) => chip(p, true))}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
