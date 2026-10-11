/**
 * Per-field trust — the screwed plate "§ 03 TRUST PER FIELD · LAST 20 VERDICTS" (the agent page's aside): this
 * device's verdicts per key as meters with their notes, then what is never direct (only by hand, the key property)
 * and what always waits for review, the legend and the rule. Read only in S1 (no switches, every lamp PRÜFUNG — the
 * notes say how far each key is). The book is loaded on mount and follows other tabs' writes.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { Hand, Lock } from 'lucide-react'
import { useWorkspace } from '../../../../store/store'
import { useT } from '../../../../i18n'
import { Screws } from '../../../../ui/controls'
import type { CustomAgent } from '../../../../store/types'
import type { AgentRun } from '../../types'
import { loadBook, useTrust } from '../book'
import { plateOf, PLATE_ROWS, type PlateRow } from '../plate'
import type { Seg } from '../rules'
import { TrustRow } from './TrustRow'
import { TrustSwatch } from './TrustMeter'
import '../trust.css'

/** The lesson states that put "just now 3 × wrong → lesson" on a row. */
const LESSON_OPEN = new Set(['waiting', 'offer', 'drafting', 'ready'])
const LEGEND: Array<[Seg, string]> = [
  ['g', 'accept'],
  ['s', 'spot'],
  ['e', 'edited'],
  ['w', 'wrong'],
  ['u', 'undone'],
  ['x', 'empty'],
]

export function TrustPlate({ agent, runs, variant = 'aside' }: { agent: CustomAgent; runs: AgentRun[]; variant?: 'aside' | 'editor' }) {
  const t = useT()
  const id = useId()
  const book = useTrust((s) => s.byAgent[agent.id] ?? null)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const [all, setAll] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    void loadBook(agent.id)
    const tick = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(tick)
  }, [agent.id])
  const plate = useMemo(() => plateOf({ book, runs, ws: { pages, databases }, now, t }), [book, runs, pages, databases, now, t])
  const lessons = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of book?.lessons ?? []) if (LESSON_OPEN.has(l.state)) m.set(l.key, l.verdicts.length)
    return m
  }, [book])

  // the first PLATE_ROWS rows across the groups, the rest behind "+ n more"
  let left = all ? Infinity : PLATE_ROWS
  const groups = plate.groups
    .map((g) => {
      const rows = g.rows.slice(0, Math.max(0, left))
      left -= rows.length
      return { ...g, rows }
    })
    .filter((g) => g.rows.length)
  const hidden = plate.total - groups.reduce((n, g) => n + g.rows.length, 0)
  const sub = plate.groups.length > 1
  const row = (r: PlateRow, i: number) => <TrustRow key={r.key} row={r} lesson={lessons.get(r.key) ?? null} now={now} noteId={`${id}-n${i}`} />

  return (
    <aside className="screw-plate agt-plate" data-variant={variant} aria-labelledby={`${id}-h`} data-testid="agt-plate">
      <Screws seed={`trust:${agent.id}`} />
      <div className="agt-plate__head">
        <span className="label agt-plate__n" aria-hidden="true">
          § 03
        </span>
        <h2 className="label agt-plate__title" id={`${id}-h`}>
          {t('features.agents.trust.plate.title')}
        </h2>
        <span className="label agt-plate__r">{t(variant === 'editor' ? 'features.agents.trust.plate.mine' : 'features.agents.trust.plate.last')}</span>
      </div>
      <p className="agt-plate__lede">{t('features.agents.trust.plate.lede')}</p>
      {plate.empty ? (
        <p className="agt-plate__empty" data-testid="agt-plate-empty">
          {t('features.agents.trust.plate.empty')}
        </p>
      ) : (
        <div className="agt-plate__rows">
          {groups.map((g, gi) => (
            <section key={g.id ?? '-'} className="agt-group" aria-label={sub ? g.title : undefined}>
              {sub && <h3 className="label agt-group__title">{g.title}</h3>}
              <ul className="agt-rows">{g.rows.map((r, i) => row(r, gi * 100 + i))}</ul>
            </section>
          ))}
          {(hidden > 0 || all) && plate.total > PLATE_ROWS && (
            <button type="button" className="btn btn--ghost btn--sm agt-plate__more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? t('features.agents.trust.plate.less') : t(hidden === 1 ? 'features.agents.trust.plate.more.one' : 'features.agents.trust.plate.more.other', { n: hidden })}
            </button>
          )}
          {plate.moreDbs > 0 && <p className="label agt-plate__dbs">{t(plate.moreDbs === 1 ? 'features.agents.trust.plate.moreDbs.one' : 'features.agents.trust.plate.moreDbs.other', { n: plate.moreDbs })}</p>}
        </div>
      )}
      <dl className="agt-never">
        {(plate.hand.length > 0 || plate.keyProps.length > 0) && (
          <div className="agt-never__row" data-testid="agt-never">
            <dt className="label">
              <Hand size={12} strokeWidth={1.75} aria-hidden /> {t('features.agents.trust.never.head')}
            </dt>
            <dd>
              {[
                plate.hand.length ? t('features.agents.trust.never.hand', { names: plate.hand.join(', ') }) : '',
                plate.keyProps.length ? t('features.agents.trust.never.key', { name: plate.keyProps.join(', ') }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
        )}
        <div className="agt-never__row" data-testid="agt-always">
          <dt className="label">
            <Lock size={12} strokeWidth={1.75} aria-hidden /> {t('features.agents.trust.always.head')}
          </dt>
          <dd>{t('features.agents.trust.always.text')}</dd>
        </div>
      </dl>
      <div className="agt-plate__foot">
        <ul className="agt-legend" aria-label={t('features.agents.trust.legend.aria')}>
          {LEGEND.map(([seg, key]) => (
            <li key={seg}>
              <TrustSwatch seg={seg} />
              {t(`features.agents.trust.legend.${key}`)}
            </li>
          ))}
        </ul>
        <p className="agt-plate__rule">
          <b>{t('features.agents.trust.legend.ruleHead')}</b> {t('features.agents.trust.legend.rule')}
        </p>
      </div>
    </aside>
  )
}
