/**
 * QUITTUNGEN · HEUTE / RECEIPTS · TODAY: a paper strip of this device's sends of today — time, tool, #key, the path,
 * what was (not) read back — and the totals. Receipts stay on this device.
 */
import { ReceiptText } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import type { Slip } from '../types'
import { clock } from './parts'

export function ReceiptStrip({ slips }: { slips: Slip[] }) {
  const t = useT()
  const lang = useLang()
  const list = [...slips].sort((a, b) => (b.receipt?.at ?? 0) - (a.receipt?.at ?? 0))
  const date = new Date().toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const usd = list.reduce((n, s) => n + (s.receipt?.usd ?? 0), 0)
  const different = list.filter((s) => s.receipt?.mismatch?.length).length
  return (
    <section className="obx-rstrip" aria-label={t('features.outbox.strip.title')} data-testid="outbox-receipts">
      <h2 className="obx-side__head label">
        <ReceiptText size={13} aria-hidden />
        {t('features.outbox.strip.title')}
        <span className="obx-bin__rule" aria-hidden />
        {String(list.length).padStart(2, '0')}
      </h2>
      <div className="obx-paper">
        <div className="obx-paper__top">
          <b>{t('features.outbox.strip.paper')}</b>
          <span>{t('features.outbox.strip.device', { date })}</span>
        </div>
        {!list.length && <p className="obx-paper__none">{t('features.outbox.strip.none')}</p>}
        {list.map((s) => (
          <div key={s.id} className="obx-paper__entry">
            <div className="obx-paper__row">
              <b>{clock(s.receipt!.at, lang)}</b>
              <span className="obx-paper__tool">{s.route.tool}</span>
              <span className="obx-sp" />
              <span>#{s.target.key}</span>
            </div>
            <div className="obx-paper__sub">
              {s.receipt!.path === 'hand' ? t('features.outbox.strip.byHand') : s.receipt!.path} · {t('features.outbox.strip.notRead')}
              {s.receipt!.rowPatch.resetAt ? ` · ${t('features.outbox.strip.rowReset')}` : ''}
            </div>
          </div>
        ))}
        <div className="obx-paper__total">
          <b>{t('features.outbox.strip.total', { n: list.length })}</b>
          <span>{t('features.outbox.strip.different', { n: different })}</span>
          <span>{fmtUsd(usd, lang)}</span>
        </div>
      </div>
    </section>
  )
}
