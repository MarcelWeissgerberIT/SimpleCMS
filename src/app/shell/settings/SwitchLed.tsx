/**
 * The LED colour of every switch: a row of LED keys (radio group) — the primary colour (the default: the
 * workspace's signal colour) or one of a few content colours — with a switch off and on beside it. Settings →
 * Appearance and Workspace → Overview → Display show the same control; both write this device's value
 * (lib/switchLed.ts) and every switch in the app changes at once.
 */
import { useId, type CSSProperties } from 'react'
import { useT } from '../../i18n'
import { SwitchFace } from '../../ui/controls'
import { onRovingKey } from '../../ui/roving'
import { SWITCH_LEDS, setSwitchLed, switchLedColor, useSwitchLed } from '../../lib/switchLed'

export function SwitchLedControl() {
  const t = useT()
  const led = useSwitchLed()
  const id = useId()
  return (
    <div className="sled" data-testid="switch-led" data-led={led}>
      <div className="sled__head">
        <span className="st-field__label" id={`${id}-label`}>
          {t('shell.settings.switchLed')}
        </span>
        <span className="sled__demo" title={t('shell.settings.switchLed.demo')} aria-hidden>
          <SwitchFace checked={false} seed="led-demo-off" />
          <SwitchFace checked seed="led-demo-on" />
        </span>
      </div>
      <div className="sled__keys" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} onKeyDown={(e) => onRovingKey(e)}>
        {SWITCH_LEDS.map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={l === led}
            tabIndex={l === led ? 0 : -1}
            className="sled__key"
            data-led={l}
            style={{ ['--led' as string]: switchLedColor(l) } as CSSProperties}
            onClick={() => setSwitchLed(l)}
          >
            <span className="sled__lens" aria-hidden />
            <span className="sled__name">{t(`shell.settings.switchLed.${l}`)}</span>
          </button>
        ))}
      </div>
      <p className="st-field__hint sled__hint" id={`${id}-hint`}>
        {t('shell.settings.switchLed.hint')}
      </p>
    </div>
  )
}
