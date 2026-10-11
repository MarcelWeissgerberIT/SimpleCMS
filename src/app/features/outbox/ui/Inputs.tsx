/**
 * EINGABEN / INPUTS: the exact tool arguments, mono key → value (the long text points up at the body). Values are
 * drawn with their hidden code points visible (⟦U+202E⟧), in the tooltip too — a bidi override never flips them here.
 */
import { useT } from '../../../i18n'
import { SENT_AT } from '../template'
import { slipText } from '../text'
import type { Slip } from '../types'
import { Shown, shownText } from './parts'

const LONG = 40

function shown(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function Inputs({ slip }: { slip: Slip }) {
  const t = useT()
  const text = slipText(slip)
  return (
    <dl className="obx-args" data-testid="outbox-inputs">
      {Object.entries(slip.args).map(([k, v]) => {
        const isText = typeof v === 'string' && !!text && v === text && [...v].length > LONG
        const value = v === SENT_AT ? t('features.outbox.inputs.sentAt') : isText ? t('features.outbox.inputs.text', { n: [...text].length }) : shown(v)
        return (
          <div key={k} className="obx-args__pair">
            <dt>
              <Shown text={k} />
            </dt>
            <dd data-arg={k} data-dim={isText || v === SENT_AT || undefined} title={isText ? undefined : shownText(shown(v))}>
              <Shown text={value} />
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
