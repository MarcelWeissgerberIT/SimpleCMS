/**
 * Builder cards: one question (required, help, placeholder, presentation, "show only if …",
 * page break after it) and a page break (section title + description).
 */
import { useEffect, useId, useRef } from 'react'
import { Eye, GitBranch, SeparatorHorizontal, X } from 'lucide-react'
import type { FormDisplay, PropertyDef } from '../../store/types'
import { useT } from '../../i18n'
import { Switch } from '../../ui/controls'
import { OptionTag } from '../cells/display'
import { Segmented, SortableRow, TypeIcon } from '../parts'
import type { DbModel } from '../hooks'
import { canScale, displaysFor, formConfig, hasPlaceholder, questionOf, type Field } from './fields'
import { logicTag, newCondition } from './logic'
import { patchBreak, patchQuestion, removeBreak, setLogic, useDraft } from './config'
import { LogicEditor } from './LogicEditor'

const pad = (n: number) => String(n).padStart(2, '0')
export const qNum = (i: number) => `Q${pad(i + 1)}`

export interface QuestionCardProps {
  m: DbModel
  p: PropertyDef
  /** position among the shown questions */
  index: number
  field: Field | undefined
  fields: Field[]
  onHide: () => void
  /** insert a page break after this question (undefined: not possible here) */
  onBreakAfter?: () => void
  onActive: (key: string | null) => void
}

