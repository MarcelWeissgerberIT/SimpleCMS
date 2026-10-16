/**
 * "Goes along": the pages a task's next run sends to Claude Code as read-only text (coding/refs.ts refPlan, in that
 * order) — @ mentions and links in the task, One addresses in the answers and rework notes, the pages linked in those
 * (↳) — live while an answer or a rework note is written (`draft`: its pages are marked new). What Claude would see
 * named but not get (over the limit, linked deeper) is said; a hint when nothing goes along.
 */
import { useMemo } from 'react'
import { CornerDownRight, FileText } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { MAX_REFS, refPagesOf, refPlan } from './refs'
import { useTaskLocal } from './local'
import { taskContext } from './tasks'

export function RefsLine({ taskId, draft = '' }: { taskId: ID; draft?: string }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const local = useTaskLocal(taskId)
  const view = useMemo(() => {
    // as the worker's next hand-out orders them (tasks.ts pickNext): this stage's answers and rework note first
    const stageId = taskContext(taskId)?.stage?.id
    const ofStage = (x: { stageId: ID }) => x.stageId === stageId
    const answers = local.answers ?? []
    const rework = local.rework
    const turn = [...answers.filter(ofStage).map((a) => a.a), ...(rework && ofStage(rework) ? [rework.text] : [])]
    const older = [...answers.filter((a) => !ofStage(a)).map((a) => a.a), ...(rework && !ofStage(rework) ? [rework.text] : [])]
    const plan = refPlan(taskId, older, { turn: draft ? [draft, ...turn] : turn })
    const before = draft ? new Set(refPlan(taskId, older, { turn }).pages.map((p) => p.id)) : null
    return { ...plan, fresh: new Set(before ? plan.pages.filter((p) => !before.has(p.id)).map((p) => p.id) : []) }
  }, [taskId, pages, local, draft]) // eslint-disable-line react-hooks/exhaustive-deps
  const title = (id: ID) => pages[id]?.title.trim() || t('common.untitled')
  return (
    <div className="ctk-refs" data-testid="coding-refs" aria-live="polite">
      <span className="label">{t('features.coding.refs.label')}</span>
      {view.pages.length ? (
        <span className="ctk-refs__list">
          {view.pages.map((r) => (
            <a key={r.id} href={`#/p/${r.id}`} className="ctk-refs__page" data-via={r.via ? '' : undefined} data-new={view.fresh.has(r.id) ? '' : undefined} title={r.via ? t('features.coding.refs.viaTip', { title: title(r.via) }) : title(r.id)}>
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
          {t('features.coding.refs.leftUi', { n: MAX_REFS, list: view.left.map((l) => `“${title(l.id)}”`).join(', ') })}
        </span>
      )}
    </div>
  )
}

/** A new task's "Goes along" (the new-task dialog): the pages its goal and criteria point at, and the pages linked in those. */
export function RefPreview({ texts }: { texts: string[] }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const key = texts.join('\u0001')
  const refs = useMemo(() => refPagesOf([], texts.filter(Boolean)), [pages, key]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!refs.length) return null
  return (
    <div className="ctk-refs" data-testid="coding-new-refs" aria-live="polite">
      <span className="label">{t('features.coding.refs.label')}</span>
      <span className="ctk-refs__list">
        {refs.map((r) => (
          <span key={r.id} className="ctk-refs__page" data-via={r.via ? '' : undefined} title={r.via ? t('features.coding.refs.viaTip', { title: r.via.title }) : r.title}>
            {r.via ? <CornerDownRight size={12} strokeWidth={1.75} aria-hidden /> : <FileText size={12} strokeWidth={1.75} aria-hidden />}
            <span>{r.title}</span>
          </span>
        ))}
      </span>
    </div>
  )
}
