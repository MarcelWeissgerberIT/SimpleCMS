/**
 * The Bordbuch of today (§9, mock 1 "02 Bordbuch · heute"): this member's events on this device — the lamp test,
 * acknowledgements, cards done and taken back, agent runs that brought proposals, fold / unfold, all dark. Only ids are
 * stored; every label is read now ("—" when gone). The last row is the live position (the current card), not an event.
 */
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { lampSource } from '../registry'
import { useLog } from '../log'
import { fmtTime } from '../format'
import { useQueue } from '../queue/state'
import { itemOf, shownTab } from '../queue/run'
import { rowKey } from '../sources/proposals/common'
import { tn } from '../sources/util'
import type { PreflightLog } from '../types'
import { lampName } from './Cap'

/** rows shown (the newest; the rest is "+n earlier") */
const SHOWN = 12

const lampLabel = (id: string) => {
  const src = lampSource(id)
  try {
    return src ? lampName(src.legend()) : '—'
  } catch {
    return '—'
  }
}

/** A card's label now: the row's key, the page's title, the agent's name — else the kind word. */
function useCardLabel() {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const agents = useWorkspace((s) => s.agents)
  return (e: { item: string; kind?: string; refs?: { pageId?: string; taskId?: string; agentId?: string; slipId?: string } }) => {
    const it = itemOf(e.item)
    if (it?.keyText) return `#${it.keyText}`
    const page = e.refs?.taskId ?? e.refs?.pageId
    const key = rowKey(page)
    if (key) return `#${key}`
    if (page && pages[page]) return pages[page].title || t('common.untitled')
    if (e.refs?.agentId && agents?.[e.refs.agentId]) return agents[e.refs.agentId].name
    return e.kind ? t(`features.preflight.kind.${e.kind}`) : '—'
  }
}

const KEY_OF: Record<string, string> = { applied: 'A', discarded: 'D', read: 'A', hand: 'A', command: '#' }

function Line({ e, label }: { e: PreflightLog; label: ReturnType<typeof useCardLabel> }) {
  const t = useT()
  const agents = useWorkspace((s) => s.agents)
  switch (e.k) {
    case 'test':
      return e.skipped ? (
        <>{t(e.skipped === 'motion' ? 'features.preflight.log.testMotion' : 'features.preflight.log.testOff')}</>
      ) : (
        <>
          {t('features.preflight.log.test')} <b>{e.ok}/{e.of}</b>
          {e.flash ? ` · ${tn('features.preflight.log.flashing', e.flash)}` : ''}
        </>
      )
    case 'ack':
      return e.how === 'mc' ? (
        <>
          <b>{t('features.preflight.mc.name')}</b> · {t('features.preflight.log.acked', { lamp: lampLabel(e.lamp) })}
        </>
      ) : (
        <>
          <span className="kbd">↵</span> {lampLabel(e.lamp)} · {t('features.preflight.log.ackedShort')}
        </>
      )
    case 'card':
      return (
        <>
          <b>{KEY_OF[e.outcome] ?? '·'}</b> {label(e)} {t(`features.preflight.queue.outcome.${e.outcome}`)}
        </>
      )
    case 'undo':
      return (
        <>
          <b>Z</b> {label(e)} {t('features.preflight.log.undone')}
        </>
      )
    case 'source': {
      const [agentId] = e.ref.split('/')
      return (
        <>
          {t('features.preflight.log.ran', { agent: agents?.[agentId]?.name ?? '—' })} · <b>{tn('features.preflight.log.proposals', e.n)}</b>
          {e.sup ? ` · ${tn('features.preflight.log.replaces', e.sup)}` : ''}
        </>
      )
    }
    default:
      return <>{t(`features.preflight.log.${e.k}`)}</>
  }
}

export function Logbook() {
  const t = useT()
  useLang()
  const events = useLog((s) => s.events)
  const ok = useLog((s) => s.ok)
  const label = useCardLabel()
  const tab = useQueue((s) => shownTab(s.lamp))
  const cur = useQueue((s) => (tab ? (s.card[tab] ?? null) : null))
  const expanded = useQueue((s) => (cur ? !!s.expanded[cur] : false))
  const shown = events.slice(-SHOWN)
  const earlier = events.length - shown.length
  const curItem = cur ? itemOf(cur) : null
  return (
    <section className="pf-log" aria-label={t('features.preflight.log.title')} data-testid="pf-log">
      <div className="pf-sec label">
        <span className="pf-sec__n">02</span>
        <span>{t('features.preflight.log.title')}</span>
        <span className="pf-sec__rule" aria-hidden />
      </div>
      {!ok && <p className="pf-log__off">{t('features.preflight.log.off')}</p>}
      {earlier > 0 && <p className="pf-log__more label">{t('features.preflight.log.earlier', { n: earlier })}</p>}
      <ol className="pf-log__list">
        {shown.map((e, i) => (
          <li key={`${e.at}-${i}`} data-k={e.k}>
            <time>{fmtTime(e.at)}</time>
            <span className={`pf-log__dot${e.k === 'test' && !e.skipped ? ' pf-log__dot--ok' : ''}`} aria-hidden />
            <span>
              <Line e={e} label={label} />
            </span>
          </li>
        ))}
        {curItem && (
          <li className="pf-log__now">
            <time>{fmtTime(Date.now())}</time>
            <span className="pf-log__dot pf-log__dot--on" aria-hidden />
            <span>
              {expanded ? <b>E</b> : null} {label({ item: curItem.id, kind: curItem.kind, refs: curItem.refs })} {t(expanded ? 'features.preflight.log.diffOpen' : 'features.preflight.log.current')}
            </span>
          </li>
        )}
        {!shown.length && !curItem && <li className="pf-log__empty">{t('features.preflight.log.empty')}</li>}
      </ol>
    </section>
  )
}
