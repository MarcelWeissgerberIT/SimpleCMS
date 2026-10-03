/**
 * Colour rules of a view: an ordered list of (conditions → colour → target). The conditions use
 * the filter builder; the first rule a row matches paints it.
 */
import { ArrowDown, ArrowUp, Plus, Trash } from 'lucide-react'
import type { ColorName, ColorRule } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import { newId } from '../../lib/ids'
import { Segmented, Select } from '../parts'
import type { DbModel } from '../hooks'
import { GroupEditor, emptyGroup } from './Filters'
import { RULE_COLORS, ruleStyle } from '../model/colors'
import { countFilters } from '../model/query'
import '../structure.css'

const TARGETS: ColorRule['target'][] = ['background', 'accent', 'text']

function nextColor(rules: ColorRule[]): ColorName {
  return RULE_COLORS.find((c) => !rules.some((r) => r.color === c)) ?? RULE_COLORS[rules.length % RULE_COLORS.length]
}

export function ColorRulesPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  // live: the rule list changes while the panel is open
  const view = useWorkspace((s) => s.databases[m.db.id]?.views.find((v) => v.id === m.view.id)) ?? m.view
  const rules = view.colorRules ?? []
  const save = (next: ColorRule[]) => useWorkspace.getState().updateView(m.db.id, view.id, { colorRules: next })
  const update = (i: number, patch: Partial<ColorRule>) => save(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= rules.length) return
    const next = [...rules]
    ;[next[i], next[j]] = [next[j], next[i]]
    save(next)
  }
  const add = () => save([...rules, { id: newId(), filter: emptyGroup(), color: nextColor(rules), target: 'background' }])

  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-filterpop db-rcpanel" aria-label={t('database.rc.title')}>
      <div className="db-filterpop__head">
        <span className="label">{t('database.rc.title')}</span>
        <span style={{ flex: 1 }} />
        {rules.length > 1 && <span className="label db-rcpanel__order">{t('database.rc.firstWins')}</span>}
      </div>
      {!rules.length && <p className="db-struct__note db-rcpanel__empty">{t('database.rc.none')}</p>}
      <ol className="db-rcpanel__list">
        {rules.map((r, i) => {
          const inert = countFilters(r.filter, m.propMap) === 0
          return (
            <li key={r.id} className="db-rcrule" style={ruleStyle(r.color)} data-inert={inert} aria-label={t('database.rc.rule', { n: i + 1 })}>
              <div className="db-rcrule__head">
                <span className="db-rcrule__idx">{String(i + 1).padStart(2, '0')}</span>
                <Select
                  value={r.color}
                  className="db-rcrule__color"
                  ariaLabel={t('database.rc.color')}
                  items={RULE_COLORS.map((c) => ({ value: c, label: t(`color.${c}`), icon: <span className="db-swatch db-rcrule__swatch" style={ruleStyle(c)} /> }))}
                  onChange={(color) => update(i, { color })}
                />
                <Segmented value={r.target} ariaLabel={t('database.rc.target')} items={TARGETS.map((v) => ({ value: v, label: t(`database.rc.target.${v}`) }))} onChange={(target) => update(i, { target })} />
                <span className="db-rcrule__sample" data-rc={r.target} aria-hidden>
                  Aa
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.rc.up')} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={13} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.rc.down')} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={13} />
                </button>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.rc.remove')} onClick={() => save(rules.filter((_, j) => j !== i))}>
                  <Trash size={13} />
                </button>
              </div>
              <GroupEditor
                m={m}
                group={r.filter}
                depth={0}
                onChange={(filter) => update(i, { filter })}
                labels={{ empty: t('database.rc.noConditions'), addRule: t('database.rc.addCondition') }}
              />
            </li>
          )
        })}
      </ol>
      <div className="db-panel__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={add}>
          <Plus size={13} /> {t('database.rc.add')}
        </button>
      </div>
    </Popover>
  )
}
