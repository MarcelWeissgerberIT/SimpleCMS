/**
 * The function's parameters: name (lower_snake, typed freely and tidied), type, description,
 * order. A rename follows into the body; a removed parameter leaves empty slots where it was used.
 */
import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { FnParam, FnParamType } from '../../../store/types'
import { FN_LIMITS, FN_PARAM_TYPES } from '../../../store/functions'
import { useT } from '../../../i18n'
import { checkParamName, normalizeParamName, usesParam, type DNode } from './model'

export interface ParamsEditorProps {
  params: FnParam[]
  body: DNode
  readOnly: boolean
  onAdd: () => void
  onRename: (index: number, name: string) => void
  onChange: (index: number, patch: Partial<Pick<FnParam, 'type' | 'description'>>) => void
  onMove: (index: number, dir: -1 | 1) => void
  onRemove: (index: number) => void
}

export function ParamsEditor({ params, body, readOnly, onAdd, onRename, onChange, onMove, onRemove }: ParamsEditorProps) {
  const t = useT()
  /** the name field being typed in (only valid names reach the draft) */
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null)

  return (
    <div className="fx-params">
      {params.length === 0 && <p className="fx-params__empty faint">{t('features.fn.params.empty')}</p>}
      {params.map((p, i) => {
        const text = editing?.index === i ? editing.text : p.name
        const issue = editing?.index === i ? checkParamName(text, i, params) : null
        const used = usesParam(body, p.name)
        return (
          <div className="fx-param" key={i} data-param={p.name}>
            <span className="fx-param__n" aria-hidden>
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="fx-param__field">
              <input
                className="input fx-param__name"
                value={text}
                disabled={readOnly}
                spellCheck={false}
                autoCapitalize="off"
                aria-label={t('features.fn.params.name', { n: i + 1 })}
                aria-invalid={!!issue || undefined}
                onFocus={() => setEditing({ index: i, text: p.name })}
                onBlur={() => setEditing(null)}
                onChange={(e) => {
                  const next = normalizeParamName(e.target.value)
                  setEditing({ index: i, text: next })
                  if (next !== p.name && !checkParamName(next, i, params)) onRename(i, next)
                }}
              />
              {issue && (
                <span className="fx-param__err" role="alert">
                  {t(`features.fn.paramIssue.${issue}`, { name: text })}
                </span>
              )}
            </div>
            <select
              className="input fx-param__type"
              value={p.type}
              disabled={readOnly}
              aria-label={t('features.fn.params.type', { name: p.name })}
              onChange={(e) => onChange(i, { type: e.target.value as FnParamType })}
            >
              {FN_PARAM_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`features.fn.type.${ty}`)}
                </option>
              ))}
            </select>
            <input
              className="input fx-param__desc"
              value={p.description ?? ''}
              disabled={readOnly}
              maxLength={200}
              placeholder={t('features.fn.params.descPh')}
              aria-label={t('features.fn.params.desc', { name: p.name })}
              onChange={(e) => onChange(i, { description: e.target.value })}
            />
            {!readOnly && (
              <span className="fx-param__tools">
                <span className="fx-param__used label" title={t('features.fn.params.usedTitle')}>
                  {used ? `${used}×` : '—'}
                </span>
                <button type="button" className="icon-btn icon-btn--sm" disabled={i === 0} aria-label={t('features.fn.params.up', { name: p.name })} onClick={() => onMove(i, -1)}>
                  <ArrowUp size={13} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" disabled={i === params.length - 1} aria-label={t('features.fn.params.down', { name: p.name })} onClick={() => onMove(i, 1)}>
                  <ArrowDown size={13} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('features.fn.params.remove', { name: p.name })} onClick={() => onRemove(i)}>
                  <X size={13} />
                </button>
              </span>
            )}
          </div>
        )
      })}
      {!readOnly && params.length < FN_LIMITS.params && (
        <button type="button" className="btn btn--sm btn--ghost fx-params__add" onClick={onAdd}>
          <Plus size={13} /> {t('features.fn.params.add')}
        </button>
      )}
    </div>
  )
}
