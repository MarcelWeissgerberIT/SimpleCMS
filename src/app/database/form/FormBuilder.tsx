/**
 * Build mode: heading + description, the questions (title first, then the view's property order —
 * drag or keyboard to reorder), per question required / help text / hide, submit label and the
 * responses section (webhook + share).
 */
import { useId } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Eye, Plus, Share2 } from 'lucide-react'
import type { PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { Switch } from '../../ui/controls'
import { OptionTag } from '../cells/display'
import { SortableRow, TypeIcon } from '../parts'
import type { DbModel } from '../hooks'
import { formConfig, formProps, questionOf, type Field } from './fields'
import { patchForm, patchQuestion, useDraft } from './config'
import { WebhookField } from './ShareForm'

const pad = (n: number) => String(n).padStart(2, '0')

export function FormBuilder({ m, fields, onShare }: { m: DbModel; fields: Field[]; onShare: () => void }) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const cfg = formConfig(m.view)
  const { shown, hidden, computed, title } = formProps(m.db, m.view)
  const dbName = m.dbPage.title.trim() || t('common.untitled')
  const dbId = m.db.id
  const viewId = m.view.id
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const heading = useDraft(cfg.title ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, title: v })))
  const desc = useDraft(cfg.description ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, description: v })))
  const submit = useDraft(cfg.submitLabel ?? '', (v) => patchForm(dbId, viewId, (c) => ({ ...c, submitLabel: v })))

  const sortable = shown.filter((p) => p.type !== 'title')
  const setVisible = (ids: string[]) => useWorkspace.getState().updateView(dbId, viewId, { visibleProperties: ids })
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    // reorder inside the full list (it may also hold properties the form doesn't offer)
    const all = m.view.visibleProperties
    const from = all.indexOf(String(e.active.id))
    const to = all.indexOf(String(e.over.id))
    if (from < 0 || to < 0) return
    setVisible(arrayMove(all, from, to))
  }
  const hide = (p: PropertyDef) => {
    if (p.type === 'title') patchQuestion(dbId, viewId, p.id, { hidden: true })
    else setVisible(m.view.visibleProperties.filter((id) => id !== p.id))
  }
  const show = (p: PropertyDef) => {
    if (p.type === 'title') patchQuestion(dbId, viewId, p.id, { hidden: false })
    else setVisible([...m.view.visibleProperties.filter((id) => id !== p.id), p.id])
  }

  const card = (p: PropertyDef, i: number) => <QuestionCard key={p.id} m={m} p={p} index={i} onHide={() => hide(p)} />

  return (
    <div className="fb">
      {/* § 01 — heading */}
      <section className="fb-sec" aria-labelledby={`${uid}-s1`}>
        <h3 className="fb-sec__label label" id={`${uid}-s1`}>
          § 01 — {t('database.form.b.header')}
        </h3>
        <label className="visually-hidden" htmlFor={`${uid}-title`}>
          {t('database.form.b.title')}
        </label>
        <input id={`${uid}-title`} className="fb-title" placeholder={dbName} maxLength={200} {...heading.props} />
        <label className="visually-hidden" htmlFor={`${uid}-desc`}>
          {t('database.form.b.description')}
        </label>
        <textarea id={`${uid}-desc`} className="fb-desc" rows={2} placeholder={t('database.form.b.descriptionPh')} maxLength={2000} {...desc.props} />
      </section>

      {/* § 02 — questions */}
      <section className="fb-sec" aria-labelledby={`${uid}-s2`}>
        <h3 className="fb-sec__label label" id={`${uid}-s2`}>
          § 02 — {t('database.form.b.questions')} <span className="fb-sec__count">{pad(shown.length)}</span>
        </h3>
        <ol className="fb-qs">
          {shown[0]?.type === 'title' && card(shown[0], 0)}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sortable.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {sortable.map((p, i) => card(p, i + (shown[0]?.type === 'title' ? 1 : 0)))}
            </SortableContext>
          </DndContext>
        </ol>
        {shown.length === 0 && <p className="fb-empty label">{t('database.form.b.noneShown')}</p>}

        {hidden.length > 0 && (
          <div className="fb-hidden">
            <div className="label fb-hidden__label">{t('database.form.b.hidden')}</div>
            <ul className="fb-hidden__list">
              {hidden.map((p) => (
                <li key={p.id} className="fb-hidden__item">
                  <button type="button" className="fb-hidden__add" onClick={() => show(p)} aria-label={t('database.form.b.addQ', { name: p.name || t('common.untitled') })}>
                    <Plus size={13} aria-hidden />
                    <TypeIcon type={p.type} size={13} />
                    <span>{p.name || t('common.untitled')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {computed.length > 0 && (
          <p className="fb-note">
            <span className="label">{t('database.form.b.auto')}</span> {computed.map((p) => p.name || t('common.untitled')).join(', ')} — {t('database.form.b.autoNote')}
          </p>
        )}
        {title && questionOf(cfg, title.id).hidden && <p className="fb-note">{t('database.form.b.titleHidden')}</p>}
      </section>

      {/* § 03 — submit */}
      <section className="fb-sec" aria-labelledby={`${uid}-s3`}>
        <h3 className="fb-sec__label label" id={`${uid}-s3`}>
          § 03 — {t('database.form.b.submit')}
        </h3>
        <div className="fb-submit">
          <label className="label" htmlFor={`${uid}-submit`}>
            {t('database.form.b.submitLabel')}
          </label>
          <input id={`${uid}-submit`} className="input fb-submit__input" placeholder={t('database.form.submitDefault')} maxLength={60} {...submit.props} />
          <span className="btn btn--primary fb-submit__preview" aria-hidden>
            {submit.value.trim() || t('database.form.submitDefault')}
          </span>
        </div>
      </section>

      {/* § 04 — responses */}
      <section className="fb-sec" aria-labelledby={`${uid}-s4`}>
        <h3 className="fb-sec__label label" id={`${uid}-s4`}>
          § 04 — {t('database.form.b.responses')}
        </h3>
        <p className="fb-text">{t('database.form.b.localRows', { db: dbName })}</p>
        <WebhookField m={m} fields={fields} />
        <div className="fb-share">
          <button type="button" className="btn btn--ink" onClick={onShare}>
            <Share2 size={14} /> {t('database.form.share.button')}
          </button>
          <span className="fb-share__note">{t('database.form.b.shareNote')}</span>
        </div>
      </section>
    </div>
  )
}

function QuestionCard({ m, p, index, onHide }: { m: DbModel; p: PropertyDef; index: number; onHide: () => void }) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const q = questionOf(formConfig(m.view), p.id)
  const help = useDraft(q.help ?? '', (v) => patchQuestion(m.db.id, m.view.id, p.id, { help: v }))
  const isTitle = p.type === 'title'
  const opts = p.type === 'select' || p.type === 'status' || p.type === 'multi_select' ? p.options ?? [] : null
  const name = p.name || t('common.untitled')
  const spec = t(`database.type.${p.type}`) + (opts ? ` · ${t(opts.length === 1 ? 'database.form.b.options.one' : 'database.form.b.options.other', { count: opts.length })}` : '')
  const body = (
    <div className="fb-q__main">
      <div className="fb-q__head">
        <span className="fb-q__num" aria-hidden>
          Q{pad(index + 1)}
        </span>
        <TypeIcon type={p.type} size={14} />
        <span className="fb-q__name" id={`${uid}-name`}>
          {name}
        </span>
        <span className="label fb-q__spec">{spec}</span>
        <span className="fb-q__spacer" />
        <label className="fb-q__req">
          <span className="label">{t('database.form.required')}</span>
          <Switch checked={!!q.required} label={t('database.form.b.requiredFor', { name })} onChange={(v) => patchQuestion(m.db.id, m.view.id, p.id, { required: v })} />
        </label>
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.form.b.hideQ', { name })} title={t('database.form.b.hideQ', { name })} onClick={onHide}>
          <Eye size={14} />
        </button>
      </div>
      <div className="fb-q__body">
        <input className="input fb-q__help" placeholder={t('database.form.b.helpPh')} aria-label={t('database.form.b.helpFor', { name })} maxLength={500} {...help.props} />
        {p.type === 'date' && (
          <label className="fb-q__opt">
            <Switch checked={!!q.includeTime} label={t('database.form.b.askTime')} onChange={(v) => patchQuestion(m.db.id, m.view.id, p.id, { includeTime: v })} />
            <span>{t('database.form.b.askTime')}</span>
          </label>
        )}
        {opts && opts.length > 0 && (
          <div className="fb-q__opts" aria-label={t('database.form.b.optionsLabel')}>
            {opts.slice(0, 12).map((o) => (
              <OptionTag key={o.id} option={o} />
            ))}
            {opts.length > 12 && <span className="label">+{opts.length - 12}</span>}
          </div>
        )}
        {(p.type === 'person' || p.type === 'relation') && <p className="fb-q__note label">{t('database.form.b.sharedAsText')}</p>}
        {p.type === 'files' && <p className="fb-q__note label">{t('database.form.b.sharedFiles')}</p>}
      </div>
    </div>
  )
  if (isTitle)
    return (
      <li className="fb-q fb-q--title">
        <span className="db-grip db-grip--ghost" aria-hidden />
        {body}
      </li>
    )
  return (
    <li className="fb-q__li">
      <SortableRow id={p.id} className="fb-q">
        {body}
      </SortableRow>
    </li>
  )
}
