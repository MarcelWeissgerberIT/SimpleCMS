/**
 * "Goes along": the pages a task's next run sends to Claude Code as read-only text (coding/refs.ts nextPlan — the same
 * plan, version and order as the hand-out, tasks.ts pickNext) — @ mentions and links in the task, One addresses in the
 * answers and rework notes, the pages linked in those (↳) — live while an answer or a rework note is written (`draft`:
 * its pages are marked new). What does not go along is said, the first 5 names and a count (the rest in the tooltip);
 * how to give one only where it can be done (`ask`: the field that is open). A page opens in the side peek: the answer
 * being written stays. Screen readers hear a short count, not the whole row, while it changes.
 */
import { useMemo, type MouseEvent } from 'react'
import { CornerDownRight, FileText } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { MAX_REFS, nextPlan, refPagesOf, type RefPlan } from './refs'
import { useTaskLocal } from './local'
import { taskContext } from './tasks'

/** names shown of what does not go along (the rest counted, all in the tooltip up to TIP_NAMES) */
const SHOWN = 5
const TIP_NAMES = 40

/** A plain click (or Enter) opens the page beside the task — the panel and what is being written stay. */
function peek(e: MouseEvent<HTMLAnchorElement>, id: ID) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  useUI.getState().openPeek(id)
}

export function RefsLine({ taskId, draft = '', ask = null }: { taskId: ID; draft?: string; ask?: 'answer' | 'note' | null }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const local = useTaskLocal(taskId)
  const view = useMemo(() => {
    // as the worker's next hand-out picks them: this stage's answers and rework note first, the version's pages only
    const stageId = taskContext(taskId)?.stage?.id
    const plan = nextPlan(taskId, local, stageId, draft)
    const before = draft ? new Set(nextPlan(taskId, local, stageId).pages.map((p) => p.id)) : null
    return { ...plan, fresh: new Set(before ? plan.pages.filter((p) => !before.has(p.id)).map((p) => p.id) : []) }
  }, [taskId, pages, local, draft]) // eslint-disable-line react-hooks/exhaustive-deps
  const title = (id: ID) => pages[id]?.title.trim() || t('common.untitled')
  const quote = (id: ID) => t('features.coding.refs.quote', { title: title(id) })
  const groups = leftGroups(view.left)
  const list = (ids: ID[]) => {
    const shown = ids.slice(0, SHOWN).map(quote).join(', ')
    return ids.length > SHOWN ? `${shown} ${t('features.coding.refs.moreUi', { n: ids.length - SHOWN })}` : shown
  }
  const tip = (ids: ID[]) => (ids.length > SHOWN ? ids.slice(0, TIP_NAMES).map(quote).join(', ') + (ids.length > TIP_NAMES ? ' …' : '') : undefined)
  const askLine = ask === 'answer' ? t('features.coding.refs.askAnswer') : ask === 'note' ? t('features.coding.refs.askNote') : t('features.coding.refs.askTask')
  const sendable = groups.over.length + groups.kept.length > 0
  return (
    <div className="ctk-refs" data-testid="coding-refs">
      <span className="label">{t('features.coding.refs.label')}</span>
      {view.pages.length ? (
        <span className="ctk-refs__list">
          {view.pages.map((r) => (
            <a key={r.id} href={`#/p/${r.id}`} onClick={(e) => peek(e, r.id)} className="ctk-refs__page" data-via={r.via ? '' : undefined} data-new={view.fresh.has(r.id) ? '' : undefined} title={r.via ? t('features.coding.refs.viaTip', { title: title(r.via) }) : title(r.id)}>
              {r.via ? <CornerDownRight size={12} strokeWidth={1.75} aria-hidden /> : <FileText size={12} strokeWidth={1.75} aria-hidden />}
              <span>{title(r.id)}</span>
              {view.fresh.has(r.id) && <span className="ctk-refs__new">{t('features.coding.refs.new')}</span>}
            </a>
          ))}
        </span>
      ) : (
        <span className="ctk-hint">{t('features.coding.refs.none')}</span>
      )}
      {view.left.length > 0 && (
        <span className="ctk-refs__left" data-testid="coding-refs-left">
          {groups.over.length > 0 && (
            <span title={tip(groups.over)} data-testid="coding-refs-over">
              {t('features.coding.refs.leftUi', { n: MAX_REFS, list: list(groups.over) })}{' '}
            </span>
          )}
          {groups.kept.length > 0 && (
            <span title={tip(groups.kept)} data-testid="coding-refs-kept">
              {t('features.coding.refs.keptUi', { list: list(groups.kept) })}{' '}
            </span>
          )}
          {groups.priv.length > 0 && (
            <span title={tip(groups.priv)} data-testid="coding-refs-private">
              {t('features.coding.refs.privateUi', { list: list(groups.priv) })}{' '}
            </span>
          )}
          {sendable && <span data-testid="coding-refs-ask">{askLine}</span>}
        </span>
      )}
      {/* a short count for screen readers — the row itself changes with every pick */}
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {t('features.coding.refs.summary', { n: view.pages.length, m: view.left.length })}
      </span>
    </div>
  )
}

/** What does not go along, by why: over the limit or linked deeper · kept back (mails, memory, One's databases) · private. */
function leftGroups(left: RefPlan['left']): { over: ID[]; kept: ID[]; priv: ID[] } {
  const over: ID[] = []
  const kept: ID[] = []
  const priv: ID[] = []
  for (const l of left) (l.why === 'kept' ? kept : l.why === 'private' ? priv : over).push(l.id)
  return { over, kept, priv }
}

/** A new task's "Goes along" (the new-task dialog): the pages its goal and criteria point at, and the pages linked in those. */
export function RefPreview({ texts }: { texts: string[] }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const key = texts.join('\u0001')
  const refs = useMemo(() => refPagesOf([], texts.filter(Boolean)), [pages, key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!refs.length) return null
  return (
    <div className="ctk-refs" data-testid="coding-new-refs">
      <span className="label">{t('features.coding.refs.label')}</span>
      <span className="ctk-refs__list">
        {refs.map((r) => (
          <span key={r.id} className="ctk-refs__page" data-via={r.via ? '' : undefined} title={r.via ? t('features.coding.refs.viaTip', { title: r.via.title }) : r.title}>
            {r.via ? <CornerDownRight size={12} strokeWidth={1.75} aria-hidden /> : <FileText size={12} strokeWidth={1.75} aria-hidden />}
            <span>{r.title}</span>
          </span>
        ))}
      </span>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {t('features.coding.refs.summaryNew', { n: refs.length })}
      </span>
    </div>
  )
}
