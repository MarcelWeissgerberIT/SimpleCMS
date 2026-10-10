/** A sent slip in the dock ("SENT TODAY · NEWEST"): the stamp, the cost line, "↶ Reset row" (only in One). */
import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { fmtUsd } from '../../../lib/money'
import { resetRow } from '../hand'
import type { Slip } from '../types'
import { clock, ServerTag, ToolTarget } from './parts'

export function ReceiptCard({ slip }: { slip: Slip }) {
  const t = useT()
  const lang = useLang()
  const r = slip.receipt
  const [note, setNote] = useState<string | null>(null)
  if (!r) return null
  const canReset = r.rowPatch.applied.length > 0 && !r.rowPatch.resetAt
  return (
    <div className="obx-rcard" data-testid="outbox-receipt" data-slip={slip.id}>
      <div className="obx-rcard__head">
        <ServerTag name={slip.target.serverName} />
        <ToolTarget slip={slip} />
        <span className="obx-rcard__title" title={slip.title}>
          {slip.title}
        </span>
        <span className="obx-sp" />
        {canReset && (
          <button
            type="button"
            className="btn btn--ghost btn--sm obx-rcard__reset"
            title={t('features.outbox.sent.resetHint')}
            data-testid="outbox-reset"
            onClick={async () => {
              const res = await resetRow(slip.id)
              if (!res) return setNote(t('features.outbox.sent.resetNone'))
              setNote(res.kept.length ? t('features.outbox.sent.resetKept', { names: res.kept.join(', ') }) : t('features.outbox.sent.resetDone'))
            }}
          >
            <Undo2 size={13} aria-hidden />
            {t('features.outbox.sent.reset')}
          </button>
        )}
      </div>
      <div className="obx-stamp" data-path={r.path}>
        <span className="led led--ok" aria-hidden />
        <b>{t('features.outbox.sent.stamp', { time: clock(r.at, lang) })}</b>
        <span>{r.path === 'hand' ? t('features.outbox.sent.byHand') : r.path}</span>
      </div>
      <p className="obx-rcard__line label">
        {fmtUsd(r.usd, lang)} · {r.path === 'hand' ? t('features.outbox.strip.byHand') : r.path}
        {r.rowPatch.resetAt ? ` · ${t('features.outbox.sent.wasReset', { time: clock(r.rowPatch.resetAt, lang) })}` : ''}
      </p>
      {r.rowPatch.skipped.length > 0 && <p className="obx-rcard__note">{t('features.outbox.sent.skipped', { names: r.rowPatch.skipped.join(', ') })}</p>}
      {note && (
        <p className="obx-rcard__note" role="status" data-testid="outbox-reset-note">
          {note}
        </p>
      )}
    </div>
  )
}