export function QuestionCard({ m, p, index, field, fields, onHide, onBreakAfter, onActive }: QuestionCardProps) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const q = questionOf(formConfig(m.view), p.id)
  const dbId = m.db.id
  const viewId = m.view.id
  const help = useDraft(q.help ?? '', (v) => patchQuestion(dbId, viewId, p.id, { help: v }))
  const ph = useDraft(q.placeholder ?? '', (v) => patchQuestion(dbId, viewId, p.id, { placeholder: v }))
  const isTitle = p.type === 'title'
  const opts = p.type === 'select' || p.type === 'status' || p.type === 'multi_select' ? (p.options ?? []) : null
  const name = p.name || t('common.untitled')
  const spec = t(`database.type.${p.type}`) + (opts ? ` · ${t(opts.length === 1 ? 'database.form.b.options.one' : 'database.form.b.options.other', { count: opts.length })}` : '')
  const logic = field?.showIf
  const tag = logic ? logicTag(t, logic, fields, index, qNum) : ''
  const displays = displaysFor(p)
  const scaleable = canScale(p)

  const body = (
    <div className="fb-q__main">
      <div className="fb-q__head">
        <span className="fb-q__num" aria-hidden>
          {qNum(index)}
        </span>
        <TypeIcon type={p.type} size={14} />
        <span className="fb-q__name" id={`${uid}-name`}>
          {name}
        </span>
        <span className="label fb-q__spec">{spec}</span>
        {tag && (
          <span className="fb-q__if" title={tag}>
            {tag}
          </span>
        )}
        <span className="fb-q__spacer" />
        <label className="fb-q__req">
          <span className="label">{t('database.form.required')}</span>
          <Switch checked={!!q.required} label={t('database.form.b.requiredFor', { name })} onChange={(v) => patchQuestion(dbId, viewId, p.id, { required: v })} />
        </label>
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.form.b.hideQ', { name })} title={t('database.form.b.hideQ', { name })} onClick={onHide}>
          <Eye size={14} />
        </button>
      </div>
      <div className="fb-q__body">
        <div className="fb-q__texts">
          <input className="input fb-q__help" placeholder={t('database.form.b.helpPh')} aria-label={t('database.form.b.helpFor', { name })} maxLength={500} {...help.props} />
          {field && hasPlaceholder(field) && <input className="input fb-q__ph" placeholder={t('database.form.b.placeholderPh')} aria-label={t('database.form.b.placeholderFor', { name })} maxLength={200} {...ph.props} />}
        </div>
        {(displays.length > 0 || scaleable) && (
          <div className="fb-q__present">
            <span className="label">{t('database.form.b.showAs')}</span>
            {displays.length > 0 && (
              <Segmented<FormDisplay>
                value={q.display && displays.includes(q.display) ? q.display : displays[0]}
                ariaLabel={t('database.form.b.showAsFor', { name })}
                items={displays.map((d) => ({ value: d, label: t(`database.form.display.${d}`) }))}
                onChange={(d) => patchQuestion(dbId, viewId, p.id, { display: d })}
              />
            )}
            {scaleable && (
              <Segmented<string>
                value={q.display === 'scale' ? (p.type === 'rating' ? 'scale' : `scale${q.scale === 10 ? 10 : 5}`) : 'default'}
                ariaLabel={t('database.form.b.showAsFor', { name })}
                items={
                  p.type === 'rating'
                    ? [
                        { value: 'default', label: t('database.form.display.stars') },
                        { value: 'scale', label: t('database.form.display.scaleN', { max: Math.max(1, Math.min(10, p.ratingMax ?? 5)) }) },
                      ]
                    : [
                        { value: 'default', label: t('database.form.display.field') },
                        { value: 'scale5', label: t('database.form.display.scaleN', { max: 5 }) },
                        { value: 'scale10', label: t('database.form.display.scaleN', { max: 10 }) },
                      ]
                }
                onChange={(v) => patchQuestion(dbId, viewId, p.id, v === 'default' ? { display: undefined, scale: undefined } : { display: 'scale', scale: v === 'scale10' ? 10 : 5 })}
              />
            )}
          </div>
        )}
        {p.type === 'date' && (
          <label className="fb-q__opt">
            <Switch checked={!!q.includeTime} label={t('database.form.b.askTime')} onChange={(v) => patchQuestion(dbId, viewId, p.id, { includeTime: v })} />
            <span>{t('database.form.b.askTime')}</span>
          </label>
        )}
        {opts && opts.length > 0 && q.display !== 'dropdown' && (
          <div className="fb-q__opts" aria-label={t('database.form.b.optionsLabel')}>
            {opts.slice(0, 12).map((o) => (
              <OptionTag key={o.id} option={o} />
            ))}
            {opts.length > 12 && <span className="label">+{opts.length - 12}</span>}
          </div>
        )}
        {(p.type === 'person' || p.type === 'relation') && <p className="fb-q__note label">{t('database.form.b.sharedAsText')}</p>}
        {p.type === 'files' && <p className="fb-q__note label">{t('database.form.b.sharedFiles')}</p>}
        {logic && field && <LogicEditor field={field} index={index} fields={fields} logic={logic} onChange={(l) => setLogic(dbId, viewId, p.id, l)} />}
        {(!logic || onBreakAfter) && (
          <div className="fb-q__acts">
            {!logic && index > 0 && field && (
              <button type="button" className="fb-act" aria-label={t('database.form.logic.addFor', { name })} onClick={() => setLogic(dbId, viewId, p.id, { op: 'and', conditions: [newCondition(fields[index - 1])] })}>
                <GitBranch size={12} /> {t('database.form.logic.add')}
              </button>
            )}
            {onBreakAfter && (
              <button type="button" className="fb-act" aria-label={t('database.form.page.addAfter', { name })} onClick={onBreakAfter}>
                <SeparatorHorizontal size={12} /> {t('database.form.page.add')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
  const events = { onFocus: () => onActive(p.id), onMouseEnter: () => onActive(p.id), onMouseLeave: () => onActive(null) }
  if (isTitle)
    return (
      <li className="fb-q fb-q--title" data-fb-key={p.id} data-logic={logic ? true : undefined} {...events}>
        <span className="db-grip db-grip--ghost" aria-hidden />
        {body}
      </li>
    )
  return (
    <li className="fb-q__li" data-fb-key={p.id} data-logic={logic ? true : undefined} {...events}>
      <SortableRow id={p.id} className="fb-q">
        {body}
      </SortableRow>
    </li>
  )
}

/** A page break in the question list: "PAGE 02" + optional section title and description. */
export function PageBreakCard({ m, id, page, title, description, autoFocus }: { m: DbModel; id: string; page: number; title: string; description: string; autoFocus?: boolean }) {
  const t = useT()
  const dbId = m.db.id
  const viewId = m.view.id
  const head = useDraft(title, (v) => patchBreak(dbId, viewId, id, { title: v }))
  const desc = useDraft(description, (v) => patchBreak(dbId, viewId, id, { description: v }))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const n = pad(page)
  return (
    <li className="fb-break__li" data-break={id}>
      <SortableRow id={id} className="fb-break">
        <div className="fb-break__main">
          <div className="fb-break__rule">
            <span className="label fb-break__label">{t('database.form.page.label', { n })}</span>
            <span className="fb-break__line" aria-hidden />
            <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.form.page.remove', { n })} title={t('database.form.page.remove', { n })} onClick={() => removeBreak(dbId, viewId, id)}>
              <X size={13} />
            </button>
          </div>
          <input ref={ref} className="fb-break__title" placeholder={t('database.form.page.titlePh')} aria-label={t('database.form.page.titleFor', { n })} maxLength={200} {...head.props} />
          <textarea className="fb-break__desc" rows={1} placeholder={t('database.form.page.descPh')} aria-label={t('database.form.page.descFor', { n })} maxLength={1000} {...desc.props} />
        </div>
      </SortableRow>
    </li>
  )
}
