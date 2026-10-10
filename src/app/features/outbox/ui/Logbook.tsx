/** BORDBUCH / LOGBOOK: the focused slip's log lines, today (codes + values, translated here). */
import { useLang, useT } from '../../../i18n'
import type { Slip } from '../types'
import { clock } from './parts'

export function Logbook({ slip }: { slip: Slip }) {
  const t = useT()
  const lang = useLang()
  const lines = slip.log.slice(-8)
  if (!lines.length) return null
  return (
    <section className="obx-log" aria-label={t('features.outbox.log.title')} data-testid="outbox-logbook">
      <h3 className="obx-log__head label">
        {t('features.outbox.log.title')} · {t('features.outbox.log.sub', { key: slip.target.key })}
        <span className="obx-log__rule" aria-hidden />
      </h3>
      <ol className="obx-log__list">
        {lines.map((l, i) => (
          <li key={i} className="obx-log__line" data-last={i === lines.length - 1 || undefined}>
            <span className="obx-log__time">{clock(l.at, lang)}</span>
            <span className="obx-log__dot" aria-hidden />
            <span>{t(`features.outbox.log.${l.code}`, { ...(l.v ?? {}), ...(l.v?.origin ? { origin: t(`features.outbox.origin.${l.v.origin}`) } : {}) })}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
