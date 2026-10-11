/**
 * The aside (§8.1): the rule card of one lamp — what it counts, its thresholds, its sources, the acknowledgement on
 * this device, what the check costs (0 tokens) and when it counted — with its "Open" (and a grey lamp's fix). It
 * follows the cap holding focus in the plate, else the lamp picked with ↵, else the first new lamp, else the first
 * lit one. The head's "+n do not fit" shows the overflow list here instead.
 */
import { useT } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { lampSource, type LampId } from '../registry'
import { ackOf, lastRead, setHidden } from '../engine'
import { isLit } from '../lamps'
import { fmtTime } from '../format'
import { usePreflight } from '../state'
import { useQueue } from '../queue/state'
import { tn } from '../sources/util'
import type { LampView } from '../types'
import { lampName, miniClass } from './Cap'
import { Logbook } from './Logbook'
import { EyeOff, MoreHorizontal } from 'lucide-react'
import { Menu, useMenu } from '../../../ui/Menu'
import { readHidden, writeHidden } from '../prefs'
import { staleOf } from '../queue/model'
import { wasOpened } from '../log'

const SOURCE_ORDER = ['mirror', 'agent', 'terminal', 'memory', 'aimenu', 'autofill']

/** Which lamp the aside shows now: the plate's cursor, the lamp picked, the open queue tab, the first new, the first lit. */
export function asideLamp(views: readonly LampView[], q: { cursor: LampId | null; aside: LampId | null; tab?: LampId | null }): LampView | null {
  const by = (id: LampId | null | undefined) => (id ? (views.find((v) => v.id === id) ?? null) : null)
  return by(q.cursor) ?? by(q.aside) ?? by(q.tab) ?? views.find((v) => v.isNew) ?? views.find((v) => isLit(v.level)) ?? views[0] ?? null
}

function thresholdText(t: Translate, v: LampView) {
  const parts: Array<{ k: string; n: number }> = []
  if (v.amber != null) parts.push({ k: 'features.preflight.spec.amber', n: v.amber })
  if (v.red != null) parts.push({ k: 'features.preflight.spec.red', n: v.red })
  return parts.map((p, i) => (
    <span key={p.k}>
      {i > 0 ? ' · ' : ''}
      <b>{t(p.k)}</b> {t('features.preflight.spec.from', { n: p.n })}
    </span>
  ))
}

/** "10 cards · 3 of them stale · 2 older ones replaced, not cards" — from the queue's list when it is loaded. */
function SourcesNote({ view }: { view: LampView }) {
  const t = useT()
  const items = useQueue((s) => s.items[view.id])
  // a card opened is never stale: counted again when the opened set changes
  useQueue((s) => s.openedRev)
  if (!items && !view.notCards) return null
  const now = Date.now()
  const stale = (items ?? []).filter((i) => staleOf(i, now, (id) => wasOpened(id) === true)).length
  const parts = [tn('features.preflight.spec.cards', items?.length ?? view.count)]
  if (stale) parts.push(t('features.preflight.spec.staleOf', { n: stale }))
  if (view.notCards) parts.push(tn('features.preflight.spec.replaced', view.notCards))
  return <span className="pf-spec__note">{parts.join(' · ')}</span>
}

/** Hide a lamp on this device (the plate's ⋯ shows them again). */
function hideLamp(id: LampId): void {
  const scope = usePreflight.getState().scope
  if (!scope) return
  const next = new Set([...readHidden(scope), id])
  writeHidden(scope, [...next])
  setHidden(next)
  useQueue.setState((q) => ({ aside: q.aside === id ? null : q.aside, lamp: q.lamp === id ? null : q.lamp }))
}

