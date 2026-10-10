/**
 * CHANGED since the draft (per mirror): a black band — what changed ("Comments 7 → 8 · Status unchanged") — the
 * newest comment quoted and marked FOREIGN, and the keys: H Hold (primary), R Redraft, Send anyway (ghost).
 */
import { useLang, useT } from '../../../i18n'
import { isChanged } from '../counts'
import type { Slip } from '../types'
import { ForeignMark } from './parts'

/** "today 08:09" / "9 Oct 16:42" from a stored date stamp; anything else as it is. */
function whenText(v: string, lang: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(v)
  if (!m) return v
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const now = new Date()
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const day = same ? today : d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })
  return m[4] ? `${day} ${m[4]}` : day
}

export function ChangedBand({ slip, onHold, onRedraft, onAnyway, busy }: { slip: Slip; onHold: () => void; onRedraft: () => void; onAnyway: () => void; busy: boolean }) {
  const t = useT()
  const lang = useLang()
  if (!isChanged(slip) || !slip.lastCheck) return null
  const lc = slip.lastCheck
  const fields = lc.changed.filter((c) => c.field !== 'lastCommentAt')
  const unchanged = slip.baseline && 'srcStatus' in slip.baseline.fields && !lc.changed.some((c) => c.field === 'srcStatus') ? (slip.baseline.labels?.srcStatus ?? 'Status') : null
  const when = lc.changed.find((c) => c.field === 'lastCommentAt')?.now
  const who = slip.sources.find((s) => !s.trusted && !s.typed && s.label.includes(' '))?.label
  return (
    <section className="obx-band" aria-label={t('features.outbox.changed.bar')} data-testid="outbox-changed">
      <div className="obx-band__bar">
        <span className="led led--on" aria-hidden />
        <span className="obx-band__hot">{t('features.outbox.changed.bar')}</span>
        <span className="obx-sp" />
        <span className="obx-band__dim">
          {fields.map((c, i) => (
            <span key={c.field}>
              {i > 0 && ' · '}
              {c.label ?? c.field}{' '}
              <b>
                {c.before || '—'} → {c.now || '—'}
              </b>
            </span>
          ))}
          {unchanged && (
            <span>
              {fields.length > 0 && ' · '}
              {t('features.outbox.changed.same', { label: unchanged })}
            </span>
          )}
        </span>
      </div>
      <div className="obx-band__body">
        {lc.latest && (
          <p className="obx-band__quote" aria-label={t('features.outbox.changed.quoteLabel')}>
            <ForeignMark />
            <span className="obx-band__fword">{t('features.outbox.src.foreign')}</span>
            {who && <span className="obx-band__who">{who}</span>}
            {when && <span className="obx-band__when">{whenText(when, lang, t('features.outbox.changed.today'))}</span>} — „{lc.latest}“
          </p>
        )}
        <div className="obx-band__keys">
          <button type="button" className="btn btn--primary btn--sm" onClick={onHold} disabled={busy} data-testid="outbox-hold">
            <kbd className="kbd">H</kbd>
            {t('features.outbox.changed.hold')}
          </button>
          <button type="button" className="btn btn--sm" onClick={onRedraft} disabled={busy} data-testid="outbox-redraft">
            <kbd className="kbd">R</kbd>
            {t('features.outbox.changed.redraft')}
          </button>
          <span className="obx-sp" />
          <button type="button" className="btn btn--ghost btn--sm" onClick={onAnyway} disabled={busy} data-testid="outbox-anyway">
            {t('features.outbox.changed.anyway')}
          </button>
        </div>
      </div>
    </section>
  )
}
