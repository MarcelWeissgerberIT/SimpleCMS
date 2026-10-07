/**
 * Text size of the whole app: a stepped fader with four stops (Standard = today's sizes · M · L · XL).
 * Settings → Appearance and Workspace → Overview → Display show the same control; both write this
 * device's value (lib/textScale.ts) and the app re-sizes live while the fader moves.
 */
import { useId } from 'react'
import { useT } from '../../i18n'
import { TEXT_STEPS, setTextStep, textScaleOf, useTextStep, type TextStep } from '../../lib/textScale'

const STOPS: TextStep[] = [1, 2, 3, 4]

export function TextSizeControl() {
  const t = useT()
  const step = useTextStep()
  const id = useId()
  const pct = (s: TextStep) => Math.round(textScaleOf(s) * 100)
  const px = (s: TextStep) => Math.round(textScaleOf(s) * 14)
  const name = (s: TextStep) => t(`shell.settings.textSize.step${s}`)
  return (
    <div className="tsize" data-testid="text-size" data-step={step}>
      <div className="tsize__head">
        <label className="st-field__label" htmlFor={id}>
          {t('shell.settings.textSize')}
        </label>
        <span className="tsize__read" data-testid="text-size-readout">
          {name(step).toUpperCase()} · {pct(step)} % · {px(step)} PX
        </span>
      </div>
      <div className="tsize__fader">
        <input
          id={id}
          className="tsize__range"
          type="range"
          min={1}
          max={TEXT_STEPS.length}
          step={1}
          value={step}
          aria-valuetext={`${name(step)} — ${pct(step)} %`}
          aria-describedby={`${id}-hint`}
          onChange={(e) => setTextStep(Number(e.target.value) as TextStep)}
          style={{ ['--tsize-pos' as string]: `${((step - 1) / (TEXT_STEPS.length - 1)) * 100}%` }}
        />
        <div className="tsize__stops" aria-hidden>
          {STOPS.map((s) => (
            <span key={s} className="tsize__tick" data-on={s === step || undefined} style={{ ['--i' as string]: s - 1 }} />
          ))}
          {STOPS.map((s) => (
            <button key={s} type="button" tabIndex={-1} className="tsize__name" data-on={s === step || undefined} style={{ ['--i' as string]: s - 1 }} onClick={() => setTextStep(s)}>
              {name(s)}
            </button>
          ))}
        </div>
      </div>
      <p className="st-field__hint" id={`${id}-hint`}>
        {t('shell.settings.textSize.hint')}
      </p>
    </div>
  )
}