function RuleCard({ view, index }: { view: LampView; index: number }) {
  const t = useT()
  const menu = useMenu()
  const src = lampSource(view.id)
  const ack = ackOf(view.id)
  const read = lastRead(view.id)
  const parts = view.parts ? SOURCE_ORDER.filter((k) => view.parts![k]).map((k) => ({ k, n: view.parts![k] })) : []
  const total = parts.reduce((n, p) => n + p.n, 0)
  const state =
    view.level === 'grey'
      ? t('features.preflight.spec.stateGrey', { why: t(view.why ?? 'features.preflight.grey.off') })
      : view.level === 'dark'
        ? view.count > 0
          ? `${tn('features.preflight.spec.stateLit', view.count)} · ${t('features.preflight.spec.below')}`
          : t('features.preflight.spec.stateDark')
        : tn('features.preflight.spec.stateLit', view.count)
  const lamp = lampName(view.legend)
  return (
    <section className="pf-spec" aria-label={t('features.preflight.spec.aria')} data-testid="pf-rule" data-lamp={view.id}>
      <div className="pf-spec__h">
        <span className={miniClass(view.level)} aria-hidden />
        <span className="label">{t('features.preflight.spec.head', { nn: String(index + 1).padStart(2, '0'), lamp })}</span>
        <span className="pf-sp" />
        <button type="button" className="pf__icon-btn" aria-label={t('features.preflight.spec.menu', { lamp })} aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
          <MoreHorizontal size={14} aria-hidden />
        </button>
        <Menu {...menu.props} placement="bottom-end" entries={[{ label: t('features.preflight.spec.hide'), icon: <EyeOff size={14} />, onSelect: () => hideLamp(view.id) }]} />
      </div>
      <dl className="pf-spec__rows">
        <div className="pf-spec__row">
          <dt className="label">{t('features.preflight.spec.rule')}</dt>
          <dd>{view.rule}</dd>
        </div>
        <div className="pf-spec__row">
          <dt className="label">{t('features.preflight.spec.threshold')}</dt>
          <dd>{thresholdText(t, view)}</dd>
        </div>
        <div className="pf-spec__row">
          <dt className="label">{t('features.preflight.spec.state')}</dt>
          <dd>{state}</dd>
        </div>
        {parts.length > 0 && (
          <div className="pf-spec__row">
            <dt className="label">{t('features.preflight.spec.sources', { n: parts.length })}</dt>
            <dd>
              <span className="pf-srcbar" aria-hidden>
                {parts.map((p) => (
                  <i key={p.k} style={{ flex: p.n / Math.max(1, total) }} />
                ))}
              </span>
              <span className="pf-srcs pf-mono">
                {/* a name and its count stay together (never broken inside a word) */}
                {parts.map((p) => (
                  <span key={p.k} className="pf-srcs__i">
                    {t(`features.preflight.src.${p.k}`)}&nbsp;<b>{p.n}</b>
                  </span>
                ))}
              </span>
              <SourcesNote view={view} />
            </dd>
          </div>
        )}
        <div className="pf-spec__row">
          <dt className="label">{t('features.preflight.spec.acked')}</dt>
          <dd className="pf-mono">{ack ? `${fmtTime(ack.at)} · ${ack.n} · #${ack.h.slice(0, 4)}` : t('features.preflight.spec.ackedNone')}</dd>
        </div>
        <div className="pf-spec__row">
          <dt className="label">{t('features.preflight.spec.cost')}</dt>
          <dd className="pf-mono">
            {t('features.preflight.spec.costLine', { ms: read && read.ms < 1 ? '<1' : Math.round(read?.ms ?? 0) })}
            {read && <span className="pf-spec__note">{t('features.preflight.spec.counted', { time: fmtTime(read.at) })}</span>}
          </dd>
        </div>
      </dl>
      {(src?.open || (view.level === 'grey' && src?.fix)) && (
        <div className="pf-spec__keys">
          {view.level === 'grey' && src?.fix && (
            <button type="button" className="btn btn--sm btn--primary" onClick={() => void Promise.resolve(src.fix!.run()).catch((e) => console.warn('[one] preflight: a fix failed', e))}>
              {src.fix.label()}
            </button>
          )}
          {src?.open && (
            <button type="button" className="btn btn--sm" onClick={() => src.open!()}>
              {t('features.preflight.spec.open')}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function OverflowCard() {
  const t = useT()
  const overflow = usePreflight((s) => s.overflow)
  return (
    <section className="pf-spec" aria-label={t('features.preflight.spec.overflow')} data-testid="pf-overflow">
      <div className="pf-spec__h">
        <span className="label">{t('features.preflight.spec.overflow')}</span>
      </div>
      <ul className="pf-spec__list">
        {overflow.map((id) => {
          const src = lampSource(id)
          return <li key={id}>{src ? lampName(src.legend()) : id}</li>
        })}
      </ul>
      <p className="pf-spec__note pf-spec__pad">
        {t('features.preflight.spec.overflowNote')}
      </p>
    </section>
  )
}

export function Aside() {
  const t = useT()
  const views = usePreflight((s) => s.views)
  const cursor = useQueue((s) => s.cursor)
  const picked = useQueue((s) => s.aside)
  const overflow = useQueue((s) => s.overflow)
  const tab = useQueue((s) => s.lamp)
  const view = asideLamp(views, { cursor, aside: picked, tab: tab === 'all' ? null : tab })
  return (
    <aside className="pf-aside" aria-label={t('features.preflight.aside.aria')}>
      {overflow ? <OverflowCard /> : view ? <RuleCard view={view} index={views.indexOf(view)} /> : null}
      <Logbook />
    </aside>
  )
}
