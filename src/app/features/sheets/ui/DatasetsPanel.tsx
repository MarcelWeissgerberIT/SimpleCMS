/**
 * Datasets panel (toolbar "DS"): the block's named datasets — colour, name, areas, cell count —
 * create one from the current (multi-area) selection, rename, recolour, re-select its areas,
 * delete (with the number of formulas that use it), insert DS(Name) at the caret.
 */
import { useState } from 'react'
import { Check, CornerDownLeft, Crosshair, Trash2 } from 'lucide-react'
import { Popover } from '../../../ui/Popover'
import type { ColorName } from '../../../store/types'
import { parseRect, quoteSheet } from '../engine'
import { DS_COLORS, type DatasetDef, type SheetData } from '../model'

export interface DatasetsPanelProps {
  anchor: Element | null
  onClose: () => void
  datasets: DatasetDef[]
  sheets: SheetData[]
  activeSheet: string
  /** the current selection as dataset ranges */
  selection: DatasetDef['ranges']
  editable: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
  /** each returns an error message key, or null when done */
  onCreate: (name: string) => string | null
  onRename: (id: string, name: string) => string | null
  onRecolor: (id: string, color: ColorName) => void
  onUseSelection: (id: string) => void
  onDelete: (id: string) => void
  onInsert: (name: string) => void
}

export function rangesText(ranges: DatasetDef['ranges'], sheets: SheetData[], activeSheet: string): string {
  return ranges
    .map((r) => {
      const s = sheets.find((x) => x.id === r.sheet)
      return r.sheet === activeSheet || !s ? r.ref : `${quoteSheet(s.name)}!${r.ref}`
    })
    .join('; ')
}

export function cellCount(ranges: DatasetDef['ranges'], sheets: SheetData[]): number {
  let n = 0
  for (const r of ranges) {
    const s = sheets.find((x) => x.id === r.sheet)
    const rect = parseRect(r.ref)
    if (!s || !rect) continue
    const bottom = Math.min(rect.bottom, s.rows - 1)
    const right = Math.min(rect.right, s.cols - 1)
    if (bottom >= rect.top && right >= rect.left) n += (bottom - rect.top + 1) * (right - rect.left + 1)
  }
  return n
}

export function DatasetsPanel(props: DatasetsPanelProps) {
  const { anchor, onClose, datasets, sheets, activeSheet, selection, editable, t, onCreate, onRename, onRecolor, onUseSelection, onDelete, onInsert } = props
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; problem: string | null } | null>(null)
  const [palette, setPalette] = useState<string | null>(null)

  const create = () => {
    const err = onCreate(name.trim())
    setProblem(err)
    if (!err) setName('')
  }

  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-end" className="dsp" role="dialog" aria-label={t('features.sheets.ds.title')}>
      <div className="dsp__head">
        <span className="label">{t('features.sheets.ds.title')}</span>
        <span className="label faint">{datasets.length}</span>
      </div>
      <p className="dsp__intro">{t('features.sheets.ds.intro')}</p>
      {datasets.length === 0 && <p className="dsp__empty">{t('features.sheets.ds.empty')}</p>}
      <ul className="dsp__list">
        {datasets.map((d) => {
          const count = cellCount(d.ranges, sheets)
          return (
            <li key={d.id} className="dsp__item" data-dataset={d.name}>
              <button
                type="button"
                className="dsp__swatch"
                style={{ background: `var(--c-${d.color}-bg)`, borderColor: `var(--c-${d.color}-text)` }}
                aria-label={`${t('features.sheets.ds.color')}: ${d.name}`}
                aria-expanded={palette === d.id}
                disabled={!editable}
                onClick={() => setPalette(palette === d.id ? null : d.id)}
              />
              <div className="dsp__main">
                {renaming?.id === d.id ? (
                  <input
                    className="input dsp__rename"
                    value={renaming.name}
                    autoFocus
                    aria-label={t('features.sheets.ds.name')}
                    aria-invalid={!!renaming.problem}
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value, problem: null })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const err = onRename(d.id, renaming.name.trim())
                        if (err) setRenaming({ ...renaming, problem: err })
                        else setRenaming(null)
                      }
                      if (e.key === 'Escape') {
                        e.stopPropagation()
                        setRenaming(null)
                      }
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <button type="button" className="dsp__name" style={{ color: `var(--c-${d.color}-text)` }} disabled={!editable} title={t('features.sheets.ds.rename')} onClick={() => setRenaming({ id: d.id, name: d.name, problem: null })}>
                    {d.name}
                  </button>
                )}
                {renaming?.id === d.id && renaming.problem && <span className="dsp__problem">{t(renaming.problem)}</span>}
                <span className="dsp__ranges">{rangesText(d.ranges, sheets, activeSheet) || '—'}</span>
                <span className="label faint">{count ? t('features.sheets.ds.cells', { n: count }) : t('features.sheets.ds.noCells')}</span>
                {palette === d.id && (
                  <div className="dsp__palette" role="group" aria-label={t('features.sheets.ds.color')}>
                    {DS_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="dsp__chip"
                        style={{ background: `var(--c-${c}-bg)`, borderColor: `var(--c-${c}-text)` }}
                        aria-label={c}
                        aria-pressed={d.color === c}
                        onClick={() => {
                          onRecolor(d.id, c)
                          setPalette(null)
                        }}
                      >
                        {d.color === c && <Check size={11} strokeWidth={2} style={{ color: `var(--c-${c}-text)` }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="dsp__actions">
                <button type="button" className="dsp__act" title={t('features.sheets.ds.insert', { name: d.name })} aria-label={t('features.sheets.ds.insert', { name: d.name })} disabled={!editable} onClick={() => onInsert(d.name)}>
                  <CornerDownLeft size={14} strokeWidth={1.75} />
                </button>
                <button type="button" className="dsp__act" title={t('features.sheets.ds.useSelection')} aria-label={`${t('features.sheets.ds.useSelection')}: ${d.name}`} disabled={!editable || !selection.length} onClick={() => onUseSelection(d.id)}>
                  <Crosshair size={14} strokeWidth={1.75} />
                </button>
                <button type="button" className="dsp__act is-danger" title={t('features.sheets.ds.delete')} aria-label={`${t('features.sheets.ds.delete')}: ${d.name}`} disabled={!editable} onClick={() => onDelete(d.id)}>
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {editable && (
        <form
          className="dsp__new"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <span className="label">{t('features.sheets.ds.new')}</span>
          <span className="dsp__sel">{selection.length ? t('features.sheets.ds.selection', { ranges: rangesText(selection, sheets, activeSheet) }) : t('features.sheets.ds.noSelection')}</span>
          <div className="dsp__row">
            <input
              className="input"
              data-autofocus=""
              value={name}
              placeholder={t('features.sheets.ds.placeholder')}
              aria-label={t('features.sheets.ds.name')}
              aria-invalid={!!problem}
              onChange={(e) => {
                setName(e.target.value)
                setProblem(null)
              }}
            />
            <button type="submit" className="btn btn--sm" disabled={!selection.length || !name.trim()}>
              {t('features.sheets.ds.create')}
            </button>
          </div>
          {problem && <span className="dsp__problem">{t(problem)}</span>}
        </form>
      )}
    </Popover>
  )
}
