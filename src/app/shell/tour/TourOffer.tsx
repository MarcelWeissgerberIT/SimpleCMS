/**
 * "Take the 3-minute tour" — the card on the Welcome page of a freshly seeded workspace (once per device:
 * "Not now" hides it for good; ⌘K, the Help panel and "What can One do?" still start the tour).
 */
import { lazy, Suspense } from 'react'
import { Compass } from 'lucide-react'
import { useT } from '../../i18n'
import { shortcutLabel } from '../../ui/controls'
import { navigate } from '../../lib/router'
import type { ID } from '../../store/types'
import { dismissTourOffer, startTour, useTour, useTourOffer, TOUR_STEP_COUNT } from './state'
import './offer.css'

export function TourOffer({ pageId }: { pageId: ID }) {
  const t = useT()
  const show = useTourOffer(pageId)
  if (!show) return null
  return (
    <section className="tour-offer" aria-labelledby="tour-offer-title" data-testid="tour-offer">
      <span className="tour-offer__icon" aria-hidden>
        <Compass size={16} strokeWidth={1.75} />
      </span>
      <div className="tour-offer__main">
        <p className="label tour-offer__label">
          <span className="led led--on" aria-hidden />
          {t('shell.tour.offer.label', { n: TOUR_STEP_COUNT })}
        </p>
        <h2 id="tour-offer-title" className="tour-offer__title">
          {t('shell.tour.offer.title')}
        </h2>
        <p className="tour-offer__body">{t('shell.tour.offer.body', { key: shortcutLabel('Mod+K') })}</p>
      </div>
      <div className="tour-offer__keys">
        <button type="button" className="btn btn--primary btn--sm" onClick={() => startTour()}>
          {t('shell.tour.offer.start')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={dismissTourOffer}>
          {t('shell.tour.offer.notNow')}
        </button>
      </div>
      <button type="button" className="tour-offer__more" onClick={() => navigate('#/discover')}>
        {t('shell.tour.offer.discover')} →
      </button>
    </section>
  )
}

const Overlay = lazy(() => import('./TourHost'))

/** The tour's overlay: nothing (no code either) until the tour first starts. Mount once. */
export function TourSlot() {
  const running = useTour((s) => s.running)
  if (!running) return null
  return (
    <Suspense fallback={null}>
      <Overlay />
    </Suspense>
  )
}
