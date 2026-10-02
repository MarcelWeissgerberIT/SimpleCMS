/**
 * Footer calculation cell: shows "SUM 1,204" readouts; menu with CalcFns per type.
 */
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { CalcFn, Page, PropertyDef } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { Menu } from '../../parts'
import { useT } from '../../../i18n'
import { aggregate, formatAgg } from '../../model/calc'
import { calcsFor } from '../../model/schema'
import { inferKind } from '../../model/query'
import { useModel, useLabels } from '../../hooks'

export function CalcCell({ prop, rows }: { prop: PropertyDef; rows: Page[] }) {
  const t = useT()
  const m = useModel()
  const labels = useLabels()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const fn: CalcFn = m.view.calculations?.[prop.id] ?? 'none'
  const kind = inferKind(m.resolver, m.db, prop, m.allRows)
  const fns = calcsFor(kind)
  let display = ''
  if (fn !== 'none') {
    const values = rows.map((r) => m.resolver.value(m.db, prop, r))
    display = formatAgg(aggregate(fn, prop, values, m.resolver.ctx.lang), prop, m.resolver.ctx.lang, labels)
  }
  const label = (f: CalcFn) => (prop.type === 'checkbox' && (f === 'count_not_empty' || f === 'count_empty') ? t(`database.calc.${f === 'count_not_empty' ? 'checked' : 'unchecked'}`) : t(`database.calc.${f}`))
  return (
    <>
      <button type="button" className="dbt-calc" data-set={fn !== 'none'} onClick={(e) => setAnchor(e.currentTarget)}>
        {fn === 'none' ? (
          <span className="dbt-calc__hint">
            {t('database.calc.calculate')} <ChevronDown size={11} />
          </span>
        ) : (
          <>
            <span className="dbt-calc__fn">{prop.type === 'checkbox' && (fn === 'count_not_empty' || fn === 'count_empty') ? t(`database.calcShort.${fn === 'count_not_empty' ? 'checked' : 'unchecked'}`) : t(`database.calcShort.${fn}`)}</span>
            <span className="dbt-calc__val">{display}</span>
          </>
        )}
      </button>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement="top-start"
        entries={fns.map((f) => ({
          label: label(f),
          checked: f === fn,
          onSelect: () => useWorkspace.getState().updateView(m.db.id, m.view.id, { calculations: { ...(m.view.calculations ?? {}), [prop.id]: f } }),
        }))}
      />
    </>
  )
}
