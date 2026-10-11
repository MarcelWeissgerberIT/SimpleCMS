/**
 * Per-field trust — discarding a proposal with a reason, in the run review:
 *  - ReasonsRow (fine pointers): "DISCARD WITH A REASON  1 wrong (W)  2 not now  3 duplicate  4 handled already" under
 *    the proposal — shown only while its row holds the focus (trust.css);
 *  - ReasonsTouch (touch screens): the group a "Discard ▾" key opens — Wrong · Not now · Duplicate · Handled already
 *    (2 × 2, 44 px each), "No reason" below, and that only "Wrong" counts against the agent. No key caps.
 */
import { useLang, useT } from '../../../../i18n'
import type { DiscardReason } from '../../../ai/agent/types'
import { REASONS, wrongLetter } from '../reasons'
import '../trust.css'

export function ReasonsRow({ n, disabled, onPick }: { n: number; disabled: boolean; onPick: (r: DiscardReason) => void }) {
  const t = useT()
  const lang = useLang()
  const letter = wrongLetter(lang).toUpperCase()
  return (
    <div className="agt-reasons" role="group" aria-label={t('features.agents.trust.reasons.aria', { n })} data-testid="agt-reasons">
      <span className="label agt-reasons__head" aria-hidden="true">
        {t('features.agents.trust.reasons.head')}
      </span>
      {REASONS.map((r, i) => (
        <button
          key={r}
          type="button"
          className="btn btn--ghost btn--sm agt-reason"
          disabled={disabled}
          aria-label={t('features.agents.trust.reasons.key', { reason: t(`features.agents.trust.reason.${r}`), n })}
          aria-keyshortcuts={r === 'wrong' ? `${i + 1} ${letter}` : String(i + 1)}
          onClick={() => onPick(r)}
        >
          <kbd className="kbd agt-reason__kbd">{i + 1}</kbd>
          {t(`features.agents.trust.why.${r}`)}
          {r === 'wrong' && <span className="agt-reason__also">({letter})</span>}
        </button>
      ))}
    </div>
  )
}

export function ReasonsTouch({ id, n, disabled, onPick }: { id: string; n: number; disabled: boolean; onPick: (r: DiscardReason | null) => void }) {
  const t = useT()
  return (
    <div className="agt-touch" id={id} role="group" aria-label={t('features.agents.trust.reasons.aria', { n })} data-testid="agt-touch">
      <span className="label agt-touch__head">{t('features.agents.trust.touch.head')}</span>
      <div className="agt-touch__grid">
        {REASONS.map((r) => (
          <button key={r} type="button" className="btn agt-touch__key" disabled={disabled} aria-label={t('features.agents.trust.reasons.key', { reason: t(`features.agents.trust.reason.${r}`), n })} onClick={() => onPick(r)}>
            {t(`features.agents.trust.reason.${r}`)}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn--ghost agt-touch__none" disabled={disabled} onClick={() => onPick(null)}>
        {t('features.agents.trust.touch.none')}
      </button>
      <p className="agt-touch__note">{t('features.agents.trust.touch.note')}</p>
    </div>
  )
}
