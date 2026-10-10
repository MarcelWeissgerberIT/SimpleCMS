/**
 * Task block — the read-only placard ("INSTRUMENT"): a 3 px status rail, the status key (a keycap holding
 * the LED — not a control in this release), the mono spec label "TASK · 7F3A" and a chip strip (due date,
 * people by name, counts of linked tasks). The title and notes are the block's own content between them.
 *
 * - PlacardHead / PlacardChips: the chrome around the editor's content (views/WorkItemView.tsx).
 * - StaticWorkItem: the whole placard around rendered children — for surfaces drawn outside an editor
 *   (the history diff). Share links, history previews, slides and locked pages render through
 *   ReadOnlyDoc, i.e. the node view, so they look the same.
 * Layout + look: ./workitem.css (exports: workItemExportCss in ./exportCss.ts).
 */
import { useMemo, type ReactNode } from 'react'
import { BellRing, CalendarDays, Hourglass, Link2 } from 'lucide-react'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { itemAttrs, type WorkItemAttrs } from './attrs'
import { placardModel, type PlacardModel } from './format'
import './workitem.css'

export function usePlacardModel(attrs: WorkItemAttrs): PlacardModel {
  const t = useT()
  const lang = useLang()
  const people = useWorkspace((s) => s.people)
  return useMemo(() => placardModel(attrs, { t, lang, people, now: Date.now() }), [attrs, t, lang, people])
}

const ICON = { size: 12, strokeWidth: 1.8, 'aria-hidden': true } as const

/** The status key and the spec label (grid cells of the placard; contentEditable off). */
export function PlacardHead({ model }: { model: PlacardModel }) {
  const t = useT()
  const led = model.status === 'in_progress' ? 'on' : model.status === 'done' ? 'ok' : 'off'
  return (
    <div className="workitem__head" contentEditable={false}>
      <span className="workitem__key" role="img" aria-label={t('editor.workItem.statusKey', { status: model.statusText })} title={model.statusText}>
        <Led state={led} />
      </span>
      <span className="workitem__label" title={model.label}>
        {model.label}
      </span>
    </div>
  )
}

/** Due date, people, linked-task counts — nothing when the task has no fields. */
export function PlacardChips({ model }: { model: PlacardModel }) {
  const t = useT()
  if (!model.due && !model.people.length && !model.blockedBy && !model.related) return null
  const reminder = model.due?.reminder
  return (
    <div className="workitem__chips" contentEditable={false} role="group" aria-label={t('editor.workItem.fields')}>
      {model.due && (
        <span className="workitem__chip workitem__chip--due" data-late={model.due.late ? '' : undefined} title={t('editor.workItem.due', { date: model.due.text })}>
          <CalendarDays {...ICON} />
          {model.due.late && (
            <>
              <span>{t('editor.workItem.overdue')}</span>
              <span className="workitem__dot" aria-hidden>
                ·
              </span>
            </>
          )}
          <span>{model.due.text}</span>
          {reminder !== null && reminder !== undefined && (
            <>
              <span className="workitem__dot" aria-hidden>
                ·
              </span>
              <span className="workitem__rem" aria-label={reminder ? t('editor.workItem.reminder', { code: reminder }) : t('editor.workItem.reminderAt')}>
                <BellRing {...ICON} />
                {reminder}
              </span>
            </>
          )}
        </span>
      )}
      {model.people.map((p) => (
        <span key={p.key} className="workitem__chip workitem__chip--person">
          <span className="workitem__avatar" style={{ background: `var(--c-${p.color}-bg)`, color: `var(--c-${p.color}-text)` }} aria-hidden>
            {p.initials}
          </span>
          {p.name}
        </span>
      ))}
      {model.blockedBy > 0 && (
        <span className="workitem__chip workitem__chip--blocked">
          <Hourglass {...ICON} />
          {t('editor.workItem.blockedBy', { n: model.blockedBy })}
        </span>
      )}
      {model.related > 0 && (
        <span className="workitem__chip workitem__chip--related">
          <Link2 {...ICON} />
          {t('editor.workItem.related', { n: model.related })}
        </span>
      )}
    </div>
  )
}

/** The whole placard around already rendered title + notes (`children`), outside an editor. */
export function StaticWorkItem({ attrs, children, className = '' }: { attrs: Record<string, unknown> | null | undefined; children?: ReactNode; className?: string }) {
  const a = useMemo(() => itemAttrs(attrs ?? {}), [attrs])
  const model = usePlacardModel(a)
  return (
    <div className={`workitem ${className}`.trim()} data-type="work-item" data-status={a.status} data-late={model.due?.late ? '' : undefined}>
      <PlacardHead model={model} />
      <div className="workitem__body">{children}</div>
      <PlacardChips model={model} />
    </div>
  )
}
