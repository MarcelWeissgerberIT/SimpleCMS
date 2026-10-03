/** The block toolbar: title, cell style and number format, freeze, datasets, functions, chart, more. */
import { useEffect, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, ChartColumnBig, ChevronDown, Ellipsis, Eye, EyeOff, Italic, Pin } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../../ui/Menu'
import type { CellFormat } from '../engine'
import type { Align, SheetCell } from '../model'

export interface ToolbarProps {
  title: string
  cell: SheetCell | undefined
  frozen: boolean
  editable: boolean
  showDS: boolean
  hasCharts: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
  onTitle: (title: string) => void
  onToggle: (key: 'b' | 'i') => void
  onAlign: (align: Align) => void
  onFormat: (fmt: CellFormat) => void
  onDecimals: (delta: 1 | -1) => void
  onFreeze: () => void
  onToggleDS: () => void
  onOpen: (kind: 'fx' | 'ds' | 'chart', anchor: Element) => void
  more: MenuEntry[]
}

const FORMATS: Array<{ key: string; fmt: CellFormat }> = [
  { key: 'auto', fmt: { type: 'auto' } },
  { key: 'number', fmt: { type: 'number', decimals: 2 } },
  { key: 'percent', fmt: { type: 'percent', decimals: 0 } },
  { key: 'eur', fmt: { type: 'currency', currency: 'EUR', decimals: 2 } },
  { key: 'usd', fmt: { type: 'currency', currency: 'USD', decimals: 2 } },
  { key: 'date', fmt: { type: 'date' } },
  { key: 'text', fmt: { type: 'text' } },
]

const fmtKey = (f: CellFormat | undefined) => (!f ? 'auto' : f.type === 'currency' ? (f.currency === 'USD' ? 'usd' : 'eur') : f.type)

export function Toolbar(p: ToolbarProps) {
  const { t } = p
  const fmtMenu = useMenu()
  const moreMenu = useMenu()
  const [title, setTitle] = useState(p.title)
  useEffect(() => setTitle(p.title), [p.title])
  const current = fmtKey(p.cell?.fmt)
  const align = p.cell?.align
  const btn = (label: string, on: boolean | undefined, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void, icon: React.ReactNode, extra = '') => (
    <button type="button" className={`sh-tb__btn${on ? ' is-on' : ''} ${extra}`} aria-label={label} title={label} aria-pressed={on === undefined ? undefined : on} disabled={!p.editable} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {icon}
    </button>
  )
  return (
    <div className="sh-tb" role="toolbar" aria-label={t('features.sheets.toolbar')}>
      <input
        className="sh-tb__title"
        value={title}
        placeholder={t('features.sheets.title.placeholder')}
        aria-label={t('features.sheets.title.label')}
        readOnly={!p.editable}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== p.title && p.onTitle(title)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setTitle(p.title)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      <div className="sh-tb__group">
        {btn(t('features.sheets.bold'), !!p.cell?.b, () => p.onToggle('b'), <Bold size={14} strokeWidth={1.75} />)}
        {btn(t('features.sheets.italic'), !!p.cell?.i, () => p.onToggle('i'), <Italic size={14} strokeWidth={1.75} />)}
        {btn(t('features.sheets.align.left'), align === 'left', () => p.onAlign('left'), <AlignLeft size={14} strokeWidth={1.75} />)}
        {btn(t('features.sheets.align.center'), align === 'center', () => p.onAlign('center'), <AlignCenter size={14} strokeWidth={1.75} />)}
        {btn(t('features.sheets.align.right'), align === 'right', () => p.onAlign('right'), <AlignRight size={14} strokeWidth={1.75} />)}
      </div>
      <div className="sh-tb__group">
        <button type="button" className="sh-tb__fmt" aria-label={t('features.sheets.format')} title={t('features.sheets.format')} aria-haspopup="menu" disabled={!p.editable} onMouseDown={(e) => e.preventDefault()} onClick={fmtMenu.toggle}>
          <span>{t(`features.sheets.fmt.${current}`)}</span>
          <ChevronDown size={12} strokeWidth={1.75} />
        </button>
        {btn(t('features.sheets.decimals.less'), undefined, () => p.onDecimals(-1), <span className="sh-tb__dec">.0←</span>)}
        {btn(t('features.sheets.decimals.more'), undefined, () => p.onDecimals(1), <span className="sh-tb__dec">.00→</span>)}
        {btn(t('features.sheets.freeze'), p.frozen, p.onFreeze, <Pin size={14} strokeWidth={1.75} />)}
      </div>
      <div className="sh-tb__group sh-tb__group--end">
        <button type="button" className="sh-tb__btn sh-tb__key" aria-label={t('features.sheets.datasets')} title={t('features.sheets.datasets')} onMouseDown={(e) => e.preventDefault()} onClick={(e) => p.onOpen('ds', e.currentTarget)}>
          DS
        </button>
        <button type="button" className={`sh-tb__btn${p.showDS ? ' is-on' : ''}`} aria-label={t('features.sheets.showDatasets')} title={t('features.sheets.showDatasets')} aria-pressed={p.showDS} onMouseDown={(e) => e.preventDefault()} onClick={p.onToggleDS}>
          {p.showDS ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
        </button>
        <button type="button" className="sh-tb__btn sh-tb__key sh-tb__fx" aria-label={t('features.sheets.functions')} title={t('features.sheets.functions')} onMouseDown={(e) => e.preventDefault()} onClick={(e) => p.onOpen('fx', e.currentTarget)}>
          fx
        </button>
        {p.hasCharts && (
          <button type="button" className="sh-tb__btn sh-tb__chart" aria-label={t('features.sheets.chart')} title={t('features.sheets.chart')} disabled={!p.editable} onMouseDown={(e) => e.preventDefault()} onClick={(e) => p.onOpen('chart', e.currentTarget)}>
            <ChartColumnBig size={14} strokeWidth={1.75} />
            <span>{t('features.sheets.chart')}</span>
          </button>
        )}
        <button type="button" className="sh-tb__btn" aria-label={t('features.sheets.more')} title={t('features.sheets.more')} aria-haspopup="menu" onMouseDown={(e) => e.preventDefault()} onClick={moreMenu.toggle}>
          <Ellipsis size={14} strokeWidth={1.75} />
        </button>
      </div>
      <Menu {...fmtMenu.props} entries={FORMATS.map((f) => ({ label: t(`features.sheets.fmt.${f.key}`), checked: f.key === current, onSelect: () => p.onFormat(f.fmt) }))} />
      <Menu {...moreMenu.props} placement="bottom-end" entries={p.more} />
    </div>
  )
}
