/**
 * The long-press sheet (touch): a finger held on a cell and lifted without dragging. Compact,
 * anchored to the cell: "+ Area" (this cell starts another area of the selection — the bar's key),
 * Fill ↓, Edit, and "Pick a value": the column's entries, searchable, finger-sized.
 */
import { ArrowDownToLine, PencilLine, SquareDashedPlus } from 'lucide-react'
import { Popover } from '../../../ui/Popover'
import { PickPanel } from './PickList'
import { Key, type BarKey } from './TouchBar'

export interface HoldSheetProps {
  anchor: Element
  /** the cell ("B6") and its column ("B") */
  addr: string
  column: string
  entries: string[]
  /** the cell already is another area of the selection */
  areaOn: boolean
  /** there is a cell above to fill from */
  canFill: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
  onPick: (value: string) => void
  onArea: () => void
  onFill: () => void
  onEdit: () => void
  onClose: () => void
}

const icon = (C: typeof PencilLine) => <C size={16} strokeWidth={1.75} />

export function HoldSheet({ anchor, addr, column, entries, areaOn, canFill, t, onPick, onArea, onFill, onEdit, onClose }: HoldSheetProps) {
  const keys: BarKey[] = [
    { id: 'area', label: t('features.sheets.hold.area'), legend: t('features.sheets.touch.area'), icon: icon(SquareDashedPlus), on: areaOn, onPress: onArea },
    { id: 'fill-down', label: t('features.sheets.hold.fill'), legend: t('features.sheets.hold.fillShort'), icon: icon(ArrowDownToLine), disabled: !canFill, onPress: onFill },
    { id: 'edit', label: t('features.sheets.hold.edit'), legend: t('features.sheets.hold.editShort'), icon: icon(PencilLine), onPress: onEdit },
  ]
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-start" offset={6} className="sh-hold" role="dialog" aria-label={t('features.sheets.hold.title', { addr })}>
      <div className="sh-hold__head label">
        <span>{t('features.sheets.hold.spec', { addr })}</span>
      </div>
      <div className="sh-hold__keys" role="toolbar" aria-label={t('features.sheets.hold.keys')} onMouseDown={(e) => e.preventDefault()}>
        {keys.map((k, i) => (
          <Key key={k.id} k={k} autoFocus={i === 0} />
        ))}
      </div>
      <div className="sh-hold__section label" aria-hidden>
        {t('features.sheets.hold.pick')}
      </div>
      <PickPanel entries={entries} column={column} t={t} onPick={onPick} autoFocus={false} touch />
    </Popover>
  )
}
