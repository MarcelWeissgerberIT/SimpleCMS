/**
 * Task block — the placard ("INSTRUMENT"): a 3 px status rail, the status key (a keycap holding the LED), the mono
 * spec label with the state in words ("IN PROGRESS · 1B2C", "BLOCKED · 9D8E", "OVERDUE · 4C1A" in the signal colour —
 * never by colour alone), ⋯ (the task's menu) and a chip strip. The title and notes are the block's own content
 * between them. Every chip says what it is to a screen reader ("Due: …", "reminder …", "Assigned to: …").
 *
 * - PlacardHead: the key cell (passed in — StatusKeys in the editor, an LED image elsewhere), the label (a key
 *   that copies the task's link while editing), NEW ID on a duplicate, ⋯.
 * - PlacardChips: the static chips (exports, share links, the history diff): counts for linked tasks. The editor's
 *   chips (titles of blockers, ghost keys …) are ./Chips.tsx.
 * - StaticWorkItem: the whole placard around rendered children — for surfaces drawn outside an editor
 *   (the history diff). Share links, history previews, slides and locked pages render through
 *   ReadOnlyDoc, i.e. the node view, so they look the same.
 * Layout + look: ./workitem.css (exports: workItemExportCss in ./exportCss.ts).
 */
import { useMemo, type ReactNode } from 'react'
import { BellRing, CalendarDays, Ellipsis, Hourglass, Link2 } from 'lucide-react'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { itemAttrs, type WorkItemAttrs } from './attrs'
import { lateText, placardModel, type PlacardComputed, type PlacardModel } from './format'
import './workitem.css'

export function usePlacardModel(attrs: WorkItemAttrs, computed?: PlacardComputed | null, now?: number): PlacardModel {
  const t = useT()
  const lang = useLang()
  const people = useWorkspace((s) => s.people)
  return useMemo(() => placardModel(attrs, { t, lang, people, now: now ?? Date.now() }, computed), [attrs, t, lang, people, computed, now])
}

const ICON = { size: 12, strokeWidth: 1.8, 'aria-hidden': true } as const

export interface PlacardHeadProps {
  model: PlacardModel
  /** the key cell (editor: StatusKeys); default: the LED as an image */
  keys?: ReactNode
  /** editing: the label copies the task's link */
  onCopyLink?: () => void
  /** editing: ⋯ opens the task's menu */
  onMore?: () => void
  /** editing a DUPLICATE: give this block its own id */
  onNewId?: () => void
}

/** The status key, the spec label and ⋯ (grid cells of the placard; contentEditable off). */
export function PlacardHead({ model, keys, onCopyLink, onMore, onNewId }: PlacardHeadProps) {
  const t = useT()
  const led = model.status === 'in_progress' ? 'on' : model.status === 'done' ? 'ok' : 'off'
  const words = (
    <>
      <span className="visually-hidden">{t('editor.workItem.label')}: </span>
      <span className="workitem__state" data-signal={model.state.signal ? '' : undefined}>
        {model.state.word}
      </span>
      {model.state.id && <span className="workitem__id"> · {model.state.id}</span>}
    </>
  )
  return (
    <div className="workitem__head" contentEditable={false}>
      {keys ?? (
        <span className="workitem__keys">
          <span className="workitem__key" role="img" aria-label={t('editor.workItem.statusKey', { status: model.statusText })} title={model.statusText}>
            <Led state={led} />
          </span>
        </span>
      )}
      <span className="workitem__label" title={onCopyLink ? undefined : model.label}>
        {onCopyLink ? (
          <button type="button" className="workitem__labelkey" title={`${model.label} — ${t('editor.workItem.copyLink')}`} aria-label={`${model.label} — ${t('editor.workItem.copyLink')}`} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onCopyLink}>
            {words}
          </button>
        ) : (
          words
        )}
        {onNewId && (
          <button type="button" className="workitem__newid" title={t('editor.workItem.state.newIdHint')} tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onNewId}>
            {t('editor.workItem.state.newId')}
          </button>
        )}
      </span>
      {onMore && (
        <button type="button" className="workitem__more" aria-label={t('editor.workItem.more')} title={t('editor.workItem.more')} aria-haspopup="menu" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={onMore}>
          <Ellipsis size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
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
          <span className="visually-hidden">{t('editor.workItem.sr.due')} </span>
          {model.due.late && (
            <>
              <span>{lateText(model, t)}</span>
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
              <span className="workitem__rem" title={reminder ? t('editor.workItem.reminder', { code: reminder }) : t('editor.workItem.reminderAt')}>
                <BellRing {...ICON} />
                {reminder ? (
                  <>
                    <span className="visually-hidden">, {t('editor.workItem.sr.reminder')} </span>
                    {reminder}
                  </>
                ) : (
                  <span className="visually-hidden">, {t('editor.workItem.reminderAt')}</span>
                )}
              </span>
            </>
          )}
        </span>
      )}
      {model.people.length > 0 && <span className="visually-hidden">{t('editor.workItem.sr.people')}</span>}
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
