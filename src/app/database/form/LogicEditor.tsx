/**
 * "Show only if …" of one question in the builder: conditions on earlier questions, joined by
 * AND (all) or OR (any). Native selects and inputs, so it works from the keyboard alone.
 */
import { useId } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import type { FormCondition, FormConditionOp, FormLogic } from '../../store/types'
import { useT } from '../../i18n'
import type { Field } from './fields'
import { conditionIssue, newCondition, opsFor, valueKind, withOp } from './logic'
import { useDraft } from './config'
import { FORM_LIMITS } from './codec'

const pad = (n: number) => String(n).padStart(2, '0')

export interface LogicEditorProps {
  /** this question and its position in the form */
  field: Field
  index: number
  fields: Field[]
  logic: FormLogic
  onChange: (logic: FormLogic | null) => void
}

export function LogicEditor({ field, index, fields, logic, onChange }: LogicEditorProps) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const earlier = fields.slice(0, index)
  const name = field.name.trim() || t('common.untitled')
  const set = (i: number, c: FormCondition | null) => {
    const conditions = c ? logic.conditions.map((x, j) => (j === i ? c : x)) : logic.conditions.filter((_, j) => j !== i)
    onChange(conditions.length ? { ...logic, conditions } : null)
  }
  const join = t(logic.op === 'or' ? 'database.form.logic.or' : 'database.form.logic.and')
  return (
    <div className="fb-logic" role="group" aria-labelledby={`${uid}-h`}>
      <div className="fb-logic__head">
        <span className="label fb-logic__title" id={`${uid}-h`}>
          {t('database.form.logic.showIf')}
          <span className="visually-hidden"> — {name}</span>
        </span>
        {logic.conditions.length > 1 && (
          <select className="input fb-sel fb-logic__match" aria-label={t('database.form.logic.match')} value={logic.op} onChange={(e) => onChange({ ...logic, op: e.target.value === 'or' ? 'or' : 'and' })}>
            <option value="and">{t('database.form.logic.all')}</option>
            <option value="or">{t('database.form.logic.any')}</option>
          </select>
        )}
        {field.required && <span className="label fb-logic__req">{t('database.form.logic.reqWhenShown')}</span>}
        <span className="fb-q__spacer" />
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.form.logic.remove', { name })} title={t('database.form.logic.remove', { name })} onClick={() => onChange(null)}>
          <X size={13} />
        </button>
      </div>
      <ol className="fb-logic__list">
        {logic.conditions.map((c, i) => (
          <Condition key={i} n={i + 1} join={i === 0 ? t('database.form.logic.if') : join} c={c} index={index} fields={fields} earlier={earlier} onChange={(x) => set(i, x)} />
        ))}
      </ol>
      {logic.conditions.length < FORM_LIMITS.conditions && (
        <button type="button" className="fb-act" onClick={() => onChange({ ...logic, conditions: [...logic.conditions, newCondition(earlier[earlier.length - 1])] })}>
          <Plus size={12} /> {t('database.form.logic.addMore')}
        </button>
      )}
    </div>
  )
}

function Condition({ n, join, c, index, fields, earlier, onChange }: { n: number; join: string; c: FormCondition; index: number; fields: Field[]; earlier: Field[]; onChange: (c: FormCondition | null) => void }) {
  const t = useT()
  const issue = conditionIssue(c, index, fields)
  const src = earlier.find((f) => f.key === c.q)
  const vk = src ? valueKind(src.kind, c.op) : null
  return (
    <li className="fb-cond" data-issue={issue ?? undefined}>
      <span className="label fb-cond__join" aria-hidden>
        {join}
      </span>
      <select
        className="input fb-sel fb-cond__q"
        aria-label={t('database.form.logic.question', { n })}
        value={src ? c.q : ''}
        onChange={(e) => {
          const next = earlier.find((f) => f.key === e.target.value)
          if (next) onChange(newCondition(next))
        }}
      >
        {!src && <option value="">{t('database.form.logic.missing')}</option>}
        {earlier.map((f, j) => (
          <option key={f.key} value={f.key}>
            Q{pad(j + 1)} · {f.name.trim() || t('common.untitled')}
          </option>
        ))}
      </select>
      {src && (
        <select className="input fb-sel fb-cond__op" aria-label={t('database.form.logic.operator', { n })} value={c.op} onChange={(e) => onChange(withOp(src, c, e.target.value as FormConditionOp))}>
          {opsFor(src.kind).map((op) => (
            <option key={op} value={op}>
              {t(`database.form.logic.op.${op}`)}
            </option>
          ))}
        </select>
      )}
      {src && vk === 'option' && (
        <select className="input fb-sel fb-cond__value" aria-label={t('database.form.logic.value', { n })} value={typeof c.value === 'string' ? c.value : ''} onChange={(e) => onChange({ ...c, value: e.target.value })}>
          {issue === 'option' && <option value={typeof c.value === 'string' ? c.value : ''}>{t('database.form.logic.deletedOption')}</option>}
          {(src.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {src && vk === 'date' && <input className="input fb-cond__value fb-cond__date" type="date" aria-label={t('database.form.logic.value', { n })} value={typeof c.value === 'string' ? c.value : ''} onChange={(e) => onChange({ ...c, value: e.target.value })} />}
      {src && (vk === 'text' || vk === 'number') && <ValueInput key={`${c.q}-${vk}`} n={n} kind={vk} c={c} onChange={onChange} />}
      <button type="button" className="icon-btn icon-btn--sm fb-cond__remove" aria-label={t('database.form.logic.removeCond', { n })} title={t('database.form.logic.removeCond', { n })} onClick={() => onChange(null)}>
        <X size={13} />
      </button>
      {issue && (
        <p className="fb-cond__issue" role="note">
          <AlertTriangle size={12} aria-hidden /> {t(`database.form.logic.issue.${issue}`)}
        </p>
      )}
    </li>
  )
}

/** Free text / number value: local while typing, saved after a pause and on blur. */
function ValueInput({ n, kind, c, onChange }: { n: number; kind: 'text' | 'number'; c: FormCondition; onChange: (c: FormCondition) => void }) {
  const t = useT()
  const draft = useDraft(c.value === undefined || c.value === null ? '' : String(c.value), (v) => {
    if (kind === 'text') return onChange({ ...c, value: v })
    const num = Number(v.replace(',', '.'))
    if (v.trim() && Number.isFinite(num)) onChange({ ...c, value: num })
  })
  return (
    <input
      className="input fb-cond__value"
      type="text"
      inputMode={kind === 'number' ? 'decimal' : undefined}
      aria-label={t('database.form.logic.value', { n })}
      placeholder={kind === 'text' ? t('database.form.logic.textPh') : '0'}
      maxLength={200}
      {...draft.props}
    />
  )
}
