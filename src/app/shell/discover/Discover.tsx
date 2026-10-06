/**
 * "What can One do?" (#/discover) — one page that sells and teaches: six groups of feature cards, each with
 * what it is, how to get there, a "Try it" key that opens the real place (the help's allow-list) and its help
 * article; the tour on top. Linked from the Welcome card, the workspace menu, the sidebar foot, ⌘K and Help.
 */
import { ArrowRight, Compass, type LucideIcon } from 'lucide-react'
import { useT } from '../../i18n'
import { shortcutLabel } from '../../ui/controls'
import { openHelp, runTry, type ChangelogTry } from '../../help'
import { useReadOnly } from '../cloud/state'
import { startTour, TOUR_STEP_COUNT } from '../tour/state'
import { DISCOVER_CARD_COUNT, DISCOVER_GROUPS, type DiscoverCard } from './cards'
import './discover.css'

/** "Try it" keys that write (the practice page, an import): off for viewers of a team workspace. */
const WRITES: ReadonlySet<ChangelogTry> = new Set(['slash', 'ai-menu', 'transform', 'import'])

export function Discover() {
  const t = useT()
  const readOnly = useReadOnly()
  return (
    <div className="disc">
      <div className="disc__inner">
        <div className="disc__meta label">
          <span>§ {t('shell.discover.code')}</span>
          <span className="disc__rule" aria-hidden />
          <span>{t('shell.discover.spec', { cards: DISCOVER_CARD_COUNT, groups: DISCOVER_GROUPS.length })}</span>
        </div>
        <h1 className="disc__title display">{t('shell.discover.title')}</h1>
        <p className="disc__lead">{t('shell.discover.lead')}</p>
        <div className="disc__keys">
          {!readOnly && (
            <button type="button" className="btn btn--primary btn--lg" onClick={() => startTour()}>
              <Compass size={16} strokeWidth={1.8} aria-hidden /> {t('shell.discover.tour')}
              <span className="disc__keys-n label">{t('shell.discover.tourSpec', { n: TOUR_STEP_COUNT })}</span>
            </button>
          )}
          <button type="button" className="btn btn--lg" onClick={() => openHelp()}>
            <span className="kbd" aria-hidden>
              ?
            </span>{' '}
            {t('shell.discover.help')}
          </button>
        </div>
        {DISCOVER_GROUPS.map((g, gi) => (
          <section key={g.id} className="disc__group" aria-labelledby={`disc-g-${g.id}`} data-group={g.id}>
            <h2 className="disc__head" id={`disc-g-${g.id}`}>
              <span className="disc__num">§ {String(gi + 1).padStart(2, '0')}</span>
              <span className="disc__name">{t(`shell.discover.group.${g.id}`)}</span>
              <span className="disc__rule" aria-hidden />
              <span className="label disc__count">{String(g.cards.length).padStart(2, '0')}</span>
            </h2>
            <ul className="disc__grid">
              {g.cards.map((c, i) => (
                <Card key={c.id} card={c} code={`${String(gi + 1).padStart(2, '0')}.${i + 1}`} disabled={readOnly && WRITES.has(c.try)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

function Card({ card, code, disabled }: { card: DiscoverCard; code: string; disabled: boolean }) {
  const t = useT()
  const Icon: LucideIcon = card.icon
  const title = t(`shell.discover.card.${card.id}.title`)
  return (
    <li className="disc-card" data-card={card.id}>
      <div className="disc-card__top">
        <span className="disc-card__icon" aria-hidden>
          <Icon size={17} strokeWidth={1.7} />
        </span>
        <span className="label disc-card__code">{code}</span>
      </div>
      <h3 className="disc-card__title">{title}</h3>
      <p className="disc-card__what">{t(`shell.discover.card.${card.id}.what`)}</p>
      <p className="disc-card__how">
        <span className="label disc-card__how-l">{t('shell.discover.how')}</span>
        <span className="disc-card__how-t">
          {card.keys?.map((k) => (
            <span key={k} className="kbd">
              {shortcutLabel(k)}
            </span>
          ))}{' '}
          {t(`shell.discover.card.${card.id}.how`)}
        </span>
      </p>
      <div className="disc-card__keys">
        <button
          type="button"
          className="btn btn--sm disc-card__try"
          data-try={card.try}
          disabled={disabled}
          aria-label={`${t('help.news.try')}: ${title}`}
          title={t(`help.news.try.${card.try}`)}
          onClick={() => runTry(card.try)}
        >
          {t('help.news.try')} <ArrowRight size={13} strokeWidth={1.8} aria-hidden />
        </button>
        <button type="button" className="btn btn--sm btn--ghost disc-card__help" data-help-id={card.help} aria-label={t('shell.discover.readFor', { title })} onClick={() => openHelp(card.help)}>
          <span className="disc-card__q" aria-hidden>
            ?
          </span>
          {t('shell.discover.read')}
        </button>
      </div>
    </li>
  )
}
