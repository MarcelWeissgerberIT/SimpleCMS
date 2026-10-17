/**
 * The plate while One plans (spec §1.4): what is read and sent, live — "Auftrag gelesen · 1.240 Zeichen · 1 verlinkte
 * Seite", the picked server's part (every call: tool, arguments, size; "Server lieferte nichts"; or why it stayed out),
 * "Kette wird geschrieben …", the receipt ("≈ 0,03 $ · <Modell>", "≈" only while it is an estimate), and ⌘. — stopping
 * creates nothing. A manual run at the Regler's line asks right here (the brake note: E +1 $ once · B a cheaper model —
 * its retry is a fresh press of the person's, the plate's own ↵ Planen).
 */
import { Suspense } from 'react'
import { CircleStop } from 'lucide-react'
import type { ID } from '../../../store/types'
import { useLang, useT } from '../../../i18n'
import { shortcutLabel } from '../../../ui/controls'
import { BrakeSlot } from '../../governor'
import { costText, modelText } from '../../ai/Receipt'
import { stopPlanning, usePlannerRun } from './runs'
import { pressPlan } from './press'
import { CallList, SkipLine, ToolLines } from './Context'

const O = 'features.coding.order'
const P = 'features.coding.order.planner'
const STOP_KEY = shortcutLabel('Mod+.')

export function PlanningPart({ rowId, viewer }: { rowId: ID; viewer: boolean }) {
  const t = useT()
  const lang = useLang()
  const run = usePlannerRun(rowId)
  if (!run || run.phase === 'done') return null
  const n = run.read?.pages ?? 0
  const past = run.phase === 'repair' || run.phase === 'writing'
  return (
    <div className="orc orc-planning" aria-live="polite" data-phase={run.phase} data-testid="order-planning">
      <p className="label orc-title">§ {t(`${O}.planning.title`)}</p>
      <ul className="orc-lines">
        <li className="orc-line" data-testid="order-planning-phase">
          {t(`${O}.planning.phase.${run.phase}`)}
        </li>
        {run.read && (
          <li className="orc-line" data-testid="order-planning-read">
            {t(`${P}.line.read.${n === 1 ? 'one' : 'other'}`, { chars: new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(run.read.chars), n })}
            {run.read.cut ? ` · ${t(`${O}.planning.cut`)}` : ''}
          </li>
        )}
        {run.phase === 'writing' && <li className="orc-line">{t(`${P}.line.writing`)}</li>}
      </ul>
      {run.server ? (
        <div className="orc-planning__server">
          <p className="label">{t('features.coding.order.lamp.context.read', { server: run.server })}</p>
          <CallList server={run.server} calls={run.calls} done={past} />
          <ToolLines tools={run.tools} left={run.left} />
        </div>
      ) : (
        <SkipLine skip={run.skip} />
      )}
      {run.receipt && (
        <p className="orc-line orc-line--quiet" data-testid="order-receipt">
          {costText(t, lang, run.receipt.usd, run.receipt.costSource)} · {modelText(t, run.receipt)}
        </p>
      )}
      {!viewer && (
        <div className="orp-keys" data-bar="">
          <button type="button" className="btn btn--sm btn--danger" onClick={() => stopPlanning(rowId)} data-testid="order-plan-stop">
            <span className="kbd" aria-hidden>
              {STOP_KEY}
            </span>
            <CircleStop size={13} strokeWidth={1.75} aria-hidden />
            {t(`${O}.planning.stop`)}
          </button>
        </div>
      )}
    </div>
  )
}

/** The Regler's brake note for a manual run that stopped at the line (E / B retry = the person's fresh press). */
export function PlanBrake({ rowId, error, onDone }: { rowId: ID; error: unknown; onDone: () => void }) {
  return (
    <div className="orc-brake" data-gv-home="" data-testid="order-brake">
      <Suspense fallback={null}>
        <BrakeSlot
          error={error}
          onRetry={() => {
            onDone()
            void pressPlan(rowId, 'plate')
          }}
          onCancel={onDone}
        />
      </Suspense>
    </div>
  )
}
