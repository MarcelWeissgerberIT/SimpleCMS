/**
 * The annunciator lamps (a role="status" list with words, changes announced): FOREIGN TEXT (red, outlined twice,
 * hatched, the "!" box), CHANGED (orange), SENT, CONFIRMED — and, only when lit, HIDDEN CHARS and UNCLEAR. Under them
 * the status lines: where the comparison comes from, the receipt key.
 */
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { isChanged, isForeign } from '../counts'
import type { Slip } from '../types'
import { clock, ForeignMark } from './parts'

export function Lamps({ slip }: { slip: Slip }) {
  const t = useT()
  const lang = useLang()
  const foreign = isForeign(slip)
  const changed = isChanged(slip) || (!!slip.lastCheck?.changed.length && slip.state === 'ready')
  const sent = slip.state === 'sent' || slip.state === 'confirmed' || slip.state === 'unconfirmed'
  const lamps: Array<{ id: string; lit: boolean; always: boolean; kind?: string }> = [
    { id: 'foreign', lit: foreign, always: true, kind: 'foreign' },
    { id: 'changed', lit: changed, always: true, kind: 'sig' },
    { id: 'sent', lit: sent, always: true, kind: 'ok' },
    { id: 'confirmed', lit: slip.state === 'confirmed', always: true, kind: 'ok' },
    { id: 'hidden', lit: slip.seal.hidden.length > 0, always: false, kind: 'foreign' },
    { id: 'unclear', lit: slip.state === 'unclear', always: false, kind: 'foreign' },
  ]
  const lit = lamps.filter((l) => l.lit).map((l) => t(`features.outbox.lamp.${l.id}`))
  const at = slip.lastCheck?.at ?? slip.baseline?.at
  return (
    <div className="obx-lamps-wrap">
      <ul className="obx-lamps" role="status" aria-label={t('features.outbox.lamp.list')}>
        {lamps
          .filter((l) => l.always || l.lit)
          .map((l) => (
            <li key={l.id} className="obx-lamp" data-kind={l.kind} data-lit={l.lit || undefined} data-testid={`outbox-lamp-${l.id}`}>
              {l.kind === 'foreign' && l.lit && <ForeignMark />}
              {t(`features.outbox.lamp.${l.id}`)}
              <span className="visually-hidden"> · {l.lit ? t('features.outbox.lamp.on') : t('features.outbox.lamp.off')}</span>
            </li>
          ))}
      </ul>
      <p className="visually-hidden" aria-live="polite">
        {lit.join(', ')}
      </p>
      <div className="obx-lines label">
        {at !== undefined && <span>{t('features.outbox.line.mirror', { time: clock(at, lang) })}</span>}
        {slip.draft?.by === 'claude' || slip.usd > 0 ? <span data-testid="outbox-cost">{t('features.outbox.line.cost', { usd: fmtUsd(slip.usd, lang) })}</span> : null}
        <span>{t('features.outbox.line.receipt', { id: slip.id })}</span>
      </div>
    </div>
  )
}
