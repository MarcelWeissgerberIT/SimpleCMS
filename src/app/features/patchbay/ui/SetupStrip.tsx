/**
 * The setup strip (plan §1.12, §3.7, §6 U3): later visits of a setup that is open — one line above the rack instead of
 * the band: "SETUP tracker · 4/7 · 05 next ↵ · ×". The key runs the next lamp's step (it carries the lamps' DOM
 * contract, setup/focus.ts — the way back after a step lands on it); "Show the whole setup" opens the band for this
 * visit; × closes the setup on this device (Integrations › "Set up in the Patchbay" opens it again). The ghosts stay
 * dotted in place on the rack and the readout is the normal one (LIVE and RUNS kept).
 */
import { CornerDownLeft, PanelTopOpen, X } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { LampSet } from '../setup/lamps'
import { keyLabel } from '../setup/lamps'
import { lampNo } from '../setup/keys'
import { runLamp } from '../setup/act'
import { announce } from './store'

const P = 'features.patchbay'

export function SetupStrip({ t, profileId, set, onOpen, onClose }: { t: Translate; profileId: string; set: LampSet; onOpen: () => void; onClose: () => void }) {
  const next = set.next
  const label = next ? keyLabel(next) : null
  const total = set.lamps.length
  return (
    <div className="pb-sstrip" role="region" aria-label={t(`${P}.setup.lampsAria`, { n: set.done, m: total })} data-testid="pb-setup-strip">
      <span className={next ? 'led' : 'led pb-led--ok'} aria-hidden="true" />
      <span className="pb-sstrip__t">
        {next ? t(`${P}.setup.strip`, { id: profileId, n: set.done, m: total, next: lampNo(next.n) }) : t(`${P}.setup.stripDone`, { id: profileId, n: set.done, m: total })}
      </span>
      {next && label && next.action && (
        <button
          type="button"
          className={next.state === 'next' ? 'btn btn--primary btn--sm pb-sstrip__key' : 'btn btn--sm pb-sstrip__key'}
          data-pb-lamp={String(next.n)}
          data-pb-profile={profileId}
          {...(next.n >= 4 && set.recipe ? { 'data-pb-recipe': set.recipe } : {})}
          onClick={(e) => {
            if (!runLamp(next, { profileId, recipeId: set.recipe, from: e.currentTarget })) announce(t(`${P}.setup.after`, { n: lampNo(next.n) }))
          }}
          data-testid="pb-strip-key"
        >
          <span className="pb-sstrip__no">{lampNo(next.n)}</span>
          {t(label.key, label.vars)}
          <CornerDownLeft size={11} strokeWidth={1.9} aria-hidden="true" />
        </button>
      )}
      <span className="pb-sstrip__sp" />
      <button type="button" className="btn btn--ghost btn--sm pb-sstrip__open" onClick={onOpen} data-testid="pb-strip-open">
        <PanelTopOpen size={13} strokeWidth={1.75} aria-hidden="true" />
        {t(`${P}.setup.stripOpen`)}
      </button>
      <button type="button" className="btn btn--ghost btn--sm pb-sstrip__x" aria-label={t(`${P}.setup.stripClose`)} title={t(`${P}.setup.stripClose`)} onClick={onClose} data-testid="pb-strip-close">
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  )
}
